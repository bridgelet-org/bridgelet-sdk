import { Injectable } from '@nestjs/common';
import { ClaimLookupProvider } from './providers/claim-lookup.provider.js';
import { TokenVerificationProvider } from './providers/token-verification.provider.js';
import { ClaimDetailsDto } from './dto/claim-details.dto.js';
import { ClaimVerificationResponseDto } from './dto/claim-verification-response.dto.js';
import { ClaimRedemptionProvider } from './providers/claim-redemption.provider.js';
import { ClaimRedemptionResponseDto } from './dto/claim-redemption-response.dto.js';

@Injectable()
export class ClaimsService {
  constructor(
    private readonly claimLookupProvider: ClaimLookupProvider,
    private readonly tokenVerificationProvider: TokenVerificationProvider,
    private claimRedemptionProvider: ClaimRedemptionProvider,
  ) {}

  public async findClaimById(id: string): Promise<ClaimDetailsDto> {
    return this.claimLookupProvider.findClaimById(id);
  }

  public async verifyClaimToken(token: string): Promise<ClaimVerificationResponseDto> {
    return this.tokenVerificationProvider.verifyClaimToken(token);
  public async redeemClaim(
    token: string,
    destinationAddress: string,
  ): Promise<ClaimRedemptionResponseDto> {
    return this.claimRedemptionProvider.redeemClaim(token, destinationAddress);
  }
}
