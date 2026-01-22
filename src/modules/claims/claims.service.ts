import { Injectable } from '@nestjs/common';
import { ClaimLookupProvider } from './providers/claim-lookup.provider.js';
import { ClaimDetailsDto } from './dto/claim-details.dto.js';

@Injectable()
export class ClaimsService {
  constructor(
    private readonly claimLookupProvider: ClaimLookupProvider,
  ) {}

  public async findClaimById(id: string): Promise<ClaimDetailsDto> {
    return this.claimLookupProvider.findClaimById(id);
  }
}
