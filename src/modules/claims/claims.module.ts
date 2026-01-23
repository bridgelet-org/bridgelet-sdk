// src/modules/claims/claims.module.ts

import { Module } from '@nestjs/module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClaimsController } from './claims.controller.js';
import { ClaimsService } from './claims.service.js';
import { Claim } from './entities/claim.entity.js';
import { Account } from '../accounts/entities/account.entity.js';
import { TokenVerificationProvider } from './providers/token-verification.provider.js';
import { ClaimRedemptionProvider } from './providers/claim-redemption.provider.js';
import { SweepsModule } from '../sweeps/sweeps.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Claim, Account]),
    SweepsModule,
    WebhooksModule,
  ],
  controllers: [ClaimsController],
  providers: [
    ClaimsService,
    TokenVerificationProvider,
    ClaimRedemptionProvider,
  ],
  exports: [ClaimsService],
})
export class ClaimsModule {}
