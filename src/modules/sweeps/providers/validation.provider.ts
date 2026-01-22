import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../../accounts/entities/account.entity.js';
import type { ExecuteSweepDto } from '../dto/execute-sweep.dto.js';

@Injectable()
export class ValidationProvider {
  private readonly logger = new Logger(ValidationProvider.name);

  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {}

  /**
   * Validate sweep parameters before execution
   */
  public async validateSweepParameters(dto: ExecuteSweepDto): Promise<void> {
    this.logger.log(`Validating sweep parameters for account: ${dto.accountId}`);

    // Validate account exists
    const account = await this.accountRepository.findOne({
      where: { id: dto.accountId },
    });

    if (!account) {
      throw new BadRequestException(`Account not found: ${dto.accountId}`);
    }

    // Validate ephemeral public key matches
    if (account.publicKey !== dto.ephemeralPublicKey) {
      throw new BadRequestException('Ephemeral public key mismatch');
    }

    // Validate destination address format (basic Stellar address validation)
    if (!this.isValidStellarAddress(dto.destinationAddress)) {
      throw new BadRequestException('Invalid destination address format');
    }

    // Validate amount is positive
    const amount = parseFloat(dto.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestException('Amount must be a positive number');
    }

    // Validate asset format
    if (!this.isValidAssetFormat(dto.asset)) {
      throw new BadRequestException('Invalid asset format');
    }

    this.logger.log('Sweep parameters validated successfully');
  }

  /**
   * Check if account can be swept (validation only)
   */
  public async canSweep(accountId: string, destinationAddress: string): Promise<boolean> {
    try {
      const account = await this.accountRepository.findOne({
        where: { id: accountId },
      });

      if (!account) {
        return false;
      }

      if (!this.isValidStellarAddress(destinationAddress)) {
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Error checking sweep eligibility: ${error.message}`);
      return false;
    }
  }

  /**
   * Get sweep status for an account
   */
  public async getSweepStatus(accountId: string): Promise<{
    canSweep: boolean;
    reason?: string;
  }> {
    const account = await this.accountRepository.findOne({
      where: { id: accountId },
    });

    if (!account) {
      return { canSweep: false, reason: 'Account not found' };
    }

    if (!account.publicKey) {
      return { canSweep: false, reason: 'No public key associated with account' };
    }

    return { canSweep: true };
  }

  /**
   * Validate Stellar address format
   */
  private isValidStellarAddress(address: string): boolean {
    // Stellar addresses start with G and are 56 characters long
    return /^G[A-Z2-7]{55}$/.test(address);
  }

  /**
   * Validate asset format (native, XLM, or CODE:ISSUER)
   */
  private isValidAssetFormat(asset: string): boolean {
    if (asset === 'native' || asset === 'XLM') {
      return true;
    }

    // Format: CODE:ISSUER
    const parts = asset.split(':');
    if (parts.length !== 2) {
      return false;
    }

    const [code, issuer] = parts;
    // Asset code: 1-12 alphanumeric characters
    if (!/^[a-zA-Z0-9]{1,12}$/.test(code)) {
      return false;
    }

    // Issuer must be valid Stellar address
    return this.isValidStellarAddress(issuer);
  }
}
