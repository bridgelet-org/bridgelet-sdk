import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Address,
  xdr,
  hash,
} from '@stellar/stellar-sdk';
import type { AuthorizeSweepParams } from '../interfaces/authorize-sweep-params.interface.js';
import type { ContractAuthResult } from '../interfaces/contract-auth-result.interface.js';

@Injectable()
export class ContractProvider {
  private readonly logger = new Logger(ContractProvider.name);
  private readonly contractId: string;
  private readonly sorobanRpcUrl: string;
  private readonly networkPassphrase: string;

  constructor(private readonly configService: ConfigService) {
    this.contractId = this.configService.getOrThrow<string>(
      'stellar.contracts.ephemeralAccount',
    );
    this.sorobanRpcUrl = this.configService.getOrThrow<string>(
      'stellar.sorobanRpcUrl',
    );

    const network = this.configService.getOrThrow<string>('stellar.network');
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    this.logger.log(`Initialized ContractProvider with contract: ${this.contractId}`);
  }

  /**
   * Authorize sweep via smart contract
   * Calls the contract's sweep() function to validate authorization
   */
  public async authorizeSweep(
    params: AuthorizeSweepParams,
  ): Promise<ContractAuthResult> {
    this.logger.log(
      `Authorizing sweep for account: ${params.ephemeralPublicKey}`,
    );

    try {
      // Create Soroban RPC server connection
      const server = new SorobanRpc.Server(this.sorobanRpcUrl);

      // Create contract instance
      const contract = new Contract(this.contractId);

      // Prepare destination address parameter
      const destination = Address.fromString(params.destinationAddress);

      // Generate authorization signature
      // In production, this would be signed by an authorized key
      // For MVP, we create a dummy signature
      const authSignature = this.generateAuthSignature(params);

      // Build contract invocation transaction
      const account = await server.getAccount(params.ephemeralPublicKey);

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'sweep',
            destination.toScVal(),
            xdr.ScVal.scvBytes(authSignature),
          ),
        )
        .setTimeout(30)
        .build();

      // Simulate contract call first
      const simulated = await server.simulateTransaction(transaction);

      if (SorobanRpc.Api.isSimulationError(simulated)) {
        throw new Error(`Contract simulation failed: ${simulated.error}`);
      }

      // For MVP, we don't actually submit this transaction
      // The sweep will be handled by direct Stellar payment
      // In production, this would be submitted to enforce on-chain authorization

      this.logger.log('Contract authorization successful');

      return {
        authorized: true,
        hash: 'contract-auth-hash', // Would be actual tx hash in production
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Contract authorization failed: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        `Contract authorization failed: ${error.message}`,
      );
    }
  }

  /**
   * Generate authorization signature for sweep
   * In production: Sign with authorized private key
   * For MVP: Generate dummy signature
   */
  private generateAuthSignature(params: AuthorizeSweepParams): Buffer {
    // TODO: Implement proper signature generation
    // Should sign hash of (ephemeralPublicKey + destinationAddress + timestamp)
    // with SDK's authorized signing key

    // For MVP: Return dummy 64-byte signature
    const message = `${params.ephemeralPublicKey}:${params.destinationAddress}`;
    const messageHash = hash(Buffer.from(message));

    // Pad to 64 bytes
    const signature = Buffer.alloc(64);
    messageHash.copy(signature, 0);

    return signature;
  }

  /**
   * Check contract status and version
   */
  public async getContractInfo(): Promise<{ contractId: string; version: string }> {
    return {
      contractId: this.contractId,
      version: '0.1.0',
    };
  private generateAuthHash(ephemeralKey: string, destination: string): string {
    // Simple hash generation for demonstration
    // In production, use proper cryptographic hashing
    const combined = `${ephemeralKey}:${destination}:${Date.now()}`;
    let hash = '';
    for (let i = 0; i < 64; i++) {
      const charCode = combined.charCodeAt(i % combined.length);
      hash += ((charCode * (i + 1)) % 16).toString(16);
    }
    return hash;
  }
}
