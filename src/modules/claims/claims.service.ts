// src / modules / claims / claims.service.ts;

import { Injectable } from '@nestjs/common';
import { TokenVerificationProvider } from './providers/token-verification.provider.js';
import { ClaimRedemptionProvider } from './providers/claim-redemption.provider.js';
import { ClaimVerificationResponseDto } from './dto/claim-verification-response.dto.js';
import { ClaimRedemptionResponseDto } from './dto/claim-redemption-response.dto.js';

@Injectable()
export class ClaimsService {
  constructor(
    private tokenVerificationProvider: TokenVerificationProvider,
    private claimRedemptionProvider: ClaimRedemptionProvider,
  ) {}

  public async verifyClaimToken(
    token: string,
  ): Promise<ClaimVerificationResponseDto> {
    return this.tokenVerificationProvider.verifyClaimToken(token);
  }

  public async redeemClaim(
    token: string,
    destinationAddress: string,
  ): Promise<ClaimRedemptionResponseDto> {
    return this.claimRedemptionProvider.redeemClaim(token, destinationAddress);
  }
}
