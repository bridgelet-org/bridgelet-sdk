import { ApiProperty } from '@nestjs/swagger';

export class ClaimRedemptionResponseDto {
  @ApiProperty({
    example: true,
    description: 'Whether the claim redemption was successful',
  })
  success: boolean;

  @ApiProperty({
    example: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    description: 'The Stellar transaction hash of the redemption',
  })
  txHash: string;

  @ApiProperty({
    example: '100.0000000',
    description: 'The amount that was transferred to the destination address',
  })
  amountSwept: string;

  @ApiProperty({
    example: 'native',
    description: 'The asset identifier that was transferred',
  })
  asset: string;

  @ApiProperty({
    example: 'GBBD47UZQ5YLQYYTWTCB7X3DUEEVZMDVGFBRNZPMZDWQWKCFN3EOZQKQ',
    description:
      'The destination Stellar wallet address that received the funds',
  })
  destination: string;

  @ApiProperty({
    example: '2026-01-21T15:45:30Z',
    description:
      'The timestamp when the claim was redeemed and funds were swept',
  })
  sweptAt: Date;

  @ApiProperty({
    example: 'Claim successfully redeemed and funds transferred',
    required: false,
    description: 'Optional additional message about the redemption',
  })
  message?: string;
}
