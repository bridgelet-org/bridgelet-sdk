import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Claim } from '../entities/claim.entity.js';
import { ClaimDetailsDto } from '../dto/claim-details.dto.js';

@Injectable()
export class ClaimLookupProvider {
  private readonly logger = new Logger(ClaimLookupProvider.name);

  constructor(
    @InjectRepository(Claim)
    private readonly claimsRepository: Repository<Claim>,
  ) {}

  async findClaimById(id: string): Promise<ClaimDetailsDto> {
    this.logger.log(`Looking up claim: ${id}`);

    const claim = await this.claimsRepository.findOne({
      where: { id },
      relations: ['account'],
    });

    if (!claim) {
      this.logger.warn(`Claim ${id} not found`);
      throw new NotFoundException(`Claim ${id} not found`);
    }

    this.logger.log(`Claim ${id} retrieved successfully`);

    return {
      id: claim.id,
      accountId: claim.accountId,
      destinationAddress: claim.destinationAddress,
      amountSwept: claim.amountSwept,
      asset: claim.asset,
      sweepTxHash: claim.sweepTxHash,
      claimedAt: claim.claimedAt,
    };
  }
}
