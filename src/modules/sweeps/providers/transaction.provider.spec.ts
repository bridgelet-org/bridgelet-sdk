const { Test } = require('@nestjs/testing');
const { ConfigService } = require('@nestjs/config');
const { InternalServerErrorException, Logger } = require('@nestjs/common');
const { BASE_FEE, Networks } = require('@stellar/stellar-sdk');
const { TransactionProvider } = require('./transaction.provider');

const mockSubmitTransaction = jest.fn();
const mockLoadAccount = jest.fn();
const mockTransactionSign = jest.fn();
const mockTransactionBuild = jest.fn(() => ({ sign: mockTransactionSign }));
const mockTransactionSetTimeout = jest.fn().mockReturnThis();
const mockTransactionAddOperation = jest.fn().mockReturnThis();
const mockTransactionBuilder = jest
  .fn()
  .mockImplementation(() => ({
    addOperation: mockTransactionAddOperation,
    setTimeout: mockTransactionSetTimeout,
    build: mockTransactionBuild,
  }));
const mockPaymentOperation = jest.fn((params) => ({
  type: 'payment',
  ...params,
}));
const mockAccountMergeOperation = jest.fn((params) => ({
  type: 'accountMerge',
  ...params,
}));
const mockKeypair = {
  publicKey: jest
    .fn()
    .mockReturnValue(
      'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
    ),
  secret: jest.fn().mockReturnValue('S_SECRET'),
};
const mockKeypairFromSecret = jest.fn().mockReturnValue(mockKeypair);
const mockAssetNative = { isNative: jest.fn().mockReturnValue(true) };
const mockAssetConstructor = jest
  .fn()
  .mockImplementation((code, issuer) => {
  if (!code || !issuer) {
    throw new Error('Asset code and issuer are required');
  }
  if (!/^[a-zA-Z0-9]{1,12}$/.test(code)) {
    throw new Error('Invalid asset code');
  }
  if (!/^G[A-Z2-7]{55}$/.test(issuer)) {
    throw new Error('Invalid asset issuer');
  }
  return {
    isNative: () => false,
    getCode: () => code,
    getIssuer: () => issuer,
  };
}) as any;
mockAssetConstructor.native = jest.fn().mockReturnValue(mockAssetNative);

function getMockKeypairFromSecret(...args) {
  return mockKeypairFromSecret(...args);
}

function getMockTransactionBuilder(...args) {
  return mockTransactionBuilder(...args);
}

function getMockPaymentOperation(...args: any[]) {
  return mockPaymentOperation.apply(null, args);
}

function getMockAccountMergeOperation(...args: any[]) {
  return mockAccountMergeOperation.apply(null, args);
}

function getMockAsset(...args: any[]) {
  return mockAssetConstructor.apply(null, args);
}
getMockAsset.native = (...args: any[]) =>
  mockAssetConstructor.native.apply(null, args);

jest.mock('@stellar/stellar-sdk', () => {
  return {
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        loadAccount: mockLoadAccount,
        submitTransaction: mockSubmitTransaction,
      })),
    },
    Keypair: {
      fromSecret: getMockKeypairFromSecret,
    },
    TransactionBuilder: getMockTransactionBuilder,
    Operation: {
      payment: getMockPaymentOperation,
      accountMerge: getMockAccountMergeOperation,
    },
    Asset: getMockAsset,
    BASE_FEE: 100,
    Networks: {
      PUBLIC: 'Public Global Stellar Network ; September 2015',
      TESTNET: 'Test SDF Network ; September 2015',
    },
  };
});

describe('TransactionProvider', () => {
  let provider;
  let loggerErrorSpy;
  let loggerWarnSpy;

  const createProvider = async (network = 'testnet') => {
    const module = await Test.createTestingModule({
      providers: [
        TransactionProvider,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key) => {
              const config = {
                'stellar.horizonUrl': 'https://horizon-testnet.stellar.org',
                'stellar.network': network,
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    return module.get(TransactionProvider);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockKeypairFromSecret.mockReturnValue(mockKeypair);
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    provider = await createProvider();
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
    loggerWarnSpy.mockRestore();
  });

  describe('executeSweepTransaction', () => {
    const params = {
      ephemeralSecret: 'S_VALID_SECRET',
      destinationAddress: 'GD5J6HLF5666X4AZLTFTXGKWDBSUXSWXP6P5F20O1337',
      amount: '100',
      asset: 'native',
    };

    it('should execute payment transaction successfully with correct build flow', async () => {
      mockLoadAccount.mockResolvedValue({
        id: 'acc-123',
        sequence: '1',
        balances: [],
      });
      mockSubmitTransaction.mockResolvedValue({
        hash: 'tx-hash-123',
        ledger: 100,
        successful: true,
      });

      const result = await provider.executeSweepTransaction(params);

      expect(mockKeypairFromSecret).toHaveBeenCalledWith('S_VALID_SECRET');
      expect(mockLoadAccount).toHaveBeenCalledWith(
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
      );
      expect(mockPaymentOperation).toHaveBeenCalledWith({
        destination: params.destinationAddress,
        asset: mockAssetNative,
        amount: params.amount,
      });
      expect(mockTransactionBuilder).toHaveBeenCalledWith(
        { id: 'acc-123', sequence: '1', balances: [] },
        {
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
        },
      );
      expect(mockTransactionAddOperation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payment' }),
      );
      expect(mockTransactionSetTimeout).toHaveBeenCalledWith(30);
      expect(mockTransactionBuild).toHaveBeenCalled();
      expect(mockTransactionSign).toHaveBeenCalledWith(mockKeypair);
      expect(mockSubmitTransaction).toHaveBeenCalled();
      expect(result.hash).toBe('tx-hash-123');
      expect(result.successful).toBe(true);

      const addOrder = mockTransactionAddOperation.mock.invocationCallOrder[0];
      const timeoutOrder =
        mockTransactionSetTimeout.mock.invocationCallOrder[0];
      const buildOrder = mockTransactionBuild.mock.invocationCallOrder[0];
      const signOrder = mockTransactionSign.mock.invocationCallOrder[0];
      expect(addOrder).toBeLessThan(timeoutOrder);
      expect(timeoutOrder).toBeLessThan(buildOrder);
      expect(buildOrder).toBeLessThan(signOrder);
    });

    it('should select PUBLIC network passphrase for mainnet', async () => {
      provider = await createProvider('mainnet');
      mockLoadAccount.mockResolvedValue({
        id: 'acc-123',
        sequence: '1',
        balances: [],
      });
      mockSubmitTransaction.mockResolvedValue({
        hash: 'tx-hash-456',
        ledger: 200,
        successful: true,
      });

      await provider.executeSweepTransaction(params);

      expect(mockTransactionBuilder).toHaveBeenCalledWith(
        { id: 'acc-123', sequence: '1', balances: [] },
        {
          fee: BASE_FEE,
          networkPassphrase: Networks.PUBLIC,
        },
      );
    });

    it('should default to TESTNET network passphrase for invalid network config', async () => {
      provider = await createProvider('invalid');
      mockLoadAccount.mockResolvedValue({
        id: 'acc-123',
        sequence: '1',
        balances: [],
      });
      mockSubmitTransaction.mockResolvedValue({
        hash: 'tx-hash-789',
        ledger: 201,
        successful: true,
      });

      await provider.executeSweepTransaction(params);

      expect(mockTransactionBuilder).toHaveBeenCalledWith(
        { id: 'acc-123', sequence: '1', balances: [] },
        {
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
        },
      );
    });

    it('should throw InternalServerErrorException for account not found (loadAccount fail)', async () => {
      mockLoadAccount.mockRejectedValue(new Error('Resource Missing'));

      await expect(provider.executeSweepTransaction(params)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException for invalid ephemeral secret', async () => {
      mockKeypairFromSecret.mockImplementationOnce(() => {
        throw new Error('invalid secret');
      });

      await expect(provider.executeSweepTransaction(params)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should log Horizon extras and wrap submission errors', async () => {
      mockLoadAccount.mockResolvedValue({
        id: 'acc-123',
        sequence: '1',
        balances: [],
      });
      const error = new Error('tx_insufficient_balance');
      (error as any).response = {
        data: {
          extras: {
            result_codes: {
              transaction: 'tx_insufficient_balance',
            },
          },
        },
      };
      mockSubmitTransaction.mockRejectedValue(error);

      await expect(provider.executeSweepTransaction(params)).rejects.toThrow(
        'Sweep transaction failed: tx_insufficient_balance',
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Transaction extras: {"result_codes":{"transaction":"tx_insufficient_balance"}}',
      );
    });

    it('should throw InternalServerErrorException for submission errors without extras', async () => {
      mockLoadAccount.mockResolvedValue({
        id: 'acc-123',
        sequence: '1',
        balances: [],
      });
      mockSubmitTransaction.mockRejectedValue(new Error('Transaction Failed'));

      await expect(provider.executeSweepTransaction(params)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('mergeAccount', () => {
    const params = {
      ephemeralSecret: 'S_VALID_SECRET',
      destinationAddress: 'GD5J6HLF5666X4AZLTFTXGKWDBSUXSWXP6P5F20O1337',
    };

    it('should execute merge transaction successfully and sign', async () => {
      mockLoadAccount.mockResolvedValue({
        id: 'acc-123',
        sequence: '1',
        balances: [],
      });
      mockSubmitTransaction.mockResolvedValue({
        hash: 'merge-hash-123',
        ledger: 101,
        successful: true,
      });

      const result = await provider.mergeAccount(params);

      expect(mockTransactionBuilder).toHaveBeenCalledWith(
        { id: 'acc-123', sequence: '1', balances: [] },
        {
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
        },
      );
      expect(mockAccountMergeOperation).toHaveBeenCalledWith({
        destination: params.destinationAddress,
      });
      expect(mockTransactionAddOperation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'accountMerge' }),
      );
      expect(mockTransactionSetTimeout).toHaveBeenCalledWith(30);
      expect(mockTransactionSign).toHaveBeenCalledWith(mockKeypair);
      expect(result.hash).toBe('merge-hash-123');
      expect(result.successful).toBe(true);
    });

    it('should re-throw error if merge fails and log warning', async () => {
      mockLoadAccount.mockResolvedValue({
        id: 'acc-123',
        sequence: '1',
        balances: [],
      });
      mockSubmitTransaction.mockRejectedValue(new Error('Merge Failed'));

      await expect(provider.mergeAccount(params)).rejects.toThrow(
        'Merge Failed',
      );
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Account merge failed (non-critical): Merge Failed',
      );
    });
  });

  describe('parseAsset', () => {
    const issuer =
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

    it('should parse "native" to Native asset', () => {
      const result = provider.parseAsset('native');
      expect(result.isNative()).toBe(true);
    });

    it('should parse "XLM" to Native asset', () => {
      const result = provider.parseAsset('XLM');
      expect(result.isNative()).toBe(true);
    });

    it('should parse 1-character asset code', () => {
      const result = provider.parseAsset(`A:${issuer}`);
      expect(result.getCode()).toBe('A');
      expect(result.getIssuer()).toBe(issuer);
    });

    it('should parse 4-character asset code', () => {
      const result = provider.parseAsset(`USDC:${issuer}`);
      expect(result.getCode()).toBe('USDC');
      expect(result.getIssuer()).toBe(issuer);
    });

    it('should parse 12-character asset code', () => {
      const result = provider.parseAsset(`ABCDEFGHIJKL:${issuer}`);
      expect(result.getCode()).toBe('ABCDEFGHIJKL');
      expect(result.getIssuer()).toBe(issuer);
    });

    it('should preserve case sensitivity for asset codes', () => {
      const result = provider.parseAsset(`uSdC:${issuer}`);
      expect(result.getCode()).toBe('uSdC');
    });

    it('should throw error for invalid format without colon', () => {
      expect(() => provider.parseAsset('invalid')).toThrow(
        'Invalid asset format: invalid',
      );
    });

    it('should throw error for extra colons', () => {
      expect(() => provider.parseAsset('USDC:ISSUER:EXTRA')).toThrow(
        'Invalid asset format: USDC:ISSUER:EXTRA',
      );
    });

    it('should throw error for missing issuer', () => {
      expect(() => provider.parseAsset('USDC:')).toThrow(
        'Asset code and issuer are required',
      );
    });

    it('should throw error for invalid issuer format', () => {
      expect(() => provider.parseAsset('USDC:BADISSUER')).toThrow(
        'Invalid asset issuer',
      );
    });

    it('should throw error for invalid asset code characters', () => {
      expect(() => provider.parseAsset(`US*D:${issuer}`)).toThrow(
        'Invalid asset code',
      );
    });
  });

  describe('getAccountBalance', () => {
    const issuer =
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

    it('should return native balance when asset is native', async () => {
      mockLoadAccount.mockResolvedValue({
        balances: [
          { asset_type: 'native', balance: '123.4567890' },
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: issuer,
            balance: '10.0000000',
          },
        ],
      });

      await expect(
        provider.getAccountBalance(
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
          'native',
        ),
      ).resolves.toBe('123.4567890');
    });

    it('should return issued asset balance when trustline exists', async () => {
      mockLoadAccount.mockResolvedValue({
        balances: [
          { asset_type: 'native', balance: '1.0000000' },
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: issuer,
            balance: '5.1234567',
          },
        ],
      });

      await expect(
        provider.getAccountBalance(
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
          `USDC:${issuer}`,
        ),
      ).resolves.toBe('5.1234567');
    });

    it('should return zero when requested asset trustline does not exist', async () => {
      mockLoadAccount.mockResolvedValue({
        balances: [
          { asset_type: 'native', balance: '1.0000000' },
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDT',
            asset_issuer: issuer,
            balance: '9.0000000',
          },
        ],
      });

      await expect(
        provider.getAccountBalance(
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
          `USDC:${issuer}`,
        ),
      ).resolves.toBe('0');
    });

    it('should return zero when balance is missing', async () => {
      mockLoadAccount.mockResolvedValue({ balances: [] });

      await expect(
        provider.getAccountBalance(
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
          'native',
        ),
      ).resolves.toBe('0');
    });

    it('should propagate errors when account load fails', async () => {
      mockLoadAccount.mockRejectedValue(new Error('Account not found'));

      await expect(
        provider.getAccountBalance(
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
          'native',
        ),
      ).rejects.toThrow('Account not found');
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Failed to get account balance: Account not found',
      );
    });
  });
});
