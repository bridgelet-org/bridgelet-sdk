import { Injectable, Logger } from '@nestjs/common';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import { TransactionProvider } from './providers/transaction.provider.js';
import type { ExecuteSweepDto } from './dto/execute-sweep.dto.js';
import type { SweepResult } from './interfaces/sweep-result.interface.js';

@Injectable()
export class SweepsService {
  private readonly logger = new Logger(SweepsService.name);

  constructor(
    private readonly validationProvider: ValidationProvider,
    private readonly contractProvider: ContractProvider,
    private readonly transactionProvider: TransactionProvider,
  ) {}

  /**
   * Execute sweep: transfer funds from ephemeral account to permanent wallet
   */
  public async executeSweep(dto: ExecuteSweepDto): Promise<SweepResult> {
    this.logger.log(`Executing sweep for account: ${dto.accountId}`);

    // Step 1: Validate sweep parameters
    await this.validationProvider.validateSweepParameters(dto);

    // Step 2: Authorize sweep via contract
    const authResult = await this.contractProvider.authorizeSweep({
      ephemeralPublicKey: dto.ephemeralPublicKey,
      destinationAddress: dto.destinationAddress,
    });

    // Step 3: Execute on-chain transfer
    const txResult = await this.transactionProvider.executeSweepTransaction({
      ephemeralSecret: dto.ephemeralSecret,
      destinationAddress: dto.destinationAddress,
      amount: dto.amount,
      asset: dto.asset,
    });

    // Step 4: Optionally merge account to reclaim reserve
    try {
      await this.transactionProvider.mergeAccount({
        ephemeralSecret: dto.ephemeralSecret,
        destinationAddress: dto.destinationAddress,
      });
    } catch (error) {
      this.logger.warn(`Account merge failed (non-critical): ${error.message}`);
      // Continue even if merge fails - sweep was successful
    }

    this.logger.log(`Sweep completed successfully: ${txResult.hash}`);

    return {
      success: true,
      txHash: txResult.hash,
      contractAuthHash: authResult.hash,
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
