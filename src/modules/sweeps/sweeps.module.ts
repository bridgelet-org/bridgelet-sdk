import { Module } from '@nestjs/module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SweepsService } from './sweeps.service.js';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import { Account } from '../accounts/entities/account.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Account])],
  providers: [SweepsService, ValidationProvider, ContractProvider],
  exports: [SweepsService],
})
export class SweepsModule {}
Update src/config/stellar.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('stellar', () => ({
  network: process.env.STELLAR_NETWORK ?? 'testnet',
  horizonUrl: process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: process.env.STELLAR_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  fundingSecret: process.env.STELLAR_FUNDING_SECRET,
  contracts: {
    ephemeralAccount: process.env.EPHEMERAL_ACCOUNT_CONTRACT_ID,
  },
}));
