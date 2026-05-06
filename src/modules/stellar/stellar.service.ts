import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private server: StellarSdk.Horizon.Server;
  private sorobanServer: SorobanRpc.Server;
  private network: string;

  constructor(private configService: ConfigService) {
    const horizonUrl =
      this.configService.getOrThrow<string>('stellar.horizonUrl');
    const sorobanRpcUrl = this.configService.getOrThrow<string>(
      'stellar.sorobanRpcUrl',
    );
    this.network = this.configService.getOrThrow<string>('stellar.network');
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.sorobanServer = new SorobanRpc.Server(sorobanRpcUrl);

    this.logger.log(`Initialized Stellar service for ${this.network}`);
  }

  /**
   * Fetches the current ledger sequence number from Horizon.
   * Used to convert wall-clock expiry times to ledger-based expiry
   * required by EphemeralAccount.initialize() on-chain.
   *
   * Stellar closes a ledger approximately every 5 seconds.
   * Conversion: expiry_ledger = current_ledger + Math.ceil(expiresInSeconds / 5)
   */
  async getCurrentLedger(): Promise<number> {
    const ledgerPage = await this.server
      .ledgers()
      .order('desc')
      .limit(1)
      .call();

    const sequence = ledgerPage.records[0].sequence;
    this.logger.debug(`Current ledger sequence: ${sequence}`);
    return sequence;
  }

  /**
   * Converts a seconds-based expiry duration to a Stellar ledger sequence number.
   * Adds a small buffer (10 ledgers) to account for submission latency.
   */
  async toExpiryLedger(expiresInSeconds: number): Promise<number> {
    const currentLedger = await this.getCurrentLedger();
    const buffer = 10;
    return currentLedger + Math.ceil(expiresInSeconds / 5) + buffer;
  }

  generateKeypair(): StellarSdk.Keypair {
    return StellarSdk.Keypair.random();
  }

  /**
   * Creates a funded ephemeral Stellar account and initializes the
   * EphemeralAccount Soroban contract with expiry and recovery restrictions.
   *
   * The two operations are:
   * 1. Horizon: CreateAccount operation (funds the account with base reserve)
   * 2. Soroban: EphemeralAccount.initialize() (sets on-chain restrictions)
   *
   * If the contract initialization fails after the Horizon transaction succeeds,
   * an error is thrown so the caller (AccountsService) can avoid persisting
   * a record for an unrestricted account.
   *
   * ⚠️ MVP Note: True atomicity between Horizon and Soroban is not possible.
   * A failed initialize() after a successful createAccount() will leave an
   * unrestricted funded account on-chain. Issue #15 tracks the compensation strategy.
   */
  async createEphemeralAccount(params: {
    publicKey: string;
    amount: string;
    asset: string;
    expiresIn: number; // seconds — was expiresAt: Date, now used for ledger conversion
    recoveryAddress: string; // maps to fundingSource from CreateAccountDto
    contractId: string; // deployed EphemeralAccount contract address
    fundingKeypairSecret?: string; // optional override for testing
  }): Promise<string> {
    this.logger.log(`Creating ephemeral account: ${params.publicKey}`);

    const fundingSecret =
      params.fundingKeypairSecret ??
      this.configService.getOrThrow<string>('stellar.fundingSecret');
    const fundingKeypair = StellarSdk.Keypair.fromSecret(fundingSecret);

    // Step 1: Create account on Stellar classic (Horizon)
    const fundingAccount = await this.server.loadAccount(
      fundingKeypair.publicKey(),
    );

    const transaction = new StellarSdk.TransactionBuilder(fundingAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        StellarSdk.Operation.createAccount({
          destination: params.publicKey,
          startingBalance: '2',
        }),
      )
      .setTimeout(30)
      .build();

    transaction.sign(fundingKeypair);
    const result = await this.server.submitTransaction(transaction);
    this.logger.log(`Horizon account created: ${result.hash}`);

    // Step 2: Initialize the Soroban contract with restrictions
    const expiryLedger = await this.toExpiryLedger(params.expiresIn);

    const contract = new StellarSdk.Contract(params.contractId);
    const sourceAccount = await this.sorobanServer.getAccount(
      fundingKeypair.publicKey(),
    );

    const initTransaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        contract.call(
          'initialize',
          StellarSdk.Address.fromString(fundingKeypair.publicKey()).toScVal(), // creator
          StellarSdk.xdr.ScVal.scvU32(expiryLedger), // expiry_ledger
          StellarSdk.Address.fromString(params.recoveryAddress).toScVal(), // recovery_address
        ),
      )
      .setTimeout(30)
      .build();

    const preparedTx =
      await this.sorobanServer.prepareTransaction(initTransaction);
    preparedTx.sign(fundingKeypair);

    const initResult = await this.sorobanServer.sendTransaction(preparedTx);

    if (initResult.status === 'ERROR') {
      this.logger.error(
        `Contract initialize() failed for ${params.publicKey}: ${JSON.stringify(initResult.errorResult)}`,
      );
      throw new Error(
        `Contract initialization failed: ${JSON.stringify(initResult.errorResult ?? 'unknown')}`,
      );
    }

    // Poll for confirmation
    await this.waitForTransaction(initResult.hash);

    this.logger.log(
      `Contract initialized for ${params.publicKey}, expiry ledger: ${expiryLedger}`,
    );
    return result.hash;
  }

  /**
   * Polls Soroban RPC until a transaction is confirmed or fails.
   * Used after sendTransaction() which is async by nature.
   */
  private async waitForTransaction(
    txHash: string,
    maxAttempts = 10,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const status = await this.sorobanServer.getTransaction(txHash);

      if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return;
      if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction ${txHash} failed on-chain`);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(
      `Transaction ${txHash} not confirmed after ${maxAttempts} attempts`,
    );
  }

  private getNetworkPassphrase(): string {
    return this.network === 'mainnet'
      ? StellarSdk.Networks.PUBLIC
      : StellarSdk.Networks.TESTNET;
  }
}
