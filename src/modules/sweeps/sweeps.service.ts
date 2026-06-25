import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import { TransactionProvider } from './providers/transaction.provider.js';
import { StellarService } from '../stellar/stellar.service.js';
import type { SweepExecutionRequest } from './interfaces/execute-sweep.interface.js';
import type { SweepResult } from './interfaces/sweep-result.interface.js';
import { TransactionResult } from './interfaces/transaction-result.interface.js';
import { SweepMetricsProvider } from './providers/sweep-metrics.provider.js';

@Injectable()
export class SweepsService {
  private readonly logger = new Logger(SweepsService.name);

  constructor(
    private readonly validationProvider: ValidationProvider,
    private readonly contractProvider: ContractProvider,
    private readonly transactionProvider: TransactionProvider,
    private readonly stellarService: StellarService,
    private readonly configService: ConfigService,
    private readonly sweepMetrics: SweepMetricsProvider,
  ) {}

  /**
   * Execute sweep: authorize on-chain via SweepController contract, then
   * transfer funds via a classic Horizon payment.
   *
   * Flow:
   * Order of operations is strict and intentional:
   *   1. Validate sweep parameters
   *   2. Generate auth signature (MVP stub — see ContractProvider)
   *   3. Submit SweepController.execute_sweep() on Soroban
   *   4. Execute the Horizon payment to move funds
   *
   * ⚠️ If Step 3 succeeds but Step 4 fails, the contract will be in Swept
   * state but no funds will have moved. This is logged as a critical error
   * for manual recovery. Do not retry automatically.
   */
  public async executeSweep(
    sweepExecutionRequest: SweepExecutionRequest,
  ): Promise<SweepResult> {
    this.logger.log(
      `Executing sweep for account: ${sweepExecutionRequest.accountId}`,
    );

    // Step 1: Validate sweep parameters
    await this.validationProvider.validateSweepParameters(
      sweepExecutionRequest,
    );

    // Step 2: Generate authorization signature for the contract call
    const authSignature = this.contractProvider.generateAuthSignature({
      ephemeralPublicKey: sweepExecutionRequest.ephemeralPublicKey,
      destinationAddress: sweepExecutionRequest.destinationAddress,
    });

    // Step 3: Submit execute_sweep() on the SweepController Soroban contract
    const sweepControllerContractId = this.configService.getOrThrow<string>(
      'stellar.contracts.sweepController',
    );
    const ephemeralAccountContractId = this.configService.getOrThrow<string>(
      'stellar.contracts.ephemeralAccount',
    );

    await this.stellarService.executeSweep({
      sweepControllerContractId,
      ephemeralAccountContractId,
      destination: sweepExecutionRequest.destinationAddress,
      authSignature,
      signerSecret: sweepExecutionRequest.ephemeralSecret,
    });

    this.logger.log(
      `Contract sweep authorized for account ${sweepExecutionRequest.accountId}`,
    );

    // Compute auth hash before Step 4 so it's available in the catch block
    const contractAuthHash = this.contractProvider.generateAuthHash(
      sweepExecutionRequest.ephemeralPublicKey,
      sweepExecutionRequest.destinationAddress,
    );

    // Step 4: Execute the classic Horizon payment to move funds
    let transactionResult: TransactionResult;
    try {
      transactionResult =
        await this.transactionProvider.executeSweepTransaction({
          ephemeralSecret: sweepExecutionRequest.ephemeralSecret,
          destinationAddress: sweepExecutionRequest.destinationAddress,
          amount: sweepExecutionRequest.amount,
          asset: sweepExecutionRequest.asset,
        });
    } catch (error) {
      // Contract is now in Swept state but funds did not move.
      // This requires manual recovery — log with full context.
      this.logger.error(
        `CRITICAL: Contract authorized but transaction failed for account ` +
          `${sweepExecutionRequest.accountId}. Contract auth hash: ${contractAuthHash}. ` +
          `Error: ${(error as Error).message}`,
        (error as Error).stack,
      );
      this.sweepMetrics.recordFailed();
      throw error;
    }

    this.logger.log(`Sweep complete: txHash=${transactionResult.hash}`);
    this.sweepMetrics.recordCompleted();

    return {
      success: true,
      txHash: transactionResult.hash,
      contractAuthHash,
      amountSwept: sweepExecutionRequest.amount,
      destination: sweepExecutionRequest.destinationAddress,
      timestamp: transactionResult.timestamp,
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
