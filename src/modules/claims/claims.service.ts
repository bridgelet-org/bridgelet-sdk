import { Injectable } from '@nestjs/common';
import { ClaimLookupProvider } from './providers/claim-lookup.provider.js';
import { ClaimDetailsDto } from './dto/claim-details.dto.js';
import { ClaimRedemptionProvider } from './providers/claim-redemption.provider.js';
import { ClaimRedemptionResponseDto } from './dto/claim-redemption-response.dto.js';

@Injectable()
export class ClaimsService {
  constructor(
    private readonly claimLookupProvider: ClaimLookupProvider,
    private claimRedemptionProvider: ClaimRedemptionProvider,
  ) {}

  public async findClaimById(id: string): Promise<ClaimDetailsDto> {
    return this.claimLookupProvider.findClaimById(id);
  }

  public async redeemClaim(
    token: string,
    destinationAddress: string,
  ): Promise<ClaimRedemptionResponseDto> {
    return this.claimRedemptionProvider.redeemClaim(token, destinationAddress);
  }
}
