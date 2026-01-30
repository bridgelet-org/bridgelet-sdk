import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';

type TransactionProvider = import('./transaction.provider.js').TransactionProvider;

const mockSubmitTransaction = jest.fn();
const mockLoadAccount = jest.fn();
const mockKeypairFromSecret = jest.fn();
const mockOperationPayment = jest.fn();
const mockOperationAccountMerge = jest.fn();

let builderState: {
  addOperation: jest.Mock;
  setTimeout: jest.Mock;
  build: jest.Mock;
  transaction: { sign: jest.Mock };
} | null = null;

const validIssuer =
  'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON';

function createMockTransactionBuilder(
  sourceAccount: unknown,
  options: { fee: string | number; networkPassphrase: string },
) {
  const addOperation = jest.fn();
  const setTimeout = jest.fn();
  const build = jest.fn();
  const transaction = { sign: jest.fn() };
  const builder = { addOperation, setTimeout, build };

  addOperation.mockImplementation(() => builder);
  setTimeout.mockImplementation(() => builder);
  build.mockImplementation(() => transaction);

  builderState = { addOperation, setTimeout, build, transaction };
  return builder;
}

class MockAsset {
  private readonly code?: string;
  private readonly issuer?: string;
  private readonly nativeAsset: boolean;

  constructor(code: string, issuer: string) {
    if (!/^[a-zA-Z0-9]{1,12}$/.test(code)) {
      throw new Error('Asset code is invalid');
    }
    if (!/^G[A-Z2-7]{55}$/.test(issuer)) {
      throw new Error('Issuer is invalid');
    }
    this.code = code;
    this.issuer = issuer;
    this.nativeAsset = false;
  }

  static native() {
    return new MockAsset('XLM', 'G'.repeat(56));
  }

  isNative() {
    return this.nativeAsset;
  }

  getCode() {
    return this.code ?? '';
  }

  getIssuer() {
    return this.issuer ?? '';
  }
}

MockAsset.native = function () {
  const asset = Object.create(MockAsset.prototype) as MockAsset & {
    nativeAsset: boolean;
  };
  asset.nativeAsset = true;
  return asset;
};

await jest.unstable_mockModule('@stellar/stellar-sdk', async () => {
  return {
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        loadAccount: mockLoadAccount,
        submitTransaction: mockSubmitTransaction,
      })),
    },
    Keypair: {
      fromSecret: mockKeypairFromSecret,
    },
    TransactionBuilder: jest
      .fn()
      .mockImplementation(createMockTransactionBuilder),
    Operation: {
      payment: mockOperationPayment,
      accountMerge: mockOperationAccountMerge,
    },
    Asset: MockAsset,
    BASE_FEE: '100',
    Networks: {
      PUBLIC: 'Public Global Stellar Network ; September 2015',
      TESTNET: 'Test SDF Network ; September 2015',
    },
  };
});

const { Asset, BASE_FEE, Networks, TransactionBuilder } =
  await import('@stellar/stellar-sdk');
const { TransactionProvider } = await import('./transaction.provider.js');

describe('TransactionProvider', () => {
  let provider: TransactionProvider;

  const defaultConfig = {
    'stellar.horizonUrl': 'https://horizon-testnet.stellar.org',
    'stellar.network': 'testnet',
  };

  const createProvider = async (overrides?: Partial<typeof defaultConfig>) => {
    const config = { ...defaultConfig, ...overrides };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionProvider,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => config[key]),
          },
        },
      ],
    }).compile();

    return module.get<TransactionProvider>(TransactionProvider);
  };

  beforeEach(async () => {
    mockSubmitTransaction.mockReset();
    mockLoadAccount.mockReset();
    mockKeypairFromSecret.mockReset();
    mockOperationPayment.mockReset();
    mockOperationAccountMerge.mockReset();
    builderState = null;

    mockKeypairFromSecret.mockReturnValue({
      publicKey: () =>
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
      secret: () => 'S_SECRET',
    });

    provider = await createProvider();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('executeSweepTransaction', () => {
    const params = {
      ephemeralSecret: 'S_VALID_SECRET',
      destinationAddress: 'GD5J6HLF5666X4AZLTFTXGKWDBSUXSWXP6P5F20O1337',
      amount: '100',
      asset: 'native',
    };

    it('should execute payment transaction successfully', async () => {
      const sourceAccount = { id: 'acc-123', sequence: '1' };
      mockLoadAccount.mockResolvedValue(sourceAccount);
      mockOperationPayment.mockReturnValue({ type: 'payment' });
      mockSubmitTransaction.mockResolvedValue({
        hash: 'tx-hash-123',
        ledger: 100,
        successful: true,
      });

      const result = await provider.executeSweepTransaction(params);

      expect(builderState).not.toBeNull();
      const { addOperation, setTimeout, build } = builderState!;
      const addOrder = addOperation.mock.invocationCallOrder[0];
      const timeoutOrder = setTimeout.mock.invocationCallOrder[0];
      const buildOrder = build.mock.invocationCallOrder[0];
      expect(addOrder).toBeLessThan(timeoutOrder);
      expect(timeoutOrder).toBeLessThan(buildOrder);
      expect(mockLoadAccount).toHaveBeenCalledWith(
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
      );
      expect(TransactionBuilder).toHaveBeenCalledWith(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      });
      expect(mockOperationPayment).toHaveBeenCalledWith({
        destination: params.destinationAddress,
        asset: expect.any(Asset),
        amount: params.amount,
      });
      expect(builderState?.addOperation).toHaveBeenCalledWith({
        type: 'payment',
      });
      expect(builderState?.setTimeout).toHaveBeenCalledWith(30);
      expect(builderState?.transaction.sign).toHaveBeenCalledWith(
        mockKeypairFromSecret.mock.results[0].value,
      );
      expect(mockSubmitTransaction).toHaveBeenCalledWith(
        builderState?.transaction,
      );
      expect(result.hash).toBe('tx-hash-123');
      expect(result.successful).toBe(true);
    });

    it('should build payment with issued asset', async () => {
      const sourceAccount = { id: 'acc-456', sequence: '2' };
      mockLoadAccount.mockResolvedValue(sourceAccount);
      mockOperationPayment.mockReturnValue({ type: 'payment' });
      mockSubmitTransaction.mockResolvedValue({
        hash: 'tx-hash-456',
        ledger: 101,
        successful: true,
      });

      await provider.executeSweepTransaction({
        ...params,
        asset:
          'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      });

      const assetArg = mockOperationPayment.mock.calls[0][0].asset as Asset;
      expect(assetArg.isNative()).toBe(false);
      expect(assetArg.getCode()).toBe('USDC');
      expect(assetArg.getIssuer()).toBe(
        'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      );
    });

    it('should use PUBLIC network passphrase on mainnet', async () => {
      provider = await createProvider({ 'stellar.network': 'mainnet' });
      const sourceAccount = { id: 'acc-123', sequence: '1' };
      mockLoadAccount.mockResolvedValue(sourceAccount);
      mockOperationPayment.mockReturnValue({ type: 'payment' });
      mockSubmitTransaction.mockResolvedValue({
        hash: 'tx-hash-789',
        ledger: 102,
        successful: true,
      });

      await provider.executeSweepTransaction(params);

      expect(TransactionBuilder).toHaveBeenCalledWith(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.PUBLIC,
      });
    });

    it('should default to TESTNET when network config is invalid', async () => {
      provider = await createProvider({ 'stellar.network': 'unknown' });
      const sourceAccount = { id: 'acc-123', sequence: '1' };
      mockLoadAccount.mockResolvedValue(sourceAccount);
      mockOperationPayment.mockReturnValue({ type: 'payment' });
      mockSubmitTransaction.mockResolvedValue({
        hash: 'tx-hash-456',
        ledger: 103,
        successful: true,
      });

      await provider.executeSweepTransaction(params);

      expect(TransactionBuilder).toHaveBeenCalledWith(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      });
    });

    it('should throw InternalServerErrorException for invalid secret format', async () => {
      mockKeypairFromSecret.mockImplementation(() => {
        throw new Error('Invalid secret seed');
      });

      await expect(provider.executeSweepTransaction(params)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(mockLoadAccount).not.toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException for account not found (loadAccount fail)', async () => {
      mockLoadAccount.mockRejectedValue(new Error('Resource Missing'));

      await expect(provider.executeSweepTransaction(params)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should include Horizon extras in logs when submission fails', async () => {
      const sourceAccount = { id: 'acc-123', sequence: '1' };
      const error = new Error('tx_insufficient_balance');
      (error as any).response = {
        data: {
          extras: {
            result_codes: { transaction: 'tx_insufficient_balance' },
          },
        },
      };
      mockLoadAccount.mockResolvedValue(sourceAccount);
      mockOperationPayment.mockReturnValue({ type: 'payment' });
      mockSubmitTransaction.mockRejectedValue(error);
      const loggerErrorSpy = jest.spyOn(
        (provider as any).logger,
        'error',
      );

      await expect(provider.executeSweepTransaction(params)).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Transaction extras:'),
      );
    });

    it('should wrap asset parsing errors', async () => {
      mockLoadAccount.mockResolvedValue({ id: 'acc-123', sequence: '1' });

      await expect(
        provider.executeSweepTransaction({
          ...params,
          asset: 'invalid-asset',
        }),
      ).rejects.toThrow(
        'Sweep transaction failed: Invalid asset format: invalid-asset',
      );
    });

    it.each([
      'Transaction Failed',
      'tx_duplicate',
      'tx_bad_seq',
      'tx_insufficient_balance',
      'tx_failed',
      'op_no_destination',
      'Timeout',
    ])('should wrap submission error: %s', async (message) => {
      mockLoadAccount.mockResolvedValue({ id: 'acc-123', sequence: '1' });
      mockSubmitTransaction.mockRejectedValue(new Error(message));

      await expect(provider.executeSweepTransaction(params)).rejects.toThrow(
        `Sweep transaction failed: ${message}`,
      );
    });
  });

  describe('mergeAccount', () => {
    const params = {
      ephemeralSecret: 'S_VALID_SECRET',
      destinationAddress: 'GD5J6HLF5666X4AZLTFTXGKWDBSUXSWXP6P5F20O1337',
    };

    it('should execute merge transaction successfully', async () => {
      const sourceAccount = { id: 'acc-123', sequence: '1' };
      mockLoadAccount.mockResolvedValue(sourceAccount);
      mockOperationAccountMerge.mockReturnValue({ type: 'accountMerge' });
      mockSubmitTransaction.mockResolvedValue({
        hash: 'merge-hash-123',
        ledger: 101,
        successful: true,
      });

      const result = await provider.mergeAccount(params);
      expect(builderState).not.toBeNull();
      const { addOperation, setTimeout } = builderState!;
      expect(TransactionBuilder).toHaveBeenCalledWith(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      });
      expect(mockOperationAccountMerge).toHaveBeenCalledWith({
        destination: params.destinationAddress,
      });
      expect(addOperation).toHaveBeenCalledWith({
        type: 'accountMerge',
      });
      expect(setTimeout).toHaveBeenCalledWith(30);
      expect(builderState?.transaction.sign).toHaveBeenCalledWith(
        mockKeypairFromSecret.mock.results[0].value,
      );
      expect(mockSubmitTransaction).toHaveBeenCalledWith(
        builderState?.transaction,
      );
      expect(result.hash).toBe('merge-hash-123');
    });

    it('should re-throw error if merge fails (to be handled by service)', async () => {
      mockLoadAccount.mockResolvedValue({ id: 'acc-123', sequence: '1' });
      mockSubmitTransaction.mockRejectedValue(new Error('Merge Failed'));
      const warnSpy = jest.spyOn((provider as any).logger, 'warn');

      await expect(provider.mergeAccount(params)).rejects.toThrow(
        'Merge Failed',
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Account merge failed (non-critical)'),
      );
    });

    it('should re-throw when keypair is invalid', async () => {
      mockKeypairFromSecret.mockImplementation(() => {
        throw new Error('Invalid secret seed');
      });

      await expect(provider.mergeAccount(params)).rejects.toThrow(
        'Invalid secret seed',
      );
    });

    it.each([
      'op_has_subentries',
      'op_has_trustline',
      'op_has_offer',
      'op_malformed',
      'tx_bad_seq',
    ])('should re-throw merge failure: %s', async (message) => {
      mockLoadAccount.mockResolvedValue({ id: 'acc-123', sequence: '1' });
      mockSubmitTransaction.mockRejectedValue(new Error(message));

      await expect(provider.mergeAccount(params)).rejects.toThrow(message);
    });
  });

  describe('parseAsset', () => {
    it('should parse "native" to Native asset', () => {
      // Access private method through any for testing
      const result = (provider as any).parseAsset('native');
      expect(result.isNative()).toBe(true);
    });

    it('should parse "XLM" to Native asset', () => {
      const result = (provider as any).parseAsset('XLM');
      expect(result.isNative()).toBe(true);
    });

    it('should parse "CODE:ISSUER" to issued asset', () => {
      const result = (provider as any).parseAsset(
        'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      );
      expect(result.getCode()).toBe('USDC');
      expect(result.getIssuer()).toBe(
        'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      );
    });

    it('should parse asset codes at boundary lengths', () => {
      const issuer = validIssuer;
      expect(
        () => (provider as any).parseAsset(`A:${issuer}`),
      ).not.toThrow();
      expect(
        () => (provider as any).parseAsset(`USDC:${issuer}`),
      ).not.toThrow();
      expect(
        () => (provider as any).parseAsset(`ABCDEFGHIJKL:${issuer}`),
      ).not.toThrow();
    });

    it('should accept mixed-case and alphanumeric asset codes', () => {
      const issuer = validIssuer;
      expect(
        () => (provider as any).parseAsset(`uSdC1:${issuer}`),
      ).not.toThrow();
    });

    it('should throw error for invalid format', () => {
      expect(() => (provider as any).parseAsset('invalid')).toThrow();
    });

    it('should throw error for missing issuer', () => {
      expect(() => (provider as any).parseAsset('USDC:')).toThrow();
    });

    it('should throw error for extra delimiters', () => {
      expect(() => (provider as any).parseAsset('USDC:ISSUER:EXTRA')).toThrow();
    });

    it('should throw error for missing code', () => {
      expect(() => (provider as any).parseAsset(':ISSUER')).toThrow();
    });

    it('should throw error for invalid issuer checksum', () => {
      expect(() => (provider as any).parseAsset('USDC:GINVALID')).toThrow();
    });

    it('should throw error for invalid asset code length', () => {
      const issuer = validIssuer;
      expect(() =>
        (provider as any).parseAsset(`ABCDEFGHIJKLM:${issuer}`),
      ).toThrow();
    });

    it('should throw error for special characters in asset code', () => {
      const issuer = validIssuer;
      expect(() => (provider as any).parseAsset(`USD$:${issuer}`)).toThrow();
    });
  });

  describe('getAccountBalance', () => {
    it('should return native asset balance', async () => {
      mockLoadAccount.mockResolvedValue({
        balances: [
          {
            asset_type: 'native',
            balance: '123.4567890',
          },
        ],
      });

      const balance = await provider.getAccountBalance(
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
        'native',
      );

      expect(balance).toBe('123.4567890');
    });

    it('should return issued asset balance when trustline exists', async () => {
      mockLoadAccount.mockResolvedValue({
        balances: [
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer:
              'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
            balance: '42.0000000',
          },
        ],
      });

      const balance = await provider.getAccountBalance(
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
        'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      );

      expect(balance).toBe('42.0000000');
    });

    it('should return 0 when asset trustline is missing', async () => {
      mockLoadAccount.mockResolvedValue({
        balances: [
          {
            asset_type: 'native',
            balance: '5.0000000',
          },
        ],
      });

      const balance = await provider.getAccountBalance(
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
        'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      );

      expect(balance).toBe('0');
    });

    it('should return balance for one of multiple assets', async () => {
      mockLoadAccount.mockResolvedValue({
        balances: [
          {
            asset_type: 'native',
            balance: '10.0000000',
          },
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer:
              'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
            balance: '7.2500000',
          },
          {
            asset_type: 'credit_alphanum12',
            asset_code: 'ABCDEFGHIJKL',
            asset_issuer:
              'GDRXE2BQUC3AZK6Q7B2H6ZP7WZZ5NWG4A4G2W2X5Z5YUXK5LOH5U4T2M',
            balance: '1.0000000',
          },
        ],
      });

      const balance = await provider.getAccountBalance(
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
        'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      );

      expect(balance).toBe('7.2500000');
    });

    it('should return 0 for zero balance', async () => {
      mockLoadAccount.mockResolvedValue({
        balances: [
          {
            asset_type: 'native',
            balance: '0.0000000',
          },
        ],
      });

      const balance = await provider.getAccountBalance(
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
        'native',
      );

      expect(balance).toBe('0.0000000');
    });

    it('should throw when account is not found', async () => {
      mockLoadAccount.mockRejectedValue(new Error('Resource Missing'));

      await expect(
        provider.getAccountBalance(
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
          'native',
        ),
      ).rejects.toThrow('Resource Missing');
    });

    it('should throw when asset string is invalid', async () => {
      mockLoadAccount.mockResolvedValue({ balances: [] });
      const loggerErrorSpy = jest.spyOn(
        (provider as any).logger,
        'error',
      );

      await expect(
        provider.getAccountBalance(
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
          'invalid',
        ),
      ).rejects.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get account balance'),
      );
    });
  });
});
