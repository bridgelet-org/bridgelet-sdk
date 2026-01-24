import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus } from '../entities/account.entity.js';

export class AccountResponseDto {
  @ApiProperty()
  accountId: string;

  @ApiProperty()
  publicKey: string;

  @ApiProperty()
  claimUrl: string | null;

  @ApiProperty({ required: false })
  txHash?: string;

  @ApiProperty()
  amount: string;

  @ApiProperty()
  asset: string;

  @ApiProperty({ enum: AccountStatus })
  status: AccountStatus;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ required: false })
  claimedAt?: Date;

  @ApiProperty({ required: false })
  destination?: string;

  @ApiProperty({ required: false })
  metadata?: Record<string, any>;
}
