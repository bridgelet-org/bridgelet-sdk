import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity.js';
import { StellarModule } from '../stellar/stellar.module.js';
import { SchedulerService } from './scheduler.service.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { AccountEventsModule } from '../account-events/account-events.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account]),
    StellarModule,
    WebhooksModule,
    AccountEventsModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
