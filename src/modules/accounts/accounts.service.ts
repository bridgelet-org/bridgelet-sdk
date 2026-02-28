import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountStatus } from './entities/account.entity.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { AccountResponseDto } from './dto/account-response.dto.js';
import { StellarService } from '../stellar/stellar.service.js';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

/**
 * AccountsService
 * -----------------------------------------------------------------------------
 * Core orchestration layer for Bridgelet account lifecycle management.
 *
 * Responsibilities:
 * - Ephemeral account keypair generation
 * - On-chain ephemeral account creation via StellarService
 * - Claim-token issuance and lifecycle management
 * - Secure token hashing for persistence
 * - Persistence of account state
 * - DTO response shaping for external consumers
 *
 * Lifecycle Overview:
 * 1. Generate ephemeral keypair
 * 2. Create and fund ephemeral account on Stellar
 * 3. Generate claim JWT bound to public key
 * 4. Hash token for storage (never store raw token)
 * 5. Persist account state
 * 6. Return shaped response (raw claim token only once)
 *
 * Integration Boundaries:
 * - StellarService is responsible for blockchain interaction.
 * - JWT signing defines claim identity and expiry guarantees.
 * - Response DTOs must remain backward compatible for integrators.
 *
 * ⚠️ Protocol Sensitivity:
 * This service encodes lifecycle guarantees relied upon by integrators.
 * Modifying claim generation, expiry semantics, or response mapping
 * may introduce breaking changes.
 *
 * Security Notes:
 * - Raw claim tokens are NEVER persisted.
 * - Only SHA-256 hash of the token is stored.
 * - Expiry semantics derive from configuration.
 * - Private keys must never be logged or externally exposed.
 *
 * Contributor Guidance:
 * If unsure whether a change affects lifecycle guarantees,
 * consult maintainers before modifying logic.
 *
 * When in doubt: document, do not redesign.
 */
@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private accountsRepository: Repository<Account>,
    private configService: ConfigService,
    private jwtService: JwtService,
    private stellarService: StellarService,
  ) {}

  public async create(
    createAccountDto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    // Step 1: Generate ephemeral keypair.
    // Represents a temporary claimable Stellar account.
    // Secret handling must remain internal and never be logged.
    const ephemeralKeypair = this.stellarService.generateKeypair();

    // Step 2: Calculate expiry timestamp based on provided duration.
    const expiresAt = new Date(Date.now() + createAccountDto.expiresIn * 1000);

    // Step 3: Create and fund ephemeral account on Stellar network.
    const txHash = await this.stellarService.createEphemeralAccount({
      publicKey: ephemeralKeypair.publicKey(),
      amount: createAccountDto.amount,
      asset: createAccountDto.asset,
      expiresAt,
    });

    // Step 4: Generate signed claim token (JWT).
    // Token binds the public key to claim identity and expiry semantics.
    const claimToken = this.generateClaimToken(ephemeralKeypair.publicKey());

    // Security boundary:
    // Raw JWT is NEVER stored.
    // Only SHA-256 hash is persisted to prevent token leakage.
    const claimTokenHash = crypto
      .createHash('sha256')
      .update(claimToken)
      .digest('hex');

    // Step 5: Persist account state.
    const account = this.accountsRepository.create({
      publicKey: ephemeralKeypair.publicKey(),
      secretKeyEncrypted: this.encryptSecret(ephemeralKeypair.secret()),
      fundingSource: createAccountDto.fundingSource,
      amount: createAccountDto.amount,
      asset: createAccountDto.asset,
      status: AccountStatus.PENDING_PAYMENT,
      claimTokenHash,
      expiresAt,
      metadata: createAccountDto.metadata,
    });

    await this.accountsRepository.save(account);

    // Step 6: Response shaping boundary.
    // Raw claim token is returned ONLY at creation time.
    // Subsequent retrievals must not expose sensitive data.
    return {
      accountId: account.id,
      publicKey: account.publicKey,
      claimUrl: this.generateClaimUrl(claimToken),
      txHash,
      amount: account.amount,
      asset: account.asset,
      status: account.status,
      expiresAt: account.expiresAt,
      createdAt: account.createdAt,
    };
  }

  public async findOne(id: string): Promise<AccountResponseDto> {
    const account = await this.accountsRepository.findOne({ where: { id } });

    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }

    return this.mapToResponseDto(account);
  }

  public async findAll({
    status,
    limit,
    offset,
  }: {
    status?: AccountStatus;
    limit: number;
    offset: number;
  }): Promise<{ accounts: AccountResponseDto[]; total: number }> {
    const query = this.accountsRepository.createQueryBuilder('account');

    if (status) {
      query.where('account.status = :status', { status });
    }

    query.skip(offset).take(Math.min(limit, 100));

    const [accounts, total] = await query.getManyAndCount();

    return {
      accounts: accounts.map((acc) => this.mapToResponseDto(acc)),
      total,
    };
  }

  /**
   * Generates a signed JWT claim token.
   *
   * Security Assumptions:
   * - Expiry controlled via configuration (app.claimTokenExpiry).
   * - Token structure is relied upon by claim validation logic.
   *
   * ⚠️ Modifying token payload or expiry semantics may
   * introduce protocol-level breaking changes.
   */
  private generateClaimToken(publicKey: string): string {
    const expiry =
      this.configService.get<number>('app.claimTokenExpiry') ?? 2592000;

    return this.jwtService.sign(
      { publicKey, type: 'claim' },
      { expiresIn: `${expiry}s` },
    );
  }

  private generateClaimUrl(token: string): string {
    const baseUrl = process.env.CLAIM_BASE_URL || 'https://claim.bridgelet.io';
    return `${baseUrl}/c/${token}`;
  }

  private encryptSecret(secret: string): string {
    /**
     * MVP Placeholder:
     * Currently uses base64 encoding.
     * This is NOT secure for production.
     * Production implementation should use proper AES-256 encryption.
     */
    return Buffer.from(secret).toString('base64');
  }

  private mapToResponseDto(account: Account): AccountResponseDto {
    return {
      accountId: account.id,
      publicKey: account.publicKey,
      claimUrl: account.claimTokenHash ? this.generateClaimUrl('***') : null,
      amount: account.amount,
      asset: account.asset,
      status: account.status,
      expiresAt: account.expiresAt,
      createdAt: account.createdAt,
      claimedAt: account.claimedAt,
      destination: account.destinationAddress,
      metadata: account.metadata,
    };
  }
}
