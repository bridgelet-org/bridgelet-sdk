import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';
import { Repository } from 'typeorm';
import { AccountEventsProvider } from '../../account-events/providers/account-events.provider.js';
import { AccountReclamationStatus } from '../../accounts/enums/account-reclamation-status.enum.js';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';
import { Account } from '../../accounts/entities/account.entity.js';
import {
  KmsKeyProvider,
  SecretEncryptionUtil,
} from '../../../common/crypto/kms-key.provider.js';
import { StellarService } from '../../stellar/stellar.service.js';
import { TransactionProvider } from '../../sweeps/providers/transaction.provider.js';
import { AccountReclamationProvider } from './account-reclamation.provider.js';

const fundingKeypair = Keypair.random();
const now = new Date('2026-01-01T00:00:00.000Z');
const issuer = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const recoveryAddress = 'GD5J6HLF5666X4AZLTFTXGKWDBSUXSWXP6P5F20O1337';

const makeAccount = (overrides: Partial<Account> = {}): Account =>
  ({
    id: 'account-1',
    publicKey: 'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
    contractId: 'CD5J6HLF5666X4AZLTFTXGKWDBSUXSWXP6P5F20O1337ABCDEFGHIJK',
    secretKeyEncrypted: 'encrypted-secret',
    fundingSource: fundingKeypair.publicKey(),
    amount: '10.0000000',
    asset: 'native',
    status: AccountStatus.CLAIMED,
    claimTokenHash: null,
    destinationAddress:
      'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    claimedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiredAt: null,
    reclamationStatus: AccountReclamationStatus.PENDING,
    reclamationAttempts: 0,
    reclamationLastAttemptAt: null,
    reclamationNextAttemptAt: null,
    reclamationLastError: null,
    reclamationCompletedAt: null,
    metadata: {},
    deletedAt: null,
    ...overrides,
  }) as Account;

interface RepositoryMock {
  find: jest.Mock;
  update: jest.Mock;
}

interface TransactionProviderMock {
  getAccountSnapshot: jest.Mock;
  executeSweepTransaction: jest.Mock;
  removeTrustline: jest.Mock;
  mergeAccount: jest.Mock;
}

interface StellarServiceMock {
  getAccountInfo: jest.Mock;
}

interface AccountEventsProviderMock {
  record: jest.Mock;
}

describe('AccountReclamationProvider', () => {
  let provider: AccountReclamationProvider;
  let repository: RepositoryMock;
  let transactionProvider: TransactionProviderMock;
  let stellarService: StellarServiceMock;
  let accountEventsProvider: AccountEventsProviderMock;
  let decryptSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  const snapshot = (overrides: Record<string, unknown> = {}) => ({
    publicKey: 'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
    nativeBalance: '2.0000000',
    trustlines: [],
    ...overrides,
  });

  beforeEach(() => {
    repository = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    transactionProvider = {
      getAccountSnapshot: jest.fn().mockResolvedValue(snapshot()),
      executeSweepTransaction: jest
        .fn()
        .mockResolvedValue({ hash: 'refund-hash' }),
      removeTrustline: jest.fn().mockResolvedValue({ hash: 'trustline-hash' }),
      mergeAccount: jest.fn().mockResolvedValue({ hash: 'merge-hash' }),
    };
    stellarService = {
      getAccountInfo: jest.fn().mockResolvedValue({
        recovery_address: recoveryAddress,
      }),
    };
    accountEventsProvider = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    const kmsKeyProvider = {
      getEncryptionKey: jest.fn().mockReturnValue('encryption-key'),
    };
    const configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'stellar.fundingSecret') {
          return fundingKeypair.secret();
        }
        throw new Error(`Config key not found: ${key}`);
      }),
    };

    decryptSpy = jest
      .spyOn(SecretEncryptionUtil, 'decrypt')
      .mockReturnValue('S_EPHEMERAL_SECRET');
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    provider = new AccountReclamationProvider(
      repository as unknown as Repository<Account>,
      transactionProvider as unknown as TransactionProvider,
      stellarService as unknown as StellarService,
      accountEventsProvider as unknown as AccountEventsProvider,
      kmsKeyProvider as unknown as KmsKeyProvider,
      configService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    decryptSpy.mockRestore();
    loggerWarnSpy.mockRestore();
    loggerErrorSpy.mockRestore();
  });

  describe('runPending', () => {
    it('queries due terminal accounts and processes the batch', async () => {
      const claimed = makeAccount({ id: 'claimed' });
      const expired = makeAccount({
        id: 'expired',
        status: AccountStatus.EXPIRED,
      });
      repository.find.mockResolvedValue([claimed, expired]);
      transactionProvider.getAccountSnapshot.mockResolvedValue(null);

      await provider.runPending(now);

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
          order: { createdAt: 'ASC' },
          where: expect.any(Array),
        }),
      );
      expect(repository.update).toHaveBeenCalledTimes(2);
      expect(accountEventsProvider.record).toHaveBeenCalledTimes(2);
    });

    it('logs and returns when the database query fails', async () => {
      repository.find.mockRejectedValue(new Error('db down'));

      await expect(provider.runPending(now)).resolves.toBeUndefined();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Reclamation DB query failed: db down',
      );
    });

    it('isolates failures so other accounts in the batch complete', async () => {
      const broken = makeAccount({
        id: 'broken',
        secretKeyEncrypted: null,
      });
      const merged = makeAccount({ id: 'merged' });
      repository.find.mockResolvedValue([broken, merged]);
      transactionProvider.getAccountSnapshot
        .mockResolvedValueOnce(snapshot())
        .mockResolvedValueOnce(null);

      await provider.runPending(now);

      expect(repository.update).toHaveBeenCalledWith(
        'broken',
        expect.objectContaining({ reclamationAttempts: 1 }),
      );
      expect(repository.update).toHaveBeenCalledWith(
        'merged',
        expect.objectContaining({
          reclamationStatus: AccountReclamationStatus.COMPLETED,
        }),
      );
    });
  });

  describe('claimed accounts', () => {
    it('merges a native claimed account into the funding account', async () => {
      const account = makeAccount();

      await provider.reclaimAccount(account, now);

      expect(stellarService.getAccountInfo).not.toHaveBeenCalled();
      expect(
        transactionProvider.executeSweepTransaction,
      ).not.toHaveBeenCalled();
      expect(transactionProvider.removeTrustline).not.toHaveBeenCalled();
      expect(transactionProvider.mergeAccount).toHaveBeenCalledWith({
        ephemeralSecret: 'S_EPHEMERAL_SECRET',
        destinationAddress: fundingKeypair.publicKey(),
      });
      expect(repository.update).toHaveBeenNthCalledWith(
        1,
        account.id,
        expect.objectContaining({
          reclamationStatus: AccountReclamationStatus.REFUNDED,
          reclamationAttempts: 1,
        }),
      );
      expect(repository.update).toHaveBeenNthCalledWith(
        2,
        account.id,
        expect.objectContaining({
          reclamationStatus: AccountReclamationStatus.TRUSTLINE_REMOVED,
        }),
      );
      expect(repository.update).toHaveBeenNthCalledWith(
        3,
        account.id,
        expect.objectContaining({
          reclamationStatus: AccountReclamationStatus.COMPLETED,
          reclamationCompletedAt: now,
          secretKeyEncrypted: null,
        }),
      );
      expect(accountEventsProvider.record).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: account.id,
          type: 'reclaimed',
          txHash: 'merge-hash',
          details: expect.objectContaining({
            outcome: 'claimed',
            alreadyMerged: false,
            mergeTxHash: 'merge-hash',
          }),
        }),
      );
    });

    it('removes a zero-balance trustline before merging', async () => {
      const account = makeAccount({ asset: `USDC:${issuer}` });
      transactionProvider.getAccountSnapshot.mockResolvedValue(
        snapshot({
          trustlines: [
            {
              asset: `USDC:${issuer}`,
              code: 'USDC',
              issuer,
              balance: '0.0000000',
            },
          ],
        }),
      );

      await provider.reclaimAccount(account, now);

      expect(transactionProvider.removeTrustline).toHaveBeenCalledWith({
        ephemeralSecret: 'S_EPHEMERAL_SECRET',
        asset: `USDC:${issuer}`,
      });
      expect(transactionProvider.mergeAccount).toHaveBeenCalledWith({
        ephemeralSecret: 'S_EPHEMERAL_SECRET',
        destinationAddress: fundingKeypair.publicKey(),
      });
      expect(accountEventsProvider.record).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            trustlineRemovalTxHash: 'trustline-hash',
          }),
        }),
      );
    });

    it('refuses to merge a claimed account with a funded trustline', async () => {
      const account = makeAccount({ asset: `USDC:${issuer}` });
      transactionProvider.getAccountSnapshot.mockResolvedValue(
        snapshot({
          trustlines: [
            {
              asset: `USDC:${issuer}`,
              code: 'USDC',
              issuer,
              balance: '1.0000000',
            },
          ],
        }),
      );

      await provider.reclaimAccount(account, now);

      expect(transactionProvider.removeTrustline).not.toHaveBeenCalled();
      expect(transactionProvider.mergeAccount).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        account.id,
        expect.objectContaining({
          reclamationAttempts: 1,
          reclamationNextAttemptAt: new Date(now.getTime() + 60_000),
          reclamationLastError: expect.stringContaining('still has a non-zero'),
        }),
      );
    });
  });

  describe('expired accounts', () => {
    it('merges a native expired account into the recovery address', async () => {
      const account = makeAccount({ status: AccountStatus.EXPIRED });

      await provider.reclaimAccount(account, now);

      expect(
        transactionProvider.executeSweepTransaction,
      ).not.toHaveBeenCalled();
      expect(transactionProvider.mergeAccount).toHaveBeenCalledWith({
        ephemeralSecret: 'S_EPHEMERAL_SECRET',
        destinationAddress: recoveryAddress,
      });
      expect(accountEventsProvider.record).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ outcome: 'expired' }),
        }),
      );
    });

    it('refunds the trustline to recovery before removing it and merging', async () => {
      const account = makeAccount({
        status: AccountStatus.EXPIRED,
        asset: `USDC:${issuer}`,
      });
      transactionProvider.getAccountSnapshot.mockResolvedValue(
        snapshot({
          trustlines: [
            {
              asset: `USDC:${issuer}`,
              code: 'USDC',
              issuer,
              balance: '12.5000000',
            },
          ],
        }),
      );

      await provider.reclaimAccount(account, now);

      expect(transactionProvider.executeSweepTransaction).toHaveBeenCalledWith({
        ephemeralSecret: 'S_EPHEMERAL_SECRET',
        destinationAddress: recoveryAddress,
        amount: '12.5000000',
        asset: `USDC:${issuer}`,
      });
      expect(transactionProvider.removeTrustline).toHaveBeenCalledWith({
        ephemeralSecret: 'S_EPHEMERAL_SECRET',
        asset: `USDC:${issuer}`,
      });
      expect(transactionProvider.mergeAccount).toHaveBeenCalledWith({
        ephemeralSecret: 'S_EPHEMERAL_SECRET',
        destinationAddress: recoveryAddress,
      });
      expect(accountEventsProvider.record).toHaveBeenCalledWith(
        expect.objectContaining({
          txHash: 'merge-hash',
          details: expect.objectContaining({
            refundTxHash: 'refund-hash',
            trustlineRemovalTxHash: 'trustline-hash',
            mergeTxHash: 'merge-hash',
          }),
        }),
      );
    });

    it('skips the refund when the trustline is already empty', async () => {
      const account = makeAccount({
        status: AccountStatus.EXPIRED,
        asset: `USDC:${issuer}`,
      });
      transactionProvider.getAccountSnapshot.mockResolvedValue(
        snapshot({
          trustlines: [
            {
              asset: `USDC:${issuer}`,
              code: 'USDC',
              issuer,
              balance: '0.0000000',
            },
          ],
        }),
      );

      await provider.reclaimAccount(account, now);

      expect(
        transactionProvider.executeSweepTransaction,
      ).not.toHaveBeenCalled();
      expect(transactionProvider.removeTrustline).toHaveBeenCalled();
      expect(transactionProvider.mergeAccount).toHaveBeenCalledWith({
        ephemeralSecret: 'S_EPHEMERAL_SECRET',
        destinationAddress: recoveryAddress,
      });
    });

    it('fails with backoff when the contract has no recovery address', async () => {
      const account = makeAccount({
        status: AccountStatus.EXPIRED,
        contractId: null,
      });

      await provider.reclaimAccount(account, now);

      expect(stellarService.getAccountInfo).not.toHaveBeenCalled();
      expect(transactionProvider.mergeAccount).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        account.id,
        expect.objectContaining({
          reclamationLastError: expect.stringContaining('has no contract ID'),
        }),
      );
    });
  });

  describe('crash recovery and retries', () => {
    it('completes without network work when the account is already merged', async () => {
      const account = makeAccount({
        reclamationStatus: AccountReclamationStatus.TRUSTLINE_REMOVED,
      });
      transactionProvider.getAccountSnapshot.mockResolvedValue(null);

      await provider.reclaimAccount(account, now);

      expect(decryptSpy).not.toHaveBeenCalled();
      expect(transactionProvider.mergeAccount).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        account.id,
        expect.objectContaining({
          reclamationStatus: AccountReclamationStatus.COMPLETED,
          secretKeyEncrypted: null,
        }),
      );
      expect(accountEventsProvider.record).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            alreadyMerged: true,
            reserveReclaimed: true,
          }),
        }),
      );
    });

    it('resumes at merge without downgrading a persisted phase', async () => {
      const account = makeAccount({
        reclamationStatus: AccountReclamationStatus.TRUSTLINE_REMOVED,
      });

      await provider.reclaimAccount(account, now);

      expect(repository.update).toHaveBeenCalledTimes(1);
      expect(repository.update).toHaveBeenCalledWith(
        account.id,
        expect.objectContaining({
          reclamationStatus: AccountReclamationStatus.COMPLETED,
          secretKeyEncrypted: null,
        }),
      );
      expect(transactionProvider.removeTrustline).not.toHaveBeenCalled();
      expect(transactionProvider.mergeAccount).toHaveBeenCalled();
    });

    it('skips an account whose reclamation is already complete', async () => {
      const account = makeAccount({
        reclamationStatus: AccountReclamationStatus.COMPLETED,
      });

      await provider.reclaimAccount(account, now);

      expect(transactionProvider.getAccountSnapshot).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('retries when the expired trustline refund fails', async () => {
      const account = makeAccount({
        status: AccountStatus.EXPIRED,
        asset: `USDC:${issuer}`,
      });
      transactionProvider.getAccountSnapshot.mockResolvedValue(
        snapshot({
          trustlines: [
            {
              asset: `USDC:${issuer}`,
              code: 'USDC',
              issuer,
              balance: '12.5000000',
            },
          ],
        }),
      );
      transactionProvider.executeSweepTransaction.mockRejectedValue(
        new Error('refund failed'),
      );

      await provider.reclaimAccount(account, now);

      expect(transactionProvider.removeTrustline).not.toHaveBeenCalled();
      expect(transactionProvider.mergeAccount).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        account.id,
        expect.objectContaining({
          reclamationAttempts: 1,
          reclamationNextAttemptAt: new Date(now.getTime() + 60_000),
          reclamationLastError: 'refund failed',
        }),
      );
    });

    it('retries when the encrypted secret is missing', async () => {
      const account = makeAccount({ secretKeyEncrypted: null });

      await provider.reclaimAccount(account, now);

      expect(decryptSpy).not.toHaveBeenCalled();
      expect(transactionProvider.mergeAccount).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        account.id,
        expect.objectContaining({
          reclamationAttempts: 1,
          reclamationLastError: expect.stringContaining('no encrypted secret'),
        }),
      );
    });

    it('persists the refunded phase when trustline removal fails', async () => {
      const account = makeAccount({
        status: AccountStatus.EXPIRED,
        asset: `USDC:${issuer}`,
      });
      transactionProvider.getAccountSnapshot.mockResolvedValue(
        snapshot({
          trustlines: [
            {
              asset: `USDC:${issuer}`,
              code: 'USDC',
              issuer,
              balance: '12.5000000',
            },
          ],
        }),
      );
      transactionProvider.removeTrustline.mockRejectedValue(
        new Error('trustline failed'),
      );

      await provider.reclaimAccount(account, now);

      expect(repository.update).toHaveBeenNthCalledWith(
        1,
        account.id,
        expect.objectContaining({
          reclamationStatus: AccountReclamationStatus.REFUNDED,
        }),
      );
      expect(repository.update).toHaveBeenNthCalledWith(
        2,
        account.id,
        expect.objectContaining({
          reclamationAttempts: 1,
          reclamationLastError: 'trustline failed',
        }),
      );
      expect(transactionProvider.mergeAccount).not.toHaveBeenCalled();
    });

    it('persists the trustline-removed phase when merge fails', async () => {
      const account = makeAccount({ asset: `USDC:${issuer}` });
      transactionProvider.getAccountSnapshot.mockResolvedValue(
        snapshot({
          trustlines: [
            {
              asset: `USDC:${issuer}`,
              code: 'USDC',
              issuer,
              balance: '0.0000000',
            },
          ],
        }),
      );
      transactionProvider.mergeAccount.mockRejectedValue(
        new Error('merge failed'),
      );

      await provider.reclaimAccount(account, now);

      expect(repository.update).toHaveBeenNthCalledWith(
        2,
        account.id,
        expect.objectContaining({
          reclamationStatus: AccountReclamationStatus.TRUSTLINE_REMOVED,
        }),
      );
      expect(repository.update).toHaveBeenNthCalledWith(
        3,
        account.id,
        expect.objectContaining({
          reclamationLastError: 'merge failed',
        }),
      );
      expect(accountEventsProvider.record).not.toHaveBeenCalled();
    });

    it('caps exponential backoff at one hour', async () => {
      const account = makeAccount({
        secretKeyEncrypted: null,
        reclamationAttempts: 19,
      });

      await provider.reclaimAccount(account, now);

      expect(repository.update).toHaveBeenCalledWith(
        account.id,
        expect.objectContaining({
          reclamationAttempts: 20,
          reclamationNextAttemptAt: new Date(now.getTime() + 3_600_000),
        }),
      );
    });

    it('logs when persisting the backoff fails', async () => {
      const account = makeAccount({ secretKeyEncrypted: null });
      repository.update.mockRejectedValue(new Error('update failed'));

      await provider.reclaimAccount(account, now);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist reclamation backoff'),
      );
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Reclamation failed for account account-1'),
      );
    });
  });

  it('ignores non-terminal accounts', async () => {
    await provider.reclaimAccount(
      makeAccount({ status: AccountStatus.PENDING_CLAIM }),
      now,
    );

    expect(transactionProvider.getAccountSnapshot).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
});
