import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthorizeSweepParams } from '../interfaces/authorize-sweep-params.interface.js';
import type { ContractAuthResult } from '../interfaces/contract-auth-result.interface.js';

@Injectable()
export class ContractProvider {
  private readonly logger = new Logger(ContractProvider.name);
  private readonly contractId: string;

  constructor(private readonly configService: ConfigService) {
    this.contractId = this.configService.get<string>('stellar.contractId', '');
    this.logger.log('Initialized ContractProvider');
  }

  /**
   * Authorize sweep via smart contract
   * This validates that the sweep is authorized before execution
   */
  public async authorizeSweep(
    params: AuthorizeSweepParams,
  ): Promise<ContractAuthResult> {
    this.logger.log(
      `Authorizing sweep for ephemeral key: ${params.ephemeralPublicKey}`,
    );

    try {
      // In a full implementation, this would interact with a Soroban smart contract
      // to verify authorization for the sweep operation.
      // For now, we implement a basic authorization check.

      // Validate the ephemeral public key format
      if (!this.isValidStellarAddress(params.ephemeralPublicKey)) {
        throw new Error('Invalid ephemeral public key format');
      }

      // Validate the destination address format
      if (!this.isValidStellarAddress(params.destinationAddress)) {
        throw new Error('Invalid destination address format');
      }

      // Generate a mock authorization hash
      // In production, this would be the transaction hash from the contract call
      const authHash = this.generateAuthHash(
        params.ephemeralPublicKey,
        params.destinationAddress,
      );

      this.logger.log(`Sweep authorized with hash: ${authHash}`);

      return {
        authorized: true,
        hash: authHash,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`Sweep authorization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify if a sweep authorization is still valid
   */
  public async verifyAuthorization(authHash: string): Promise<boolean> {
    this.logger.log(`Verifying authorization: ${authHash}`);

    // In a full implementation, this would query the smart contract
    // to verify the authorization is still valid
    return authHash.length === 64;
  }

  /**
   * Validate Stellar address format
   */
  private isValidStellarAddress(address: string): boolean {
    return /^G[A-Z2-7]{55}$/.test(address);
  }

  /**
   * Generate authorization hash
   * In production, this would come from the smart contract
   */
  private generateAuthHash(
    ephemeralKey: string,
    destination: string,
  ): string {
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
