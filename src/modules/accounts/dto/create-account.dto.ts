import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsObject,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAccountDto {
  @ApiProperty({
    example: 'GSENDER...',
    description: 'Funding account public key',
  })
  @IsString()
  @IsNotEmpty()
  fundingSource: string;

  @ApiProperty({ example: '100', description: 'Payment amount' })
  @IsString()
  @IsNotEmpty()
  amount: string;

  @ApiProperty({
    example: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    description: 'Asset in format CODE:ISSUER',
  })
  @IsString()
  @IsNotEmpty()
  asset: string;

  @ApiProperty({
    example: 2592000,
    description: 'Expiry in seconds (1 hour - 30 days)',
  })
  @IsNumber()
  @Min(3600) // 1 hour
  @Max(2592000) // 30 days
  expiresIn: number;

  @ApiProperty({ example: { userId: 'user_123' }, required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
