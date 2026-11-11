import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity.js';
import { StellarModule } from '../stellar/stellar.module.js';
import { PaymentMonitorService } from './payment-monitor.service.js';
import { AccountEventsModule } from '../account-events/account-events.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account]),
    StellarModule,
    AccountEventsModule,
  ],
  providers: [PaymentMonitorService],
})
export class PaymentMonitorModule {}
