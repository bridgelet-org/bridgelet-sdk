// src/modules/claims/claims.controller.ts

import { Controller, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClaimsService } from './claims.service.js';
import { VerifyClaimDto } from './dto/verify-claim.dto.js';
import { RedeemClaimDto } from './dto/redeem-claim.dto.js';
import { ClaimVerificationResponseDto } from './dto/claim-verification-response.dto.js';
import { ClaimRedemptionResponseDto } from './dto/claim-redemption-response.dto.js';

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Post('verify')
  @ApiOperation({ summary: 'Verify claim token validity' })
  @ApiResponse({
    status: 200,
    description: 'Token is valid and claim is available',
    type: ClaimVerificationResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  @ApiResponse({ status: 400, description: 'Account has not received payment' })
  @ApiResponse({ status: 409, description: 'Claim already redeemed' })
  async verify(@Body() verifyClaimDto: VerifyClaimDto): Promise<ClaimVerificationResponseDto> {
    return this.claimsService.verifyClaimToken(verifyClaimDto.claimToken);
  }

  @Post('redeem')
  @ApiOperation({ summary: 'Redeem claim and sweep funds to destination wallet' })
  @ApiResponse({
    status: 200,
    description: 'Claim redeemed successfully',
    type: ClaimRedemptionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  @ApiResponse({ status: 400, description: 'Invalid destination address' })
  @ApiResponse({ status: 409, description: 'Claim already redeemed' })
  public async redeem(@Body() redeemClaimDto: RedeemClaimDto): Promise<ClaimRedemptionResponseDto> {
    return this.claimsService.redeemClaim(
      redeemClaimDto.claimToken,
      redeemClaimDto.destinationAddress,
    );
  }
}
@Get(':id')
  @ApiOperation({ summary: 'Get claim details by ID' })
  @ApiParam({ name: 'id', description: 'Claim UUID', type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Claim details retrieved',
    type: ClaimDetailsDto,
  })
  @ApiResponse({ status: 404, description: 'Claim not found' }) 
public async findOne(@Param('id') id: string): Promise<ClaimDetailsDto> { return this.claimsService.findClaimById(id); } }
