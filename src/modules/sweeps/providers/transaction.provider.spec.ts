import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { TransactionProvider } from './transaction.provider.js';

const mockSubmitTransaction = jest.fn();
const mockLoadAccount = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  return {
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        loadAccount: mockLoadAccount,
        submitTransaction: mockSubmitTransaction,
      })),
    },
    Keypair: {
      fromSecret: jest.fn().mockReturnValue({
        publicKey: () =>
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
        secret: () => 'S_SECRET',
      }),
    },
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({
        sign: jest.fn(),
      }),
    })),
    Operation: {
      payment: jest.fn(),
      accountMerge: jest.fn(),
    },
    Asset: {
      native: jest.fn().mockReturnValue({ isNative: () => true }),
      constructor: jest.fn(),
    },
    BASE_FEE: 100,
    Networks: {
      PUBLIC: 'Public Global Stellar Network ; September 2015',
      TESTNET: 'Test SDF Network ; September 2015',
    },
  };
});

describe('TransactionProvider', () => {
  let provider: TransactionProvider;

  const mockConfigService = {
    getOrThrow: jest.fn(),
  };

  const mockHorizonServer = {
    loadAccount: jest.fn(),
    submitTransaction: jest.fn(),
  };

  beforeEach(async () => {
    mockSubmitTransaction.mockReset();
    mockLoadAccount.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionProvider,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key) => {
              if (key === 'stellar.horizonUrl')
                return 'https://horizon-testnet.stellar.org';
              if (key === 'stellar.network') return 'testnet';
              return null;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<TransactionProvider>(TransactionProvider);
  });

  beforeEach(async () => {
    mockConfigService.getOrThrow.mockImplementation((key: string) => {
      const config = {
        'stellar.horizonUrl': 'https://horizon-testnet.stellar.org',
        'stellar.network': 'testnet',
      };
      return config[key];
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionProvider,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    provider = module.get<TransactionProvider>(TransactionProvider);
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
      mockLoadAccount.mockResolvedValue({ id: 'acc-123', sequence: '1' });
      mockSubmitTransaction.mockResolvedValue({
        hash: 'tx-hash-123',
        ledger: 100,
        successful: true,
      });

      const result = await provider.executeSweepTransaction(params);

      expect(mockLoadAccount).toHaveBeenCalled();
      expect(mockSubmitTransaction).toHaveBeenCalled();
      expect(result.hash).toBe('tx-hash-123');
      expect(result.successful).toBe(true);
    });

    it('should throw InternalServerErrorException for account not found (loadAccount fail)', async () => {
      mockLoadAccount.mockRejectedValue(new Error('Resource Missing'));

      await expect(provider.executeSweepTransaction(params)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException for submission errors', async () => {
      mockLoadAccount.mockResolvedValue({ id: 'acc-123', sequence: '1' });
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

    it('should execute merge transaction successfully', async () => {
      mockLoadAccount.mockResolvedValue({ id: 'acc-123', sequence: '1' });
      mockSubmitTransaction.mockResolvedValue({
        hash: 'merge-hash-123',
        ledger: 101,
        successful: true,
      });

      const result = await provider.mergeAccount(params);
      expect(result.hash).toBe('merge-hash-123');
    });

    it('should re-throw error if merge fails (to be handled by service)', async () => {
      mockLoadAccount.mockResolvedValue({ id: 'acc-123', sequence: '1' });
      mockSubmitTransaction.mockRejectedValue(new Error('Merge Failed'));

      await expect(provider.mergeAccount(params)).rejects.toThrow(
        'Merge Failed',
      );
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

    it('should throw error for invalid format', () => {
      expect(() => (provider as any).parseAsset('invalid')).toThrow();
    });

    it('should throw error for missing issuer', () => {
      expect(() => (provider as any).parseAsset('USDC:')).toThrow();
    });
  });
});
