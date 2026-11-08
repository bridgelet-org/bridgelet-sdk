import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Horizon, NotFoundError } from '@stellar/stellar-sdk';
import { Account } from '../../accounts/entities/account.entity.js';
import type { SweepExecutionRequest } from '../interfaces/execute-sweep.interface.js';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';
import { StellarAddressValidator } from '../../../common/validators/stellar-address.validator.js';
import {
  isNativeAsset,
  parseAmountToStroops,
  parseAsset,
} from '../../../common/utils/stellar-asset.util.js';

interface DestinationBalance {
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  limit?: string;
}

interface HorizonAccountWithBalances {
  balances?: DestinationBalance[];
}

@Injectable()
export class ValidationProvider {
  private readonly logger = new Logger(ValidationProvider.name);

  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Asserts that a destination address exists on the Stellar network (Horizon).
   * Throws BadRequestException (DESTINATION_NOT_FUNDED) if the account does not exist (404).
   * Transient network errors are rethrown so they are not treated as "not funded".
   *
   * @param destinationAddress The Stellar public address to check.
   * @param horizonServerOrUrl Optional Horizon.Server instance or Horizon URL string.
   */
  public async assertDestinationExists(
    destinationAddress: string,
    horizonServerOrUrl?:
      | { loadAccount: (id: string) => Promise<unknown> }
      | string,
  ): Promise<void> {
    return ValidationProvider.assertDestinationExists(
      destinationAddress,
      horizonServerOrUrl,
    );
  }

  public static async assertDestinationExists(
    destinationAddress: string,
    horizonServerOrUrl?:
      | { loadAccount: (id: string) => Promise<unknown> }
      | string,
  ): Promise<void> {
    await ValidationProvider.loadDestinationAccount(
      destinationAddress,
      horizonServerOrUrl,
    );
  }

  /**
   * Asserts that the destination can actually receive the account's asset
   * (#991).
   *
   * For issued assets a classic payment fails unless the destination already
   * holds a trustline to the exact issuer with enough remaining limit. Without
   * this check the failure only surfaces in step 4 of the sweep — after the
   * contract has authorised the sweep and moved the account into `Swept`,
   * leaving a PARTIAL_SWEEP that needs manual recovery. Checking before the
   * contract call keeps the claim retryable and returns a stable 422.
   */
  public async assertDestinationTrustsAsset(
    destinationAddress: string,
    asset: string,
    amount: string,
    horizonServerOrUrl?:
      | { loadAccount: (id: string) => Promise<unknown> }
      | string,
  ): Promise<void> {
    // Native XLM needs no trustline and cannot be rejected this way.
    if (isNativeAsset(asset)) return;

    const server =
      horizonServerOrUrl ??
      this.configService.get<string>('stellar.horizonUrl');
    const rawAccount = await ValidationProvider.loadDestinationAccount(
      destinationAddress,
      server,
    );
    const account = rawAccount as HorizonAccountWithBalances;
    const parsed = parseAsset(asset);

    const line = (account.balances ?? []).find(
      (balance) =>
        balance.asset_type !== 'native' &&
        balance.asset_code === parsed.code &&
        balance.asset_issuer === parsed.issuer,
    );

    if (!line) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'DESTINATION_MISSING_TRUSTLINE',
        code: 'DESTINATION_MISSING_TRUSTLINE',
        message:
          `Destination address does not have a trustline for ${asset}. ` +
          `Add a trustline for ${parsed.code} issued by ${parsed.issuer} before claiming.`,
      });
    }

    if (line.limit !== undefined) {
      const limit = parseAmountToStroops(line.limit);
      const requested = parseAmountToStroops(amount);
      if (requested > limit) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'DESTINATION_TRUSTLINE_LIMIT_EXCEEDED',
          code: 'DESTINATION_TRUSTLINE_LIMIT_EXCEEDED',
          message:
            `Destination trustline limit for ${asset} is ${line.limit}, ` +
            `which is below the sweep amount ${amount}.`,
        });
      }
    }
  }

  private static async loadDestinationAccount(
    destinationAddress: string,
    horizonServerOrUrl?:
      | { loadAccount: (id: string) => Promise<unknown> }
      | string,
  ): Promise<unknown> {
    const server = ValidationProvider.resolveHorizonServer(horizonServerOrUrl);

    try {
      return await server.loadAccount(destinationAddress);
    } catch (error: unknown) {
      ValidationProvider.handleDestinationLoadError(error);
    }
  }

  private static resolveHorizonServer(
    horizonServerOrUrl?:
      | { loadAccount: (id: string) => Promise<unknown> }
      | string,
  ): { loadAccount: (id: string) => Promise<unknown> } {
    if (
      horizonServerOrUrl &&
      typeof horizonServerOrUrl === 'object' &&
      'loadAccount' in horizonServerOrUrl &&
      typeof horizonServerOrUrl.loadAccount === 'function'
    ) {
      return horizonServerOrUrl;
    }

    if (
      typeof horizonServerOrUrl === 'string' &&
      horizonServerOrUrl.trim() !== ''
    ) {
      return new Horizon.Server(horizonServerOrUrl);
    }

    const url =
      process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
    return new Horizon.Server(url);
  }

  private static handleDestinationLoadError(error: unknown): never {
    let isNotFound = false;
    if (error instanceof NotFoundError) {
      isNotFound = true;
    } else if (error && typeof error === 'object') {
      const errObj = error as {
        name?: string;
        status?: number;
        response?: { status?: number };
      };
      isNotFound =
        errObj.name === 'NotFoundError' ||
        errObj.status === 404 ||
        errObj.response?.status === 404;
    }

    if (isNotFound) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'DESTINATION_NOT_FUNDED',
        code: 'DESTINATION_NOT_FUNDED',
        message:
          'Destination address does not exist on Stellar network and is not funded',
      });
    }

    // Treat network/transient errors as transient; do not report as "not funded"
    throw error;
  }

  /**
   * Validate all sweep parameters before execution
   */
  public async validateSweepParameters(
    sweepExecutionRequest: SweepExecutionRequest,
  ): Promise<void> {
    this.logger.log(
      `Validating sweep parameters for account: ${sweepExecutionRequest.accountId}`,
    );

    // Validate destination address
    StellarAddressValidator.assertValid(
      sweepExecutionRequest.destinationAddress,
    );

    // Validate account exists, is in correct state, and has not been
    // soft-deleted (deletedAt: IsNull() is explicit here even though
    // TypeORM's @DeleteDateColumn already filters it, per issue #435).
    const account = await this.accountRepository.findOne({
      where: { id: sweepExecutionRequest.accountId, deletedAt: IsNull() },
    });

    if (!account) {
      throw new NotFoundException(
        `Account ${sweepExecutionRequest.accountId} not found`,
      );
    }

    // Validate ephemeral public key matches
    if (account.publicKey !== sweepExecutionRequest.ephemeralPublicKey) {
      throw new BadRequestException('Ephemeral public key mismatch');
    }

    // Check account status
    // Verify account has received payment
    if (account.status === AccountStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Account has not received payment yet');
    }

    // ClaimRedemptionProvider takes the claim slot (PENDING_CLAIM or
    // PARTIAL_SWEEP -> CLAIMING, under a row lock) BEFORE it calls
    // SweepsService.executeSweep, so a sweep that is legitimately in progress
    // always sees CLAIMING here. Requiring PENDING_CLAIM alone rejected every
    // real redemption with "Account cannot be swept. Status: claiming".
    // PENDING_CLAIM stays allowed for any direct caller that has not taken the
    // slot; every other status (CLAIMED, EXPIRED, FAILED, ...) is still refused.
    if (
      account.status !== AccountStatus.PENDING_CLAIM &&
      account.status !== AccountStatus.CLAIMING
    ) {
      throw new BadRequestException(
        `Account cannot be swept. Status: ${account.status}`,
      );
    }

    // Check account hasn't expired
    if (new Date() > account.expiresAt) {
      throw new BadRequestException('Account has expired');
    }

    // Validate amount is positive
    const amount = parseFloat(sweepExecutionRequest.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestException('Amount must be a positive number');
    }

    // Validate amount matches account balance
    if (sweepExecutionRequest.amount !== account.amount) {
      throw new BadRequestException(
        `Amount mismatch: expected ${account.amount}, got ${sweepExecutionRequest.amount}`,
      );
    }

    // Validate asset format
    if (!this.isValidAssetFormat(sweepExecutionRequest.asset)) {
      throw new BadRequestException('Invalid asset format');
    }

    // Validate asset matches
    if (sweepExecutionRequest.asset !== account.asset) {
      throw new BadRequestException(
        `Asset mismatch: expected ${account.asset}, got ${sweepExecutionRequest.asset}`,
      );
    }

    // #991: verify the destination can receive this asset BEFORE the sweep
    // contract is invoked. Otherwise a missing/lower trustline fails at the
    // final Horizon payment, after the contract is already in Swept state.
    await this.assertDestinationTrustsAsset(
      sweepExecutionRequest.destinationAddress,
      account.asset,
      account.amount,
    );

    this.logger.log(
      `Validation passed for account: ${sweepExecutionRequest.accountId}`,
    );
  }

  /**
   * Check if account can be swept
   */
  public async canSweep(
    accountId: string,
    destinationAddress: string,
  ): Promise<boolean> {
    try {
      const account = await this.accountRepository.findOne({
        where: { id: accountId, deletedAt: IsNull() },
      });

      if (!account) return false;
      if (account.status !== AccountStatus.PENDING_CLAIM) return false;
      if (new Date() > account.expiresAt) return false;

      StellarAddressValidator.assertValid(destinationAddress);
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
    const account = await this.accountRepository.findOne({
      where: { id: accountId, deletedAt: IsNull() },
    });

    if (!account) {
      return { canSweep: false, reason: 'Account not found' };
    }

    if (!account.publicKey) {
      return {
        canSweep: false,
        reason: 'No public key associated with account',
      };
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
    return StellarAddressValidator.isValid(issuer);
  }
}
