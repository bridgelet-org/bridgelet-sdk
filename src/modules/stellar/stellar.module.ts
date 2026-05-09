import { Module } from '@nestjs/common';
import { StellarService } from './stellar.service.js';
import { PaymentMonitorProvider } from './providers/payment-monitor-provider.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Account])],
  providers: [StellarService, PaymentMonitorProvider],
  exports: [StellarService, PaymentMonitorProvider],
})
export class StellarModule {}
