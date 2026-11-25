import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { InjectRepository } from '@nestjs/typeorm';
import { Counter } from 'prom-client';
import { In, LessThan, Repository } from 'typeorm';
import { ContractEvent } from '../../stellar/entities/contract-event.entity.js';

/**
 * Bounded, idempotent retention for the append-only `contract_events` table.
 *
 * The retention cutoff is measured by `ledger_sequence` (the authoritative
 * ordering for on-chain events), never by `created_at`. Each run:
 *
 * 1. reads the highest `ledger_sequence` currently stored,
 * 2. computes `cutoff = highest - CONTRACT_EVENT_RETENTION_LEDGER_WINDOW`, and
 * 3. deletes rows below that cutoff in small batches keyed by primary id.
 *
 * Batching keeps every delete in its own short transaction instead of one
 * unbounded `DELETE`, and because each pass re-reads the same fixed cutoff,
 * the job is safe to retry after an interruption. Retention is opt-in: a
 * window of 0 (the default) is a no-op, preserving the previous behaviour.
 *
 * See docs/database-schema.md ("contract_events retention and partitioning").
 */
@Injectable()
export class ContractEventRetentionProvider {
  private readonly logger = new Logger(ContractEventRetentionProvider.name);

  constructor(
    @InjectRepository(ContractEvent)
    private readonly contractEventsRepository: Repository<ContractEvent>,
    private readonly configService: ConfigService,
    @InjectMetric('contract_event_retention_deleted_total')
    private readonly deletedCounter: Counter<string>,
    @InjectMetric('contract_event_retention_failures_total')
    private readonly failuresCounter: Counter<string>,
  ) {}

  /** Run one retention pass. Never throws — failures are logged and counted. */
  async run(): Promise<void> {
    const window = Number(
      this.configService.getOrThrow<number>(
        'app.contractEventRetentionLedgerWindow',
      ),
    );
    const batchSize = Number(
      this.configService.getOrThrow<number>(
        'app.contractEventRetentionBatchSize',
      ),
    );

    if (!Number.isFinite(window) || window <= 0) {
      this.logger.debug(
        'Contract event retention disabled (ledger window <= 0); skipping',
      );
      return;
    }
    if (!Number.isFinite(batchSize) || batchSize <= 0) {
      this.failuresCounter.inc();
      this.logger.error(
        'Contract event retention batch size must be a positive number',
      );
      return;
    }

    let highestLedger: string;
    try {
      const newest = await this.contractEventsRepository.find({
        order: { ledgerSequence: 'DESC' },
        take: 1,
      });
      if (newest.length === 0) {
        this.logger.debug(
          'Contract event retention: no events to retain against; skipping',
        );
        return;
      }
      highestLedger = newest[0].ledgerSequence;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.failuresCounter.inc();
      this.logger.error(
        `Contract event retention ledger query failed: ${message}`,
      );
      return;
    }

    let cutoff: string;
    try {
      const cutoffValue = BigInt(highestLedger) - BigInt(window);
      if (cutoffValue <= 0n) {
        // Every stored ledger is inside the retention window — nothing to do.
        this.logger.debug(
          `Contract event retention: highest ledger ${highestLedger} is within ` +
            `the ${window}-ledger window; skipping`,
        );
        return;
      }
      cutoff = cutoffValue.toString();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.failuresCounter.inc();
      this.logger.error(
        `Contract event retention could not compute cutoff from ledger ` +
          `${highestLedger}: ${message}`,
      );
      return;
    }

    let deleted = 0;
    for (;;) {
      let batch: ContractEvent[];
      try {
        batch = await this.contractEventsRepository.find({
          where: { ledgerSequence: LessThan(cutoff) },
          order: { ledgerSequence: 'ASC' },
          take: batchSize,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.failuresCounter.inc();
        this.logger.error(
          `Contract event retention batch query failed: ${message}`,
        );
        return;
      }

      if (batch.length === 0) break;

      let affected: number;
      try {
        const result = await this.contractEventsRepository.delete({
          id: In(batch.map((row) => row.id)),
        });
        affected = result.affected ?? batch.length;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.failuresCounter.inc();
        this.logger.error(`Contract event retention delete failed: ${message}`);
        return;
      }

      deleted += affected;
      this.deletedCounter.inc(affected);

      // A short batch means we drained the backlog; zero affected means a
      // concurrent worker already removed those rows. Both end the pass.
      if (affected === 0 || batch.length < batchSize) break;
    }

    if (deleted > 0) {
      this.logger.log(
        `Contract event retention: deleted ${deleted} row(s) below ledger ${cutoff}`,
      );
    }
  }
}
