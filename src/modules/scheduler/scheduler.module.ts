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

const expiryJobFailuresCounter = makeCounterProvider({
  name: 'expiry_job_failures_total',
  help: 'Total number of expiry job failures',
});

@Module({
  imports: [
    TypeOrmModule.forFeature([Account]),
    StellarModule,
    SweepsModule,
    WebhooksModule,
    AccountEventsModule,
  ],
  providers: [
    SchedulerService,
    AccountReclamationProvider,
    expiryJobFailuresCounter,
  ],
})
export class SchedulerModule {}
