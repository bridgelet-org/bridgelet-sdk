import { ApiProperty } from '@nestjs/swagger';
import type { AccountEventType } from '../entities/account-event.entity.js';

export class AccountEventResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  accountId: string;

  @ApiProperty({
    enum: [
      'created',
      'contract_deployed',
      'funded',
      'claim_started',
      'claimed',
      'claim_failed',
      'partial_sweep',
      'expired',
      'reclaimed',
      'failed',
    ],
  })
  type: AccountEventType;

  @ApiProperty({ nullable: true, required: false })
  txHash: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  details: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;
}
