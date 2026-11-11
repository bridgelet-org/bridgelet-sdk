import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { sanitizeAccountEventDetails } from '../account-event-sanitizer.js';
import {
  AccountEvent,
  AccountEventType,
} from '../entities/account-event.entity.js';

export interface RecordAccountEventParams {
  accountId: string;
  type: AccountEventType;
  txHash?: string | null;
  details?: Record<string, unknown>;
  manager?: EntityManager;
}

@Injectable()
export class AccountEventsProvider {
  private readonly logger = new Logger(AccountEventsProvider.name);

  constructor(
    @InjectRepository(AccountEvent)
    private readonly eventsRepository: Repository<AccountEvent>,
  ) {}

  async record(params: RecordAccountEventParams): Promise<void> {
    try {
      const repository = params.manager
        ? params.manager.getRepository(AccountEvent)
        : this.eventsRepository;

      const event = repository.create({
        accountId: params.accountId,
        type: params.type,
        txHash: params.txHash ?? null,
        details: sanitizeAccountEventDetails(params.details),
      });

      await repository.save(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to write ${params.type} event for account ${params.accountId}: ${message}`,
      );
    }
  }

  async findByAccountId(accountId: string): Promise<AccountEvent[]> {
    return this.eventsRepository.find({
      where: { accountId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }
}
