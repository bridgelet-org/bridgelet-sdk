import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { rpc, Contract, TransactionBuilder, BASE_FEE, Networks, xdr } from '@stellar/stellar-sdk';

/** Mirrors the AccountInfo struct from bridgelet-core/shared/types.rs */
export interface AccountInfo {
  creator: string;
  status: 'Active' | 'PaymentReceived' | 'Swept' | 'Expired';
  expiryLedger: number;
  recoveryAddress: string;
  paymentReceived: boolean;
  paymentCount: number;
  payments: Array<{ asset: string; amount: string; timestamp: number }>;
  sweptTo: string | null;
}

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private server: StellarSdk.Horizon.Server;
  private rpcServer: rpc.Server;
  private network: string;
  private networkPassphrase: string;
  private contractId: string;

  constructor(private configService: ConfigService) {
  const horizonUrl =
    this.configService.getOrThrow<string>('stellar.horizonUrl');
  this.network = this.configService.getOrThrow<string>('stellar.network');
  this.server = new StellarSdk.Horizon.Server(horizonUrl);

    const sorobanRpcUrl = this.configService.getOrThrow<string>('stellar.sorobanRpcUrl');
    this.rpcServer = new rpc.Server(sorobanRpcUrl);

    this.networkPassphrase =
      this.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

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

  /**
   * Reads on-chain account state from the EphemeralAccount contract.
   * Uses simulateTransaction (read-only) — no signing or fees required.
   *
   * NOTE: Fund recovery in expireAccount() depends on the token transfer
   * implementation in the contract (currently a stub in bridgelet-core).
   *
   * @param contractId - The deployed EphemeralAccount contract address
   * @returns Typed AccountInfo mirroring the Rust AccountInfo struct
   * @throws InternalServerErrorException if the contract is not initialized or RPC fails
   */
  async getAccountInfo(contractId: string): Promise<AccountInfo> {
    this.logger.log(`Fetching account info for contract: ${contractId}`);

    try {
      const contract = new Contract(contractId);

      // Use a dummy source account for read-only simulation
      const sourceKeypair = StellarSdk.Keypair.random();
      const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), '0');

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('get_info'))
        .setTimeout(30)
        .build();

      const simResult = await this.rpcServer.simulateTransaction(transaction);

      if (rpc.Api.isSimulationError(simResult)) {
        const msg = (simResult as rpc.Api.SimulateTransactionErrorResponse).error;
        if (msg.includes('not initialized') || msg.includes('NotFound')) {
          throw new BadRequestException(
            `Contract ${contractId} is not initialized: ${msg}`,
          );
        }
        throw new Error(`Simulation error: ${msg}`);
      }

      const successResult = simResult as rpc.Api.SimulateTransactionSuccessResponse;
      const returnVal = successResult.result?.retval;

      if (!returnVal) {
        throw new Error('Contract returned no data — contract may not be initialized');
      }

      return this.parseAccountInfo(returnVal);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const typedError = error as Error;
      this.logger.error(`getAccountInfo failed: ${typedError.message}`, typedError.stack);
      throw new InternalServerErrorException(
        `Failed to get account info: ${typedError.message}`,
      );
    }
  }

  /**
   * Expires an on-chain EphemeralAccount, returning funds to the recovery address.
   * Calls EphemeralAccount.expire() on the contract.
   *
   * - Checks current ledger against expiry_ledger before invoking expire().
   * - Error::NotExpired is treated as a non-fatal scheduling race condition.
   * - Error::InvalidStatus is terminal (account already swept or expired).
   *
   * NOTE: Fund recovery depends on the token transfer implementation in the
   * contract (currently a stub in bridgelet-core).
   *
   * @param contractId - The deployed EphemeralAccount contract address
   * @throws BadRequestException for terminal contract errors (InvalidStatus)
   * @throws InternalServerErrorException for RPC or unexpected failures
   */
  async expireAccount(contractId: string): Promise<void> {
    this.logger.log(`Expiring account for contract: ${contractId}`);

    try {
      // Fetch on-chain state to check expiry_ledger before calling expire()
      const info = await this.getAccountInfo(contractId);

      const { latestLedger } = await this.rpcServer.getLatestLedger();

      if (latestLedger < info.expiryLedger) {
        // Non-fatal: scheduler called too early, not yet expired
        this.logger.warn(
          `Contract ${contractId} not yet expired. ` +
          `Current ledger: ${latestLedger}, expiry ledger: ${info.expiryLedger}`,
        );
        return;
      }

      const fundingSecret = this.configService.getOrThrow<string>('stellar.fundingSecret');
      const keypair = StellarSdk.Keypair.fromSecret(fundingSecret);
      const account = await this.rpcServer.getAccount(keypair.publicKey());

      const contract = new Contract(contractId);
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('expire'))
        .setTimeout(30)
        .build();

      transaction.sign(keypair);

      const simResult = await this.rpcServer.simulateTransaction(transaction);

      if (rpc.Api.isSimulationError(simResult)) {
        const msg = (simResult as rpc.Api.SimulateTransactionErrorResponse).error;

        if (msg.includes('NotExpired')) {
          // Race condition: ledger advanced but contract disagrees — non-fatal
          this.logger.warn(`Contract ${contractId} reports NotExpired — scheduling race condition`);
          return;
        }

        if (msg.includes('InvalidStatus')) {
          throw new BadRequestException(
            `Cannot expire contract ${contractId}: account is already swept or expired`,
          );
        }

        throw new Error(`Simulation error: ${msg}`);
      }

      const preparedTx = await rpc.assembleTransaction(
        transaction,
        simResult as rpc.Api.SimulateTransactionSuccessResponse,
      ).build();

      preparedTx.sign(keypair);
      await this.rpcServer.sendTransaction(preparedTx);

      this.logger.log(`Account expired successfully: ${contractId}`);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const typedError = error as Error;
      this.logger.error(`expireAccount failed: ${typedError.message}`, typedError.stack);
      throw new InternalServerErrorException(
        `Failed to expire account: ${typedError.message}`,
      );
    }
  }

  private getNetworkPassphrase(): string {
    return this.network === 'mainnet'
      ? StellarSdk.Networks.PUBLIC
      : StellarSdk.Networks.TESTNET;
  }

  /**
   * Parses the Soroban ScVal map returned by get_info() into a typed AccountInfo.
   */
  private parseAccountInfo(scVal: xdr.ScVal): AccountInfo {
    const map = scVal.map();
    if (!map) {
      throw new Error('Expected ScVal map from get_info()');
    }

    const get = (key: string): xdr.ScVal => {
      const entry = map.find((e) => e.key().sym() === key);
      if (!entry) throw new Error(`Missing field "${key}" in AccountInfo`);
      return entry.val();
    };

    const statusSymbol = get('status').vec()?.[0]?.sym() ?? get('status').sym();

    const paymentsVec = get('payments').vec() ?? [];
    const payments = paymentsVec.map((p) => {
      const pm = p.map()!;
      const pGet = (k: string) => pm.find((e) => e.key().sym() === k)!.val();
      return {
        asset: pGet('asset').str() as string,
        amount: pGet('amount').str() as string,
        timestamp: Number(pGet('timestamp').u64()),
      };
    });

    const sweptToEntry = map.find((e) => e.key().sym() === 'swept_to');
    let sweptTo: string | null = null;
    if (sweptToEntry) {
      const val = sweptToEntry.val();
      // Option<Address> — if it's a vec with one element it's Some(addr)
      const vec = val.vec();
      if (vec && vec.length > 0) {
        sweptTo = StellarSdk.Address.fromScVal(vec[0]).toString();
      }
    }

    return {
      creator: StellarSdk.Address.fromScVal(get('creator')).toString(),
      status: statusSymbol as AccountInfo['status'],
      expiryLedger: get('expiry_ledger').u32(),
      recoveryAddress: StellarSdk.Address.fromScVal(get('recovery_address')).toString(),
      paymentReceived: get('payment_received').b(),
      paymentCount: get('payment_count').u32(),
      payments,
      sweptTo,
    };
  }
}
