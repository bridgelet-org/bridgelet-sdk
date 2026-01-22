import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClaimsController } from './claims.controller.js';
import { ClaimsService } from './claims.service.js';
import { Claim } from './entities/claim.entity.js';
import { Account } from '../accounts/entities/account.entity.js';

import { ClaimLookupProvider } from './providers/claim-lookup.provider.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Claim, Account]),
  ],
  controllers: [ClaimsController],
  providers: [
    ClaimsService,
    ClaimLookupProvider,
  ],
  exports: [ClaimsService],
})
export class ClaimsModule {}
