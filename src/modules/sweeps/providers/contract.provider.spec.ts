import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

type ContractProvider = import('./contract.provider.js').ContractProvider;

const mockGetAccount = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockIsSimulationError = jest.fn();
const mockContractCall = jest.fn();
const mockAddressFromString = jest.fn();
const mockScvBytes = jest.fn();

let builderState: {
  addOperation: jest.Mock;
  setTimeout: jest.Mock;
  build: jest.Mock;
} | null = null;

function createMockTransactionBuilder() {
  const addOperation = jest.fn();
  const setTimeout = jest.fn();
  const build = jest.fn();
  const builder = { addOperation, setTimeout, build };

  addOperation.mockImplementation(() => builder);
  setTimeout.mockImplementation(() => builder);
  build.mockImplementation(() => ({ id: 'mock-tx' }));

  builderState = { addOperation, setTimeout, build };
  return builder;
}

await jest.unstable_mockModule('@stellar/stellar-sdk', async () => {
  return {
    rpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        simulateTransaction: mockSimulateTransaction,
      })),
      Api: {
        isSimulationError: mockIsSimulationError,
      },
    },
    Contract: jest.fn().mockImplementation(() => ({
      call: mockContractCall,
    })),
    TransactionBuilder: jest
      .fn()
      .mockImplementation(createMockTransactionBuilder),
    Address: {
      fromString: mockAddressFromString,
    },
    xdr: {
      ScVal: {
        scvBytes: mockScvBytes,
      },
    },
    hash: jest.fn(() => Buffer.alloc(32, 1)),
    BASE_FEE: '100',
    Networks: {
      PUBLIC: 'Public Global Stellar Network ; September 2015',
      TESTNET: 'Test SDF Network ; September 2015',
    },
    Keypair: {
      random: jest.fn(() => ({
        publicKey: () =>
          'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
      })),
    },
  };
});

const { Keypair } = await import('@stellar/stellar-sdk');
const { ContractProvider } = await import('./contract.provider.js');

describe('ContractProvider', () => {
  let provider: ContractProvider;
  let configService: ConfigService;

  beforeEach(async () => {
    mockGetAccount.mockResolvedValue({ id: 'acc-123', sequence: '1' });
    mockSimulateTransaction.mockResolvedValue({ result: 'ok' });
    mockIsSimulationError.mockReturnValue(false);
    mockContractCall.mockReturnValue({ type: 'contractCall' });
    mockScvBytes.mockReturnValue({ type: 'scvBytes' });
    mockAddressFromString.mockImplementation((address: string) => {
      if (!/^G[A-Z2-7]{55}$/.test(address)) {
        throw new Error('Invalid address');
      }
      return { toScVal: jest.fn().mockReturnValue({}) };
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractProvider,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'stellar.contracts.ephemeralAccount') {
                return 'C_MOCK_CONTRACT_ID';
              }
              if (key === 'stellar.sorobanRpcUrl') {
                return 'https://soroban-testnet.stellar.org';
              }
              if (key === 'stellar.network') {
                return 'testnet';
              }
              return null;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<ContractProvider>(ContractProvider);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('authorizeSweep', () => {
    const validParams = {
      ephemeralPublicKey: Keypair.random().publicKey(),
      destinationAddress: Keypair.random().publicKey(),
    };

    it('should successfully authorize sweep with valid params', async () => {
      const result = await provider.authorizeSweep(validParams);

      expect(result.authorized).toBe(true);
      expect(result.hash).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should wrap errors for invalid ephemeral key format', async () => {
      mockGetAccount.mockRejectedValueOnce(new Error('Invalid public key'));
      await expect(
        provider.authorizeSweep({
          ...validParams,
          ephemeralPublicKey: 'INVALID_KEY',
        }),
      ).rejects.toThrow('Contract authorization failed: Invalid public key');
    });

    it('should wrap errors for invalid destination address format', async () => {
      await expect(
        provider.authorizeSweep({
          ...validParams,
          destinationAddress: 'INVALID_KEY',
        }),
      ).rejects.toThrow('Contract authorization failed: Invalid address');
    });
  });

  describe('getContractInfo', () => {
    it('should return contract id and version', async () => {
      const result = await provider.getContractInfo();

      expect(result).toEqual({
        contractId: 'C_MOCK_CONTRACT_ID',
        version: '0.1.0',
      });
    });
  });
});
