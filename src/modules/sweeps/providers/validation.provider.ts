import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Account,
  AccountStatus,
} from '../../accounts/entities/account.entity.js';
import { StrKey } from '@stellar/stellar-sdk';
import type { ExecuteSweepDto } from '../dto/execute-sweep.dto.js';

@Injectable()
export class ValidationProvider {
  private readonly logger = new Logger(ValidationProvider.name);

  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
  ) {}

  /**
   * Validate all sweep parameters before execution
   */
  public async validateSweepParameters(dto: ExecuteSweepDto): Promise<void> {
    this.logger.log(
      `Validating sweep parameters for account: ${dto.accountId}`,
    );

    // Validate destination address format
    this.validateStellarAddress(dto.destinationAddress);

    // Validate account exists and is in correct state
    const account = await this.accountsRepository.findOne({
      where: { id: dto.accountId },
    });

    if (!account) {
      throw new NotFoundException(`Account ${dto.accountId} not found`);
    }

    // Check account status
    // Verify account has received payment
    if (account.status === AccountStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Account has not received payment yet');
    }

    if (account.status !== AccountStatus.PENDING_CLAIM) {
      throw new BadRequestException(
        `Account cannot be swept. Status: ${account.status}`,
      );
    }

    // Check account hasn't expired
    if (new Date() > account.expiresAt) {
      throw new BadRequestException('Account has expired');
    }

    // Validate amount matches account balance
    if (dto.amount !== account.amount) {
      throw new BadRequestException(
        `Amount mismatch: expected ${account.amount}, got ${dto.amount}`,
      );
    }

    // Validate asset matches
    if (dto.asset !== account.asset) {
      throw new BadRequestException(
        `Asset mismatch: expected ${account.asset}, got ${dto.asset}`,
      );
    }

    this.logger.log(`Validation passed for account: ${dto.accountId}`);
  }

  /**
   * Check if account can be swept
   */
  public async canSweep(
    accountId: string,
    destinationAddress: string,
  ): Promise<boolean> {
    try {
      const account = await this.accountsRepository.findOne({
        where: { id: accountId },
      });

      if (!account) return false;
      if (account.status !== AccountStatus.PENDING_CLAIM) return false;
      if (new Date() > account.expiresAt) return false;

      this.validateStellarAddress(destinationAddress);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get detailed sweep status
   */
  public async getSweepStatus(
    accountId: string,
  ): Promise<{ canSweep: boolean; reason?: string }> {
    const account = await this.accountsRepository.findOne({
      where: { id: accountId },
    });

    if (!account) {
      return { canSweep: false, reason: 'Account not found' };
    }

    if (account.status === AccountStatus.CLAIMED) {
      return { canSweep: false, reason: 'Already swept' };
    }

    if (account.status === AccountStatus.EXPIRED) {
      return { canSweep: false, reason: 'Account expired' };
    }

    if (account.status === AccountStatus.PENDING_PAYMENT) {
      return { canSweep: false, reason: 'Payment not received' };
    }

    if (new Date() > account.expiresAt) {
      return { canSweep: false, reason: 'Account expired' };
    }

    return { canSweep: true };
  }

  /**
   * Validate Stellar address format
   */
  private validateStellarAddress(address: string): void {
    try {
      // Use Stellar SDK's built-in validation
      if (!StrKey.isValidEd25519PublicKey(address)) {
        throw new BadRequestException(`Invalid Stellar address: ${address}`);
      }
    } catch (error) {
      throw new BadRequestException(`Invalid Stellar address: ${address}`);
    }
  }
}
