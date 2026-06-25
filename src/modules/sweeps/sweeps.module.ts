import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SweepsService } from './sweeps.service.js';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import { TransactionProvider } from './providers/transaction.provider.js';
import { SweepMetricsProvider } from './providers/sweep-metrics.provider.js';
import { Account } from '../accounts/entities/account.entity.js';
import { StellarModule } from '../stellar/stellar.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Account]), StellarModule],
  providers: [
    SweepsService,
    ValidationProvider,
    ContractProvider,
    TransactionProvider,
    SweepMetricsProvider,
  ],
  exports: [SweepsService],
})
export class SweepsModule {}
