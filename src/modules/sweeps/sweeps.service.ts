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
   * 
   * Workflow:
   * 1. Validate sweep parameters (security: fail fast)
   * 2. Authorize sweep via contract (on-chain authorization)
   * 3. Execute payment transaction (transfer funds)
   * 4. Merge ephemeral account (reclaim base reserve, non-critical)
   */
  public async executeSweep(dto: ExecuteSweepDto): Promise<SweepResult> {
    this.logger.log(`Executing sweep for account: ${dto.accountId}`);

    try {
      // Step 1: Validate sweep parameters
      this.logger.debug(`Validating sweep parameters for account: ${dto.accountId}`);
      await this.validationProvider.validateSweepParameters(dto);
      this.logger.debug(`Validation passed for account: ${dto.accountId}`);

      // Step 2: Authorize sweep via contract
      this.logger.debug(`Authorizing sweep for account: ${dto.accountId}`);
      const authResult = await this.contractProvider.authorizeSweep({
        ephemeralPublicKey: dto.ephemeralPublicKey,
        destinationAddress: dto.destinationAddress,
      });
      this.logger.log(
        `Sweep authorization completed for account: ${dto.accountId}, auth hash: ${authResult.hash}`,
      );

      // Step 3: Execute payment transaction
      this.logger.debug(`Executing payment transaction for account: ${dto.accountId}`);
      const txResult = await this.transactionProvider.executeSweepTransaction({
        ephemeralSecret: dto.ephemeralSecret,
        destinationAddress: dto.destinationAddress,
        amount: dto.amount,
        asset: dto.asset,
      });
      this.logger.log(
        `Payment transaction executed for account: ${dto.accountId}, tx hash: ${txResult.hash}`,
      );

      // Step 4: Merge ephemeral account (non-critical, errors caught)
      try {
        this.logger.debug(`Attempting account merge for account: ${dto.accountId}`);
        await this.transactionProvider.mergeAccount({
          ephemeralSecret: dto.ephemeralSecret,
          destinationAddress: dto.destinationAddress,
        });
        this.logger.log(`Account merge completed for account: ${dto.accountId}`);
      } catch (mergeError) {
        this.logger.warn(
          `Account merge failed for account: ${dto.accountId}, but sweep succeeded. Error: ${mergeError instanceof Error ? mergeError.message : String(mergeError)}`,
        );
        // Don't throw - merge is non-critical
      }

      return {
        success: true,
        txHash: txResult.hash,
        contractAuthHash: authResult.hash,
        amountSwept: dto.amount,
        destination: dto.destinationAddress,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Sweep execution failed for account: ${dto.accountId}. Error: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
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
