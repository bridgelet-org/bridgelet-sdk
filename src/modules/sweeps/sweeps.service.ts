import { Injectable, Logger } from '@nestjs/common';
import { ValidationProvider } from './providers/validation.provider.js';
import type { ExecuteSweepDto } from './dto/execute-sweep.dto.js';
import type { SweepResult } from './interfaces/sweep-result.interface.js';

@Injectable()
export class SweepsService {
  private readonly logger = new Logger(SweepsService.name);

  constructor(
    private readonly validationProvider: ValidationProvider,
  ) {}

  /**
   * Execute sweep: transfer funds from ephemeral account to permanent wallet
   */
  public async executeSweep(dto: ExecuteSweepDto): Promise<SweepResult> {
    this.logger.log(`Executing sweep for account: ${dto.accountId}`);

    // Step 1: Validate sweep parameters
    await this.validationProvider.validateSweepParameters(dto);

    // TODO: Step 2 - Authorize via contract (Issue #3)
    // TODO: Step 3 - Execute transaction (Issue #4)

    return {
      success: false,
      txHash: '',
      contractAuthHash: '',
      amountSwept: dto.amount,
      destination: dto.destinationAddress,
      timestamp: new Date(),
    };
  }

  /**
   * Check if account can be swept (validation only, no execution)
   */
  public async canSweep(accountId: string, destinationAddress: string): Promise<boolean> {
    return this.validationProvider.canSweep(accountId, destinationAddress);
  }

  /**
   * Get sweep status for an account
   */
  public async getSweepStatus(accountId: string): Promise<{
    canSweep: boolean;
    reason?: string;
  }> {
    return this.validationProvider.getSweepStatus(accountId);
  }
}
