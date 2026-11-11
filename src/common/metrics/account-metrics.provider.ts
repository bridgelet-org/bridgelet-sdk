import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Gauge, Registry, register } from 'prom-client';
import { Account } from '../../modules/accounts/entities/account.entity.js';
import { AccountStatus } from '../../modules/accounts/enums/account-status.enum.js';

const OLDEST_ACCOUNT_AGE_STATUSES = [
  AccountStatus.CLAIMING,
  AccountStatus.PARTIAL_SWEEP,
  AccountStatus.PENDING_PAYMENT,
] as const;

interface StatusCountRow {
  status: AccountStatus;
  count: string;
}

interface OldestAgeRow {
  status: AccountStatus;
  age_seconds: string | null;
}

/**
 * Exposes account-state gauges used by the stuck-payment alerts (#993):
 *
 * - `accounts_by_status{status}`: number of non-deleted accounts in each state.
 * - `oldest_account_age_seconds{status}`: age of the oldest account in the
 *   states that can get stuck (`CLAIMING`, `PARTIAL_SWEEP`, `PENDING_PAYMENT`).
 *
 * The values are refreshed by `SchedulerService` on its maintenance interval.
 * Gauges start at zero so a scrape during startup is valid rather than empty.
 */
@Injectable()
export class AccountMetricsProvider {
  private readonly logger = new Logger(AccountMetricsProvider.name);

  private readonly accountsByStatusGauge: Gauge<string>;
  private readonly oldestAccountAgeGauge: Gauge<string>;

  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    registry: Registry = register,
  ) {
    this.accountsByStatusGauge = this.getOrCreateGauge(
      'accounts_by_status',
      {
        help: 'Number of accounts by lifecycle status',
        labelNames: ['status'],
      },
      registry,
    );
    this.oldestAccountAgeGauge = this.getOrCreateGauge(
      'oldest_account_age_seconds',
      {
        help: 'Age in seconds of the oldest account in a potentially stuck status',
        labelNames: ['status'],
      },
      registry,
    );

    for (const status of Object.values(AccountStatus)) {
      this.accountsByStatusGauge.set({ status }, 0);
    }
    for (const status of OLDEST_ACCOUNT_AGE_STATUSES) {
      this.oldestAccountAgeGauge.set({ status }, 0);
    }
  }

  async refresh(): Promise<void> {
    try {
      const [statusRows, ageRows] = await Promise.all([
        this.loadStatusCounts(),
        this.loadOldestAges(),
      ]);

      const countsByStatus = new Map(
        statusRows.map((row) => [row.status, Number(row.count)]),
      );
      for (const status of Object.values(AccountStatus)) {
        this.accountsByStatusGauge.set(
          { status },
          countsByStatus.get(status) ?? 0,
        );
      }

      const agesByStatus = new Map(
        ageRows.map((row) => [
          row.status,
          Math.max(0, Number(row.age_seconds ?? 0)),
        ]),
      );
      for (const status of OLDEST_ACCOUNT_AGE_STATUSES) {
        this.oldestAccountAgeGauge.set(
          { status },
          agesByStatus.get(status) ?? 0,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to refresh account metrics: ${message}`);
    }
  }

  private loadStatusCounts(): Promise<StatusCountRow[]> {
    return this.accountsRepository
      .createQueryBuilder('account')
      .select('account.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('account.deletedAt IS NULL')
      .groupBy('account.status')
      .getRawMany<StatusCountRow>();
  }

  private loadOldestAges(): Promise<OldestAgeRow[]> {
    return this.accountsRepository
      .createQueryBuilder('account')
      .select('account.status', 'status')
      .addSelect(
        'EXTRACT(EPOCH FROM (NOW() - MIN(account.updatedAt)))',
        'age_seconds',
      )
      .where('account.deletedAt IS NULL')
      .andWhere('account.status IN (:...statuses)', {
        statuses: [...OLDEST_ACCOUNT_AGE_STATUSES],
      })
      .groupBy('account.status')
      .getRawMany<OldestAgeRow>();
  }

  private getOrCreateGauge(
    name: string,
    config: { help: string; labelNames: string[] },
    registry: Registry,
  ): Gauge<string> {
    const existing = registry.getSingleMetric(name);
    if (existing) return existing as Gauge<string>;
    return new Gauge({
      name,
      help: config.help,
      labelNames: config.labelNames,
      registers: [registry],
    });
  }
}
