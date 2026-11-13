import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Keypair } from '@stellar/stellar-sdk';
import { IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import { AccountEventsProvider } from '../../account-events/providers/account-events.provider.js';
import { AccountReclamationStatus } from '../../accounts/enums/account-reclamation-status.enum.js';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';
import { Account } from '../../accounts/entities/account.entity.js';
import {
  KmsKeyProvider,
  SecretEncryptionUtil,
} from '../../../common/crypto/kms-key.provider.js';
import { StellarService } from '../../stellar/stellar.service.js';
import type { StellarAccountSnapshot } from '../../sweeps/interfaces/stellar-account-snapshot.interface.js';
import { TransactionProvider } from '../../sweeps/providers/transaction.provider.js';

const RECLAMATION_BATCH_SIZE = 100;
const RECLAMATION_RETRY_BASE_MS = 60_000;
const RECLAMATION_RETRY_MAX_MS = 3_600_000;
const RECLAMATION_ERROR_MAX_LENGTH = 1_000;

interface ReclamationTransactionHashes {
  refundTxHash?: string;
  trustlineRemovalTxHash?: string;
  mergeTxHash?: string;
}

@Injectable()
export class AccountReclamationProvider {
  private readonly logger = new Logger(AccountReclamationProvider.name);

  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    private readonly transactionProvider: TransactionProvider,
    private readonly stellarService: StellarService,
    private readonly accountEventsProvider: AccountEventsProvider,
    private readonly kmsKeyProvider: KmsKeyProvider,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Process terminal accounts whose reclamation is due.
   *
   * Failures are isolated per account and persisted as a backoff so one
   * account (or a Horizon outage) cannot block the rest of the batch.
   */
  async runPending(now: Date = new Date()): Promise<void> {
    let accounts: Account[];

    try {
      accounts = await this.accountsRepository.find({
        where: [AccountStatus.CLAIMED, AccountStatus.EXPIRED].flatMap(
          (status) => [
            {
              status,
              reclamationStatus: Not(AccountReclamationStatus.COMPLETED),
              reclamationNextAttemptAt: IsNull(),
            },
            {
              status,
              reclamationStatus: Not(AccountReclamationStatus.COMPLETED),
              reclamationNextAttemptAt: LessThanOrEqual(now),
            },
          ],
        ),
        order: { createdAt: 'ASC' },
        take: RECLAMATION_BATCH_SIZE,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Reclamation DB query failed: ${message}`);
      return;
    }

    if (accounts.length === 0) return;

    this.logger.debug(
      `Reclamation job: processing ${accounts.length} account(s)`,
    );

    await Promise.allSettled(
      accounts.map((account) => this.reclaimAccount(account, now)),
    );
  }

  async reclaimAccount(
    account: Account,
    now: Date = new Date(),
  ): Promise<void> {
    if (
      account.status !== AccountStatus.CLAIMED &&
      account.status !== AccountStatus.EXPIRED
    ) {
      return;
    }
    if (account.reclamationStatus === AccountReclamationStatus.COMPLETED) {
      return;
    }

    const attempts = (account.reclamationAttempts ?? 0) + 1;
    const hashes: ReclamationTransactionHashes = {};

    try {
      const snapshot = await this.transactionProvider.getAccountSnapshot(
        account.publicKey,
      );

      if (!snapshot) {
        await this.markCompleted(account, now, attempts, hashes, true);
        return;
      }

      if (!account.secretKeyEncrypted) {
        throw new Error(
          `Account ${account.id} has no encrypted secret to sign reclamation`,
        );
      }

      const ephemeralSecret = SecretEncryptionUtil.decrypt(
        account.secretKeyEncrypted,
        this.kmsKeyProvider.getEncryptionKey(),
      );

      const recoveryAddress =
        account.status === AccountStatus.EXPIRED
          ? await this.getRecoveryAddress(account)
          : null;

      let phase = account.reclamationStatus;
      const trustline = this.isNativeAsset(account.asset)
        ? undefined
        : this.findTrustline(snapshot, account.asset);

      if (
        account.status === AccountStatus.EXPIRED &&
        trustline &&
        this.hasPositiveBalance(trustline.balance)
      ) {
        const refund = await this.transactionProvider.executeSweepTransaction({
          ephemeralSecret,
          destinationAddress: recoveryAddress as string,
          amount: trustline.balance,
          asset: account.asset,
        });
        hashes.refundTxHash = refund.hash;
      }

      if (phase === AccountReclamationStatus.PENDING) {
        await this.persistPhase(
          account.id,
          AccountReclamationStatus.REFUNDED,
          attempts,
          now,
        );
        phase = AccountReclamationStatus.REFUNDED;
      }

      if (trustline) {
        if (
          account.status === AccountStatus.CLAIMED &&
          this.hasPositiveBalance(trustline.balance)
        ) {
          throw new Error(
            `Claimed account ${account.id} still has a non-zero ${account.asset} trustline`,
          );
        }

        const removal = await this.transactionProvider.removeTrustline({
          ephemeralSecret,
          asset: account.asset,
        });
        hashes.trustlineRemovalTxHash = removal.hash;
      }

      if (phase !== AccountReclamationStatus.TRUSTLINE_REMOVED) {
        await this.persistPhase(
          account.id,
          AccountReclamationStatus.TRUSTLINE_REMOVED,
          attempts,
          now,
        );
        phase = AccountReclamationStatus.TRUSTLINE_REMOVED;
      }

      const destination =
        account.status === AccountStatus.EXPIRED
          ? (recoveryAddress as string)
          : this.getFundingPublicKey();

      const merge = await this.transactionProvider.mergeAccount({
        ephemeralSecret,
        destinationAddress: destination,
      });
      hashes.mergeTxHash = merge.hash;

      await this.markCompleted(account, now, attempts, hashes, false);
    } catch (error) {
      await this.handleFailure(account, now, attempts, error);
    }
  }

  private async getRecoveryAddress(account: Account): Promise<string> {
    if (!account.contractId) {
      throw new Error(
        `Expired account ${account.id} has no contract ID to read recovery_address`,
      );
    }

    const info = await this.stellarService.getAccountInfo(account.contractId);
    return info.recovery_address;
  }

  private findTrustline(
    snapshot: StellarAccountSnapshot,
    asset: string,
  ): StellarAccountSnapshot['trustlines'][number] | undefined {
    return snapshot.trustlines.find((trustline) => trustline.asset === asset);
  }

  private hasPositiveBalance(balance: string): boolean {
    return Number(balance) > 0;
  }

  private isNativeAsset(asset: string): boolean {
    return asset === 'native' || asset === 'XLM';
  }

  private getFundingPublicKey(): string {
    const fundingSecret = this.configService.getOrThrow<string>(
      'stellar.fundingSecret',
    );
    return Keypair.fromSecret(fundingSecret).publicKey();
  }

  private async persistPhase(
    accountId: string,
    phase:
      | AccountReclamationStatus.REFUNDED
      | AccountReclamationStatus.TRUSTLINE_REMOVED,
    attempts: number,
    now: Date,
  ): Promise<void> {
    await this.accountsRepository.update(accountId, {
      reclamationStatus: phase,
      reclamationAttempts: attempts,
      reclamationLastAttemptAt: now,
      reclamationNextAttemptAt: null,
      reclamationLastError: null,
    });
  }

  private async markCompleted(
    account: Account,
    now: Date,
    attempts: number,
    hashes: ReclamationTransactionHashes,
    alreadyMerged: boolean,
  ): Promise<void> {
    await this.accountsRepository.update(account.id, {
      reclamationStatus: AccountReclamationStatus.COMPLETED,
      reclamationAttempts: attempts,
      reclamationLastAttemptAt: now,
      reclamationNextAttemptAt: null,
      reclamationLastError: null,
      reclamationCompletedAt: now,
      secretKeyEncrypted: null,
    });

    await this.accountEventsProvider.record({
      accountId: account.id,
      type: 'reclaimed',
      txHash:
        hashes.mergeTxHash ??
        hashes.refundTxHash ??
        hashes.trustlineRemovalTxHash ??
        null,
      details: {
        outcome:
          account.status === AccountStatus.EXPIRED ? 'expired' : 'claimed',
        alreadyMerged,
        reserveReclaimed: true,
        refundTxHash: hashes.refundTxHash,
        trustlineRemovalTxHash: hashes.trustlineRemovalTxHash,
        mergeTxHash: hashes.mergeTxHash,
        attempts,
      },
    });

    this.logger.log(
      `Account ${account.id} reclamation complete${alreadyMerged ? ' (account already merged)' : ''}`,
    );
  }

  private async handleFailure(
    account: Account,
    now: Date,
    attempts: number,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const delayMs = Math.min(
      RECLAMATION_RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 6),
      RECLAMATION_RETRY_MAX_MS,
    );
    const nextAttemptAt = new Date(now.getTime() + delayMs);

    try {
      await this.accountsRepository.update(account.id, {
        reclamationAttempts: attempts,
        reclamationLastAttemptAt: now,
        reclamationNextAttemptAt: nextAttemptAt,
        reclamationLastError: message.slice(0, RECLAMATION_ERROR_MAX_LENGTH),
      });
    } catch (updateError) {
      const updateMessage =
        updateError instanceof Error
          ? updateError.message
          : String(updateError);
      this.logger.error(
        `Failed to persist reclamation backoff for account ${account.id}: ${updateMessage}`,
      );
    }

    this.logger.warn(
      `Reclamation failed for account ${account.id} (attempt ${attempts}); ` +
        `retrying after ${delayMs}ms: ${message}`,
    );
  }
}
