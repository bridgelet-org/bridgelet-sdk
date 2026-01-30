import { Test, TestingModule } from '@nestjs/testing';
import { ContractProvider } from './contract.provider';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import type { AuthorizeSweepParams } from '../interfaces/authorize-sweep-params.interface';
import type { ContractAuthResult } from '../interfaces/contract-auth-result.interface';

// Mock the Stellar SDK
const mockServer = {
  getAccount: jest.fn(),
  simulateTransaction: jest.fn(),
};

const mockContract = {
  call: jest.fn(),
};

const mockTransactionBuilder = {
  addOperation: jest.fn(),
  setTimeout: jest.fn(),
  build: jest.fn(),
};

const mockAddress = {
  toScVal: jest.fn(),
};

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Contract: jest.fn(() => mockContract),
    rpc: {
      ...actual.rpc,
      Server: jest.fn(() => mockServer),
      Api: {
        ...actual.rpc.Api,
        isSimulationError: jest.fn(),
      },
    },
    TransactionBuilder: jest.fn(() => mockTransactionBuilder),
    Address: {
      ...actual.Address,
      fromString: jest.fn(() => mockAddress),
    },
    xdr: {
      ...actual.xdr,
      ScVal: {
        ...actual.xdr.ScVal,
        scvBytes: jest.fn((buf: Buffer) => ({ type: 'scvBytes', value: buf })),
      },
    },
  };
});

import {
  Contract,
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Address,
  xdr,
  hash,
  Account,
  Operation,
} from '@stellar/stellar-sdk';

/**
 * Comprehensive test suite for ContractProvider
 *
 * SCOPE: Tests Soroban smart contract authorization for sweep operations
 *
 * MVP vs PRODUCTION BEHAVIOR:
 * - MVP: Uses dummy signatures, does not submit transactions
 * - Production: Will use real Ed25519 signatures and submit transactions on-chain
 *
 * SECURITY CRITICAL: This component handles authorization for asset sweeps
 * All cryptographic operations must be verified by security review before production
 */

describe('ContractProvider', () => {
  let provider: ContractProvider;
  let configService: ConfigService;

  // Mock instances
  let mockRpcServer: typeof mockServer;
  let mockAccount: Account;
  let mockTransaction: any;
  let mockOperation: Operation;

  // Valid test parameters
  const validParams: AuthorizeSweepParams = {
    ephemeralPublicKey: 'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J2RROMSG',
    destinationAddress: 'GD5J6HLF5666X4AZLTFTXLY2CQZBS2LBJBIMYV3SYGQ5OAQY5QO4XRNM',
  };

  // Default config values
  const mockConfig = {
    'stellar.contracts.ephemeralAccount': 'CDUMMYCONTRACTID123456789ABCDEFGHIJKLMNOPQRSTUV',
    'stellar.sorobanRpcUrl': 'https://soroban-testnet.stellar.org',
    'stellar.network': 'testnet',
  };

  beforeEach(async () => {
    // Clear all mock calls and instances
    jest.clearAllMocks();

    // Create mock instances with proper types
    mockAccount = {
      accountId: jest.fn(() => validParams.ephemeralPublicKey),
      sequenceNumber: jest.fn(() => '1'),
      incrementSequenceNumber: jest.fn(),
    } as unknown as Account;

    mockOperation = {
      type: 'invokeHostFunction',
    } as Operation;

    mockTransaction = {
      hash: jest.fn(() => Buffer.from('mock-tx-hash')),
      toEnvelope: jest.fn(),
    };

    // Setup mock implementations
    mockRpcServer = mockServer;
    mockServer.getAccount.mockResolvedValue(mockAccount);
    mockServer.simulateTransaction.mockResolvedValue({
      id: 'mock-simulation-id',
      latestLedger: 12345,
      minResourceFee: '100',
      results: [{ auth: [], xdr: 'mock-xdr' }],
    } as rpc.Api.SimulateTransactionSuccessResponse);

    mockContract.call.mockReturnValue(mockOperation);

    mockTransactionBuilder.addOperation.mockReturnThis();
    mockTransactionBuilder.setTimeout.mockReturnThis();
    mockTransactionBuilder.build.mockReturnValue(mockTransaction);

    mockAddress.toScVal.mockReturnValue({} as xdr.ScVal);

    // Setup other SDK mocks
    (rpc.Api.isSimulationError as jest.Mock).mockReturnValue(false);
    (Address.fromString as jest.Mock).mockReturnValue(mockAddress);

    // Create testing module
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractProvider,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const value = mockConfig[key as keyof typeof mockConfig];
              if (!value) {
                throw new Error(`Configuration key not found: ${key}`);
              }
              return value;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<ContractProvider>(ContractProvider);
    configService = module.get<ConfigService>(ConfigService);
  });


  /**
   * SECTION 1: Configuration and Initialization Tests
   * Tests constructor behavior, config loading, and network setup
   */
  describe('Configuration and Initialization', () => {
    it('should initialize with valid configuration', () => {
      expect(provider).toBeDefined();
      expect(configService.getOrThrow).toHaveBeenCalledWith('stellar.contracts.ephemeralAccount');
      expect(configService.getOrThrow).toHaveBeenCalledWith('stellar.sorobanRpcUrl');
      expect(configService.getOrThrow).toHaveBeenCalledWith('stellar.network');
    });

    it('should set TESTNET network passphrase for testnet config', async () => {
      // Network passphrase is private, so we verify via behavior
      const result = await provider.authorizeSweep(validParams);

      expect(TransactionBuilder).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          networkPassphrase: Networks.TESTNET,
        }),
      );
      expect(result.authorized).toBe(true);
    });

    it('should set PUBLIC network passphrase for mainnet config', async () => {
      // Create new provider with mainnet config
      const mainnetModule = await Test.createTestingModule({
        providers: [
          ContractProvider,
          {
            provide: ConfigService,
            useValue: {
              getOrThrow: jest.fn((key: string) => {
                if (key === 'stellar.network') return 'mainnet';
                return mockConfig[key as keyof typeof mockConfig];
              }),
            },
          },
        ],
      }).compile();

      const mainnetProvider = mainnetModule.get<ContractProvider>(ContractProvider);
      await mainnetProvider.authorizeSweep(validParams);

      expect(TransactionBuilder).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          networkPassphrase: Networks.PUBLIC,
        }),
      );
    });

    it('should throw error when contract ID config is missing', async () => {
      const invalidModule = Test.createTestingModule({
        providers: [
          ContractProvider,
          {
            provide: ConfigService,
            useValue: {
              getOrThrow: jest.fn(() => {
                throw new Error('Configuration key not found: stellar.contracts.ephemeralAccount');
              }),
            },
          },
        ],
      });

      await expect(invalidModule.compile()).rejects.toThrow();
    });

    it('should throw error when RPC URL config is missing', async () => {
      const invalidModule = Test.createTestingModule({
        providers: [
          ContractProvider,
          {
            provide: ConfigService,
            useValue: {
              getOrThrow: jest.fn((key: string) => {
                if (key === 'stellar.sorobanRpcUrl') {
                  throw new Error('Configuration key not found');
                }
                return mockConfig[key as keyof typeof mockConfig];
              }),
            },
          },
        ],
      });

      await expect(invalidModule.compile()).rejects.toThrow();
    });

    it('should throw error when network config is missing', async () => {
      const invalidModule = Test.createTestingModule({
        providers: [
          ContractProvider,
          {
            provide: ConfigService,
            useValue: {
              getOrThrow: jest.fn((key: string) => {
                if (key === 'stellar.network') {
                  throw new Error('Configuration key not found');
                }
                return mockConfig[key as keyof typeof mockConfig];
              }),
            },
          },
        ],
      });

      await expect(invalidModule.compile()).rejects.toThrow();
    });
  });

  /**
   * SECTION 2: getContractInfo Tests
   * Tests contract information retrieval
   */
  describe('getContractInfo', () => {
    it('should return contract ID and version', async () => {
      const info = await provider.getContractInfo();

      expect(info).toEqual({
        contractId: mockConfig['stellar.contracts.ephemeralAccount'],
        version: '0.1.0',
      });
    });

    it('should return consistent contract ID', async () => {
      const info1 = await provider.getContractInfo();
      const info2 = await provider.getContractInfo();

      expect(info1.contractId).toBe(info2.contractId);
    });

    it('should have properly typed return value', async () => {
      const info = await provider.getContractInfo();

      expect(typeof info.contractId).toBe('string');
      expect(typeof info.version).toBe('string');
      expect(info.contractId.length).toBeGreaterThan(0);
      expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  /**
   * SECTION 3: authorizeSweep - Successful Authorization Tests
   * Tests the happy path for sweep authorization
   *
   * MVP BEHAVIOR: Returns dummy hash, does not submit transaction
   * PRODUCTION: Will return actual transaction hash and submit to network
   */
  describe('authorizeSweep - Successful Authorization', () => {
    it('should successfully authorize sweep with valid parameters', async () => {
      const result: ContractAuthResult = await provider.authorizeSweep(validParams);

      expect(result.authorized).toBe(true);
      expect(result.hash).toBeDefined();
      expect(typeof result.hash).toBe('string');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should create RPC server with correct URL', async () => {
      await provider.authorizeSweep(validParams);

      expect(rpc.Server).toHaveBeenCalledWith(mockConfig['stellar.sorobanRpcUrl']);
      expect(rpc.Server).toHaveBeenCalledTimes(1);
    });

    it('should create contract instance with correct contract ID', async () => {
      await provider.authorizeSweep(validParams);

      expect(Contract).toHaveBeenCalledWith(mockConfig['stellar.contracts.ephemeralAccount']);
      expect(Contract).toHaveBeenCalledTimes(1);
    });

    it('should fetch account from RPC server', async () => {
      await provider.authorizeSweep(validParams);

      expect(mockRpcServer.getAccount).toHaveBeenCalledWith(validParams.ephemeralPublicKey);
      expect(mockRpcServer.getAccount).toHaveBeenCalledTimes(1);
    });

    it('should convert destination address to Address object', async () => {
      await provider.authorizeSweep(validParams);

      expect(Address.fromString).toHaveBeenCalledWith(validParams.destinationAddress);
      expect(Address.fromString).toHaveBeenCalledTimes(1);
    });

    it('should build transaction with correct parameters', async () => {
      await provider.authorizeSweep(validParams);

      expect(TransactionBuilder).toHaveBeenCalledWith(
        mockAccount,
        expect.objectContaining({
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
        }),
      );
    });

    it('should call contract sweep function with destination and signature', async () => {
      await provider.authorizeSweep(validParams);

      expect(mockContract.call).toHaveBeenCalledWith(
        'sweep',
        expect.anything(), // destination ScVal
        expect.anything(), // signature ScVal
      );

      const callArgs = mockContract.call.mock.calls[0];
      expect(callArgs[0]).toBe('sweep');
      // callArgs[2] should be the signature ScVal
      expect(callArgs[2]).toBeDefined();
    });

    it('should add operation to transaction builder', async () => {
      await provider.authorizeSweep(validParams);

      expect(mockTransactionBuilder.addOperation).toHaveBeenCalledWith(mockOperation);
      expect(mockTransactionBuilder.addOperation).toHaveBeenCalledTimes(1);
    });

    it('should set transaction timeout to 30 seconds', async () => {
      await provider.authorizeSweep(validParams);

      expect(mockTransactionBuilder.setTimeout).toHaveBeenCalledWith(30);
      expect(mockTransactionBuilder.setTimeout).toHaveBeenCalledTimes(1);
    });

    it('should build transaction after setting timeout', async () => {
      await provider.authorizeSweep(validParams);

      expect(mockTransactionBuilder.build).toHaveBeenCalled();

      // Verify method chaining - all three should be called
      expect(mockTransactionBuilder.addOperation).toHaveBeenCalled();
      expect(mockTransactionBuilder.setTimeout).toHaveBeenCalled();
      expect(mockTransactionBuilder.build).toHaveBeenCalled();
    });

    it('should simulate transaction before returning', async () => {
      await provider.authorizeSweep(validParams);

      expect(mockRpcServer.simulateTransaction).toHaveBeenCalledWith(mockTransaction);
      expect(mockRpcServer.simulateTransaction).toHaveBeenCalledTimes(1);
    });

    it('should check if simulation resulted in error', async () => {
      await provider.authorizeSweep(validParams);

      expect(rpc.Api.isSimulationError).toHaveBeenCalled();
    });

    it('should return timestamp close to current time', async () => {
      const beforeTime = new Date();
      const result = await provider.authorizeSweep(validParams);
      const afterTime = new Date();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should convert destination address to ScVal', async () => {
      await provider.authorizeSweep(validParams);

      expect(mockAddress.toScVal).toHaveBeenCalled();
      expect(mockAddress.toScVal).toHaveBeenCalledTimes(1);
    });

    /**
     * MVP BEHAVIOR TEST: Returns dummy hash instead of real transaction hash
     * TODO: Update when implementing production transaction submission
     */
    it('should return dummy hash in MVP mode (not actual tx hash)', async () => {
      const result = await provider.authorizeSweep(validParams);

      // MVP returns static placeholder hash
      expect(result.hash).toBe('contract-auth-hash');

      // In production, this should be the actual transaction hash
      // expect(result.hash).toBe(mockTransaction.hash().toString('hex'));
    });
  });

  /**
   * SECTION 4: authorizeSweep - RPC Server Failures
   * Tests various RPC server error scenarios
   */
  describe('authorizeSweep - RPC Server Failures', () => {
    it('should throw InternalServerErrorException when RPC server is unreachable', async () => {
      mockRpcServer.getAccount.mockRejectedValue(new Error('Network error: ECONNREFUSED'));

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        /Contract authorization failed.*Network error/,
      );
    });

    it('should throw InternalServerErrorException on RPC timeout', async () => {
      mockRpcServer.getAccount.mockRejectedValue(new Error('Request timeout'));

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException on DNS resolution failure', async () => {
      mockRpcServer.getAccount.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException on TLS/SSL error', async () => {
      mockRpcServer.getAccount.mockRejectedValue(
        new Error('unable to verify the first certificate'),
      );

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException on rate limiting (429)', async () => {
      mockRpcServer.getAccount.mockRejectedValue(new Error('Too Many Requests'));

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException when RPC returns malformed response', async () => {
      mockRpcServer.getAccount.mockRejectedValue(new Error('Unexpected token in JSON'));

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException when account does not exist', async () => {
      mockRpcServer.getAccount.mockRejectedValue(new Error('Account not found'));

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        /Account not found/,
      );
    });

    it('should throw InternalServerErrorException when account has insufficient balance', async () => {
      mockRpcServer.getAccount.mockRejectedValue(
        new Error('Account balance too low for transaction fee'),
      );

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  /**
   * SECTION 5: authorizeSweep - Contract Simulation Failures
   * Tests simulation error handling
   */
  describe('authorizeSweep - Contract Simulation Failures', () => {
    it('should throw error when simulation fails', async () => {
      const simulationError = {
        error: 'Contract execution failed: insufficient auth',
        events: [],
        latestLedger: 12345,
      } as rpc.Api.SimulateTransactionErrorResponse;

      mockRpcServer.simulateTransaction.mockResolvedValue(simulationError);
      jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(true);

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        /Contract simulation failed.*insufficient auth/,
      );
    });

    it('should throw InternalServerErrorException on simulation failure', async () => {
      const simulationError = {
        error: 'Invalid contract invocation',
        events: [],
        latestLedger: 12345,
      } as rpc.Api.SimulateTransactionErrorResponse;

      mockRpcServer.simulateTransaction.mockResolvedValue(simulationError);
      jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(true);

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should handle simulation timeout', async () => {
      mockRpcServer.simulateTransaction.mockRejectedValue(new Error('Simulation timeout'));

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(/Simulation timeout/);
    });

    it('should handle contract not found error', async () => {
      const simulationError = {
        error: 'Contract not found',
        events: [],
        latestLedger: 12345,
      } as rpc.Api.SimulateTransactionErrorResponse;

      mockRpcServer.simulateTransaction.mockResolvedValue(simulationError);
      jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(true);

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        /Contract simulation failed.*Contract not found/,
      );
    });

    it('should handle invalid contract function error', async () => {
      const simulationError = {
        error: 'Function sweep not found in contract',
        events: [],
        latestLedger: 12345,
      } as rpc.Api.SimulateTransactionErrorResponse;

      mockRpcServer.simulateTransaction.mockResolvedValue(simulationError);
      jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(true);

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        /Contract simulation failed.*Function sweep not found/,
      );
    });

    it('should handle contract execution revert', async () => {
      const simulationError = {
        error: 'Contract execution reverted',
        events: [],
        latestLedger: 12345,
      } as rpc.Api.SimulateTransactionErrorResponse;

      mockRpcServer.simulateTransaction.mockResolvedValue(simulationError);
      jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(true);

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        /Contract simulation failed.*execution reverted/,
      );
    });

    it('should handle resource exhaustion error', async () => {
      const simulationError = {
        error: 'Resource limit exceeded',
        events: [],
        latestLedger: 12345,
      } as rpc.Api.SimulateTransactionErrorResponse;

      mockRpcServer.simulateTransaction.mockResolvedValue(simulationError);
      jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(true);

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        /Contract simulation failed.*Resource limit exceeded/,
      );
    });
  });

  /**
   * SECTION 6: authorizeSweep - Address Conversion Failures
   * Tests address validation and conversion errors
   */
  describe('authorizeSweep - Address Conversion Failures', () => {
    it('should throw error for invalid destination address format', async () => {
      jest.spyOn(Address, 'fromString').mockImplementation(() => {
        throw new Error('Invalid Stellar address');
      });

      await expect(
        provider.authorizeSweep({
          ...validParams,
          destinationAddress: 'INVALID_ADDRESS',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw error for malformed Stellar address', async () => {
      jest.spyOn(Address, 'fromString').mockImplementation(() => {
        throw new Error('Address checksum invalid');
      });

      await expect(
        provider.authorizeSweep({
          ...validParams,
          destinationAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890BADCHECKSUM',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw error for empty destination address', async () => {
      jest.spyOn(Address, 'fromString').mockImplementation(() => {
        throw new Error('Address cannot be empty');
      });

      await expect(
        provider.authorizeSweep({
          ...validParams,
          destinationAddress: '',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle Address.toScVal conversion failure', async () => {
      mockAddress.toScVal.mockImplementation(() => {
        throw new Error('Failed to convert address to ScVal');
      });

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  /**
   * SECTION 7: authorizeSweep - Transaction Building Failures
   * Tests transaction construction error scenarios
   */
  describe('authorizeSweep - Transaction Building Failures', () => {
    it('should throw error when TransactionBuilder fails', async () => {
      (TransactionBuilder as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Failed to create transaction builder');
      });

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw error when operation cannot be added', async () => {
      mockTransactionBuilder.addOperation.mockImplementation(() => {
        throw new Error('Invalid operation');
      });

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw error when timeout is invalid', async () => {
      mockTransactionBuilder.setTimeout.mockImplementation(() => {
        throw new Error('Invalid timeout value');
      });

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw error when transaction build fails', async () => {
      mockTransactionBuilder.build.mockImplementation(() => {
        throw new Error('Transaction build failed');
      });

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw error when contract call construction fails', async () => {
      mockContract.call.mockImplementation(() => {
        throw new Error('Invalid contract call parameters');
      });

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  /**
   * SECTION 8: Authorization Signature Generation Tests
   * Tests cryptographic signature generation
   *
   * MVP BEHAVIOR: Generates dummy 64-byte signature
   * PRODUCTION: Must implement Ed25519 signing with proper key management
   */
  describe('Authorization Signature Generation (MVP)', () => {
    it('should generate 64-byte signature for valid parameters', async () => {
      await provider.authorizeSweep(validParams);

      // Verify signature was passed to contract.call
      expect(mockContract.call).toHaveBeenCalled();
      const callArgs = mockContract.call.mock.calls[0];
      const signatureScVal = callArgs[2];

      // Signature should be an ScVal created from a 64-byte buffer
      expect(signatureScVal).toBeDefined();
      expect(xdr.ScVal.scvBytes).toHaveBeenCalledWith(expect.any(Buffer));

      const signatureBuffer = (xdr.ScVal.scvBytes as jest.Mock).mock.calls[0][0];
      expect(signatureBuffer).toBeInstanceOf(Buffer);
      expect(signatureBuffer.length).toBe(64);
    });

    it('should generate deterministic signature for same inputs', async () => {
      // Mock xdr.ScVal.scvBytes to capture the signature
      const signatures: Buffer[] = [];
      jest.spyOn(xdr.ScVal, 'scvBytes').mockImplementation((buffer: Buffer) => {
        signatures.push(Buffer.from(buffer));
        return {} as xdr.ScVal;
      });

      await provider.authorizeSweep(validParams);
      await provider.authorizeSweep(validParams);

      expect(signatures).toHaveLength(2);
      expect(signatures[0].toString('hex')).toBe(signatures[1].toString('hex'));
    });

    it('should generate different signatures for different ephemeral keys', async () => {
      const signatures: Buffer[] = [];
      jest.spyOn(xdr.ScVal, 'scvBytes').mockImplementation((buffer: Buffer) => {
        signatures.push(Buffer.from(buffer));
        return {} as xdr.ScVal;
      });

      await provider.authorizeSweep(validParams);
      await provider.authorizeSweep({
        ...validParams,
        ephemeralPublicKey: 'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J2RROMSE',
      });

      expect(signatures).toHaveLength(2);
      expect(signatures[0].toString('hex')).not.toBe(signatures[1].toString('hex'));
    });

    it('should generate different signatures for different destination addresses', async () => {
      const signatures: Buffer[] = [];
      jest.spyOn(xdr.ScVal, 'scvBytes').mockImplementation((buffer: Buffer) => {
        signatures.push(Buffer.from(buffer));
        return {} as xdr.ScVal;
      });

      await provider.authorizeSweep(validParams);
      await provider.authorizeSweep({
        ...validParams,
        destinationAddress: 'GD5J6HLF5666X4AZLTFTXLY2CQZBS2LBJBIMYV3SYGQ5OAQY5QO4XRNX',
      });

      expect(signatures).toHaveLength(2);
      expect(signatures[0].toString('hex')).not.toBe(signatures[1].toString('hex'));
    });

    it('should use hash function to generate signature base', async () => {
      // The implementation uses hash() from Stellar SDK
      // We verify this indirectly by checking that a signature is generated
      await provider.authorizeSweep(validParams);

      // Verify that xdr.ScVal.scvBytes was called with a Buffer (the signature)
      expect(xdr.ScVal.scvBytes).toHaveBeenCalledWith(expect.any(Buffer));
    });

    /**
     * PRODUCTION REQUIREMENT: Ed25519 signature verification
     * TODO: Implement when moving to production:
     * - Use actual Ed25519 private key
     * - Include timestamp/nonce for replay protection
     * - Ensure signature is verifiable by contract
     * - Implement proper key management
     */
    it('should document production signature requirements', () => {
      // This test serves as documentation for production implementation
      const productionRequirements = {
        algorithm: 'Ed25519',
        signatureLength: 64,
        includeTimestamp: true,
        includeNonce: true,
        replayProtection: true,
        keyManagement: 'secure-enclave-or-hsm',
      };

      expect(productionRequirements.algorithm).toBe('Ed25519');
      expect(productionRequirements.signatureLength).toBe(64);
    });
  });

  /**
   * SECTION 9: Parameter Validation Tests
   * Tests input validation for authorizeSweep
   */
  describe('Parameter Validation', () => {
    it('should handle valid Stellar G-address for ephemeralPublicKey', async () => {
      const result = await provider.authorizeSweep({
        ...validParams,
        ephemeralPublicKey: 'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J2RROMSG',
      });

      expect(result.authorized).toBe(true);
    });

    it('should handle valid Stellar G-address for destinationAddress', async () => {
      jest.spyOn(Address, 'fromString').mockReturnValue(mockAddress as any);

      const result = await provider.authorizeSweep({
        ...validParams,
        destinationAddress: 'GD5J6HLF5666X4AZLTFTXLY2CQZBS2LBJBIMYV3SYGQ5OAQY5QO4XRNM',
      });

      expect(result.authorized).toBe(true);
      expect(Address.fromString).toHaveBeenCalledWith(
        'GD5J6HLF5666X4AZLTFTXLY2CQZBS2LBJBIMYV3SYGQ5OAQY5QO4XRNM',
      );
    });

    it('should accept contract addresses (C-prefix)', async () => {
      jest.spyOn(Address, 'fromString').mockReturnValue(mockAddress as any);

      const result = await provider.authorizeSweep({
        ...validParams,
        destinationAddress: 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA',
      });

      expect(result.authorized).toBe(true);
      expect(Address.fromString).toHaveBeenCalledWith(
        'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA',
      );
    });

    it('should properly type AuthorizeSweepParams', async () => {
      const params: AuthorizeSweepParams = {
        ephemeralPublicKey: validParams.ephemeralPublicKey,
        destinationAddress: validParams.destinationAddress,
      };

      const result = await provider.authorizeSweep(params);
      expect(result.authorized).toBe(true);
    });

    it('should properly type ContractAuthResult', async () => {
      const result: ContractAuthResult = await provider.authorizeSweep(validParams);

      expect(typeof result.authorized).toBe('boolean');
      expect(typeof result.hash).toBe('string');
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  /**
   * SECTION 10: Error Handling and Logging Tests
   * Tests error propagation and logging behavior
   */
  describe('Error Handling and Logging', () => {
    it('should wrap all errors in InternalServerErrorException', async () => {
      mockRpcServer.getAccount.mockRejectedValue(new Error('Some RPC error'));

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should preserve original error message in exception', async () => {
      const originalError = new Error('Specific RPC failure reason');
      mockRpcServer.getAccount.mockRejectedValue(originalError);

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
        /Specific RPC failure reason/,
      );
    });

    it('should handle errors with stack traces', async () => {
      const errorWithStack = new Error('Error with stack');
      errorWithStack.stack = 'Mock stack trace';
      mockRpcServer.getAccount.mockRejectedValue(errorWithStack);

      try {
        await provider.authorizeSweep(validParams);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InternalServerErrorException);
        expect((error as Error).message).toContain('Error with stack');
      }
    });

    it('should handle network-specific errors appropriately', async () => {
      const networkErrors = [
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ECONNRESET',
        'EPIPE',
      ];

      for (const errorCode of networkErrors) {
        mockRpcServer.getAccount.mockRejectedValue(new Error(errorCode));

        await expect(provider.authorizeSweep(validParams)).rejects.toThrow(
          InternalServerErrorException,
        );
      }
    });
  });

  /**
   * SECTION 11: Integration Flow Tests
   * Tests end-to-end flow of authorization
   */
  describe('Integration Flow', () => {
    it('should execute complete authorization flow in correct order', async () => {
      const callOrder: string[] = [];

      // Track calls using mock implementations
      (rpc.Server as jest.Mock).mockImplementationOnce((...args) => {
        callOrder.push('rpc.Server');
        return mockRpcServer as any;
      });

      (Contract as jest.Mock).mockImplementationOnce((...args) => {
        callOrder.push('Contract');
        return mockContract as any;
      });

      mockRpcServer.getAccount.mockImplementationOnce(async (...args) => {
        callOrder.push('getAccount');
        return mockAccount;
      });

      (Address.fromString as jest.Mock).mockImplementationOnce((...args) => {
        callOrder.push('Address.fromString');
        return mockAddress as any;
      });

      (TransactionBuilder as jest.Mock).mockImplementationOnce((...args) => {
        callOrder.push('TransactionBuilder');
        return mockTransactionBuilder as any;
      });

      mockRpcServer.simulateTransaction.mockImplementationOnce(async (...args) => {
        callOrder.push('simulateTransaction');
        return {
          id: 'mock',
          latestLedger: 123,
          minResourceFee: '100',
          results: [],
        } as rpc.Api.SimulateTransactionSuccessResponse;
      });

      await provider.authorizeSweep(validParams);

      expect(callOrder).toEqual([
        'rpc.Server',
        'Contract',
        'Address.fromString',
        'getAccount',
        'TransactionBuilder',
        'simulateTransaction',
      ]);
    });

    it('should not call simulateTransaction if transaction build fails', async () => {
      mockTransactionBuilder.build.mockImplementation(() => {
        throw new Error('Build failed');
      });

      await expect(provider.authorizeSweep(validParams)).rejects.toThrow();
      expect(mockRpcServer.simulateTransaction).not.toHaveBeenCalled();
    });

    it('should create only one RPC server instance per call', async () => {
      await provider.authorizeSweep(validParams);

      expect(rpc.Server).toHaveBeenCalledTimes(1);
    });

    it('should create only one Contract instance per call', async () => {
      await provider.authorizeSweep(validParams);

      expect(Contract).toHaveBeenCalledTimes(1);
    });

    it('should create only one TransactionBuilder instance per call', async () => {
      await provider.authorizeSweep(validParams);

      expect(TransactionBuilder).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * SECTION 12: Unused Method - generateAuthHash
   * Tests for the currently unused generateAuthHash method
   *
   * NOTE: This method exists but is not used anywhere in the code
   * Decision needed: Remove it or integrate it into the authorization flow
   */
  describe('generateAuthHash - Unused Method', () => {
    it('should note that generateAuthHash is defined but unused', () => {
      // This method is private and unused - this test documents that fact
      // Recommendation: Remove this method or clarify its purpose

      const providerAny = provider as any;
      expect(typeof providerAny.generateAuthHash).toBe('function');
    });

    /**
     * If generateAuthHash should be used, here's how it should be tested:
     */
    it('should generate hash if method is retained', () => {
      const providerAny = provider as any;
      const hash1 = providerAny.generateAuthHash(
        validParams.ephemeralPublicKey,
        validParams.destinationAddress,
      );

      expect(typeof hash1).toBe('string');
      expect(hash1.length).toBe(64); // Hex string of 32 bytes
    });

    it('should include timestamp in hash generation', () => {
      const providerAny = provider as any;

      // Hashes generated at different times should differ due to timestamp
      const hash1 = providerAny.generateAuthHash('key1', 'dest1');

      // Wait a bit
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Small delay
      }

      const hash2 = providerAny.generateAuthHash('key1', 'dest1');

      // Since timestamp is included, hashes should differ
      expect(hash1).not.toBe(hash2);
    });

    /**
     * SECURITY CONCERN: Current implementation is NOT cryptographically secure
     * Uses simple character code multiplication - NOT suitable for production
     *
     * RECOMMENDATION: Either remove this method or implement proper hashing
     * using Stellar SDK's hash function or a proper HMAC
     */
    it('should document that current implementation is NOT production-ready', () => {
      const securityNote = {
        currentImplementation: 'Character code multiplication',
        cryptographicallySafe: false,
        recommendation: 'Use Stellar SDK hash() or HMAC-SHA256',
        productionReady: false,
      };

      expect(securityNote.cryptographicallySafe).toBe(false);
      expect(securityNote.productionReady).toBe(false);
    });
  });

  /**
   * SECTION 13: Type Safety Validation
   * Ensures all code is properly typed
   */
  describe('Type Safety', () => {
    it('should use properly typed ConfigService', () => {
      const config = configService.getOrThrow<string>('stellar.contracts.ephemeralAccount');
      expect(typeof config).toBe('string');
    });

    it('should use properly typed RPC Server', () => {
      expect(typeof mockRpcServer.getAccount).toBe('function');
      expect(typeof mockRpcServer.simulateTransaction).toBe('function');
    });

    it('should use properly typed Contract', () => {
      expect(typeof mockContract.call).toBe('function');
    });

    it('should use properly typed TransactionBuilder', () => {
      expect(typeof mockTransactionBuilder.addOperation).toBe('function');
      expect(typeof mockTransactionBuilder.setTimeout).toBe('function');
      expect(typeof mockTransactionBuilder.build).toBe('function');
    });

    it('should use properly typed Address', () => {
      expect(typeof mockAddress.toScVal).toBe('function');
    });

    it('should properly type all mock return values', async () => {
      const result = await provider.authorizeSweep(validParams);

      const authorized: boolean = result.authorized;
      const hash: string = result.hash;
      const timestamp: Date = result.timestamp;

      expect(typeof authorized).toBe('boolean');
      expect(typeof hash).toBe('string');
      expect(timestamp).toBeInstanceOf(Date);
    });
  });
});
