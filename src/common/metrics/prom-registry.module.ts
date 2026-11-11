import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { register, Registry } from 'prom-client';
import { Account } from '../../modules/accounts/entities/account.entity.js';
import { AccountMetricsProvider } from './account-metrics.provider.js';
import { PaymentMonitorHealthProvider } from './payment-monitor-health.provider.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Account])],
  providers: [
    { provide: Registry, useValue: register },
    AccountMetricsProvider,
    PaymentMonitorHealthProvider,
  ],
  exports: [Registry, AccountMetricsProvider, PaymentMonitorHealthProvider],
})
export class PromRegistryModule {}
