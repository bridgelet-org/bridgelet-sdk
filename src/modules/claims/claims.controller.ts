import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
} from '@nestjs/swagger';
import { ClaimsService } from './claims.service.js';
import { ClaimDetailsDto } from './dto/claim-details.dto.js';

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get claim details by ID' })
  @ApiParam({
    name: 'id',
    description: 'Claim UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Claim details retrieved',
    type: ClaimDetailsDto,
  })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  public async findOne(
    @Param('id') id: string,
  ): Promise<ClaimDetailsDto> {
    return this.claimsService.findClaimById(id);
  }
}
