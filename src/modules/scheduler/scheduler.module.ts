import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity.js';
import { StellarModule } from '../stellar/stellar.module.js';
import { SchedulerService } from './scheduler.service.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';

const expiryJobFailuresCounter = makeCounterProvider({
  name: 'expiry_job_failures_total',
  help: 'Total number of expiry job failures',
});

@Module({
  imports: [TypeOrmModule.forFeature([Account]), StellarModule, WebhooksModule],
  providers: [SchedulerService, expiryJobFailuresCounter],
})
export class SchedulerModule {}
