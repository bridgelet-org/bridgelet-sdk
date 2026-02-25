import { Injectable, Logger } from '@nestjs/common';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import type { SweepExecutionRequest } from './dto/execute-sweep.command.js';
import type { SweepResult } from './interfaces/sweep-result.interface.js';

@Injectable()
export class SweepsService {
  private readonly logger = new Logger(SweepsService.name);

  constructor(
    private readonly validationProvider: ValidationProvider,
    private readonly contractProvider: ContractProvider,
  ) {}

  /**
   * Execute sweep: transfer funds from ephemeral account to permanent wallet
   */
  public async executeSweep(
    sweepExecutionRequest: SweepExecutionRequest,
  ): Promise<SweepResult> {
    this.logger.log(`Executing sweep for account: ${sweepExecutionRequest.accountId}`);

    // Step 1: Validate sweep parameters
    await this.validationProvider.validateSweepParameters(sweepExecutionRequest);

    // Step 2: Authorize sweep via contract
    const authResult = await this.contractProvider.authorizeSweep({
      ephemeralPublicKey: sweepExecutionRequest.ephemeralPublicKey,
      destinationAddress: sweepExecutionRequest.destinationAddress,
    });

    // TODO: Step 3 - Execute transaction (another issue)

    this.logger.log('Sweep authorization completed');

    return {
      success: true,
      txHash: 'pending',
      contractAuthHash: authResult.hash,
      amountSwept: sweepExecutionRequest.amount,
      destination: sweepExecutionRequest.destinationAddress,
      timestamp: new Date(),
    };
  }

  /**
   * Check if account can be swept (validation only, no execution)
   */
  public async canSweep(
    accountId: string,
    destinationAddress: string,
  ): Promise<boolean> {
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
