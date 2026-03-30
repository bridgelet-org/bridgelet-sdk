import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import {
  Contract,
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Address,
  nativeToScVal,
} from '@stellar/stellar-sdk';
@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private server: StellarSdk.Horizon.Server;
  private sorobanServer: rpc.Server;
  private network: string;
  private readonly contractId: string;

  constructor(private configService: ConfigService) {
  const horizonUrl =
    this.configService.getOrThrow<string>('stellar.horizonUrl');
  this.network = this.configService.getOrThrow<string>('stellar.network');
  this.server = new StellarSdk.Horizon.Server(horizonUrl);

  const sorobanRpcUrl = this.configService.getOrThrow<string>(
    'stellar.sorobanRpcUrl',
  );
  this.sorobanServer = new rpc.Server(sorobanRpcUrl);
  this.contractId = this.configService.getOrThrow<string>(
    'stellar.contracts.ephemeralAccount',
  );

  this.logger.log(`Initialized Stellar service for ${this.network}`);
}

  generateKeypair(): StellarSdk.Keypair {
    return StellarSdk.Keypair.random();
  }

  async createEphemeralAccount(params: {
  publicKey: string;
  secretKey: string;
  amount: string;
  asset: string;
  expiresAt: Date;
  expiresIn: number;
  fundingSource: string;
}): Promise<string> : Promise<string> {
    this.logger.log(`Creating ephemeral account: ${params.publicKey}`);

    const fundingSecret = this.configService.getOrThrow<string>(
      'stellar.fundingSecret',
    );
    const fundingKeypair = StellarSdk.Keypair.fromSecret(fundingSecret);

    // console.log(`funding secret: ${fundingSecret}`);

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

    this.logger.log(`Account created: ${result.hash}`);

// Call initialize() on the Soroban contract immediately after account creation
await this.initializeEphemeralAccount({
  ephemeralPublicKey: params.publicKey,
  ephemeralSecretKey: params.secretKey,
  expiresIn: params.expiresIn,
  fundingSource: params.fundingSource,
});

return result.hash;
  }
private async getCurrentLedger(): Promise<number> {
  const latestLedger = await this.sorobanServer.getLatestLedger();
  return latestLedger.sequence;
}

private async initializeEphemeralAccount(params: {
  ephemeralPublicKey: string;
  ephemeralSecretKey: string;
  expiresIn: number;
  fundingSource: string;
}): Promise<void> {
  this.logger.log(
    `Initializing contract for account: ${params.ephemeralPublicKey}`,
  );

  // Get current ledger number from the blockchain
  const currentLedger = await this.getCurrentLedger();

  // Stellar produces ~1 ledger every 5 seconds
  // Convert expiresIn (seconds) to ledger count
  const LEDGER_CLOSE_TIME_SECONDS = 5;
  const expiryLedger =
    currentLedger +
    Math.ceil(params.expiresIn / LEDGER_CLOSE_TIME_SECONDS);

  // Build the keypair from the secret so we can sign the transaction
  const ephemeralKeypair = StellarSdk.Keypair.fromSecret(
    params.ephemeralSecretKey,
  );

  // Load the ephemeral account from Soroban RPC
  const ephemeralAccount = await this.sorobanServer.getAccount(
    params.ephemeralPublicKey,
  );

  // Create contract instance
  const contract = new Contract(this.contractId);

  // Build the initialize() transaction
  const transaction = new TransactionBuilder(ephemeralAccount, {
    fee: BASE_FEE,
    networkPassphrase: this.getNetworkPassphrase(),
  })
    .addOperation(
      contract.call(
        'initialize',
        Address.fromString(params.ephemeralPublicKey).toScVal(), // creator
        nativeToScVal(expiryLedger, { type: 'u32' }),            // expiry_ledger
        Address.fromString(params.fundingSource).toScVal(),      // recovery_address
      ),
    )
    .setTimeout(30)
    .build();

  // Simulate the transaction first to check for errors
  const simulated = await this.sorobanServer.simulateTransaction(transaction);

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`Contract initialization failed: ${simulated.error}`);
  }

  // Prepare and sign the transaction
  const preparedTx = rpc
    .assembleTransaction(transaction, simulated)
    .build();
  preparedTx.sign(ephemeralKeypair);

  // Submit to the network
  const contractResult = await this.sorobanServer.sendTransaction(preparedTx);

  if (contractResult.status === 'ERROR') {
    throw new Error(
      `Contract initialization failed on-chain: ${JSON.stringify(contractResult.errorResult)}`,
    );
  }

  this.logger.log(
    `Contract initialized successfully for: ${params.ephemeralPublicKey}`,
  );
}
  private getNetworkPassphrase(): string {
    return this.network === 'mainnet'
      ? StellarSdk.Networks.PUBLIC
      : StellarSdk.Networks.TESTNET;
  }
}
