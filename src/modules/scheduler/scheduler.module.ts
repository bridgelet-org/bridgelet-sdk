import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity.js';
import { StellarModule } from '../stellar/stellar.module.js';
import { SchedulerService } from './scheduler.service.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';
import { AccountEventsModule } from '../account-events/account-events.module.js';
import { SweepsModule } from '../sweeps/sweeps.module.js';
import { AccountReclamationProvider } from './providers/account-reclamation.provider.js';
import { ContractEvent } from '../stellar/entities/contract-event.entity.js';
import { ContractEventRetentionProvider } from './providers/contract-event-retention.provider.js';

const expiryJobFailuresCounter = makeCounterProvider({
  name: 'expiry_job_failures_total',
  help: 'Total number of expiry job failures',
});

const contractEventRetentionDeletedCounter = makeCounterProvider({
  name: 'contract_event_retention_deleted_total',
  help: 'Total number of contract event rows deleted by the retention job',
});

const contractEventRetentionFailuresCounter = makeCounterProvider({
  name: 'contract_event_retention_failures_total',
  help: 'Total number of failures in the contract event retention job',
});

@Module({
  imports: [
    TypeOrmModule.forFeature([Account, ContractEvent]),
    StellarModule,
    SweepsModule,
    WebhooksModule,
    AccountEventsModule,
  ],
  providers: [
    SchedulerService,
    AccountReclamationProvider,
    ContractEventRetentionProvider,
    expiryJobFailuresCounter,
    contractEventRetentionDeletedCounter,
    contractEventRetentionFailuresCounter,
  ],
})
export class SchedulerModule {}
