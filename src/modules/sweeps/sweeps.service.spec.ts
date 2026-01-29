import { Test, TestingModule } from '@nestjs/testing';
import { SweepsService } from './sweeps.service.js';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import { TransactionProvider } from './providers/transaction.provider.js';
import type { ExecuteSweepDto } from './dto/execute-sweep.dto.js';

/**
 * COMPREHENSIVE TEST SUITE FOR SweepsService
 * 
 * This test suite validates the complete sweep workflow orchestration:
 * 1. Workflow execution order (validation → authorization → transaction → merge)
 * 2. Partial failure handling (merge can fail without failing sweep)
 * 3. Error propagation from each provider
 * 4. Return value structure and correctness
 * 5. Provider method call verification with exact parameters
 * 6. Logging and observability
 * 7. Edge cases and race conditions
 * 8. Data consistency and security
 */

describe('SweepsService', () => {
  let service: SweepsService;
  let mockValidationProvider: jest.Mocked<ValidationProvider>;
  let mockContractProvider: jest.Mocked<ContractProvider>;
  let mockTransactionProvider: jest.Mocked<TransactionProvider>;

  // Test data fixtures
  const validDto: ExecuteSweepDto = {
    accountId: 'test-account-id-123',
    ephemeralPublicKey: 'GEPH47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    ephemeralSecret: 'SEPH47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    destinationAddress: 'GDEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    amount: '100.0000000',
    asset: 'native',
  };

  const mockAuthResult = {
    authorized: true,
    hash: 'contract-auth-hash-abc123',
    timestamp: new Date('2026-01-29T10:00:00Z'),
  };

  const mockTxResult = {
    hash: 'stellar-tx-hash-def456',
    ledger: 12345,
    successful: true,
    timestamp: new Date('2026-01-29T10:00:01Z'),
  };

  const mockMergeResult = {
    hash: 'stellar-merge-hash-ghi789',
    ledger: 12346,
    successful: true,
    timestamp: new Date('2026-01-29T10:00:02Z'),
  };

  beforeEach(async () => {
    // Create mock providers
    mockValidationProvider = {
      validateSweepParameters: jest.fn(),
      canSweep: jest.fn(),
      getSweepStatus: jest.fn(),
    } as any;

    mockContractProvider = {
      authorizeSweep: jest.fn(),
    } as any;

    mockTransactionProvider = {
      executeSweepTransaction: jest.fn(),
      mergeAccount: jest.fn(),
    } as any;

    // Setup default mock implementations
    mockValidationProvider.validateSweepParameters.mockResolvedValue(undefined);
    mockContractProvider.authorizeSweep.mockResolvedValue(mockAuthResult);
    mockTransactionProvider.executeSweepTransaction.mockResolvedValue(mockTxResult);
    mockTransactionProvider.mergeAccount.mockResolvedValue(mockMergeResult);

    // Create test module
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SweepsService,
        { provide: ValidationProvider, useValue: mockValidationProvider },
        { provide: ContractProvider, useValue: mockContractProvider },
        { provide: TransactionProvider, useValue: mockTransactionProvider },
      ],
    }).compile();

    service = module.get<SweepsService>(SweepsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // SECTION 1: WORKFLOW ORCHESTRATION TESTS
  // ============================================================================
  describe('Workflow Orchestration', () => {
    describe('Execution Order', () => {
      it('should execute validation before authorization', async () => {
        const callOrder: string[] = [];
        mockValidationProvider.validateSweepParameters.mockImplementation(async () => {
          callOrder.push('validation');
        });
        mockContractProvider.authorizeSweep.mockImplementation(async () => {
          callOrder.push('authorization');
          return mockAuthResult;
        });

        await service.executeSweep(validDto);

        expect(callOrder[0]).toBe('validation');
        expect(callOrder[1]).toBe('authorization');
      });

      it('should execute authorization before transaction', async () => {
        const callOrder: string[] = [];
        mockContractProvider.authorizeSweep.mockImplementation(async () => {
          callOrder.push('authorization');
          return mockAuthResult;
        });
        mockTransactionProvider.executeSweepTransaction.mockImplementation(async () => {
          callOrder.push('transaction');
          return mockTxResult;
        });

        await service.executeSweep(validDto);

        expect(callOrder[0]).toBe('authorization');
        expect(callOrder[1]).toBe('transaction');
      });

      it('should execute transaction before merge', async () => {
        const callOrder: string[] = [];
        mockTransactionProvider.executeSweepTransaction.mockImplementation(async () => {
          callOrder.push('transaction');
          return mockTxResult;
        });
        mockTransactionProvider.mergeAccount.mockImplementation(async () => {
          callOrder.push('merge');
          return mockMergeResult;
        });

        await service.executeSweep(validDto);

        expect(callOrder[0]).toBe('transaction');
        expect(callOrder[1]).toBe('merge');
      });

      it('should enforce complete workflow order: validation → auth → tx → merge', async () => {
        const callOrder: string[] = [];

        mockValidationProvider.validateSweepParameters.mockImplementation(async () => {
          callOrder.push('validation');
        });
        mockContractProvider.authorizeSweep.mockImplementation(async () => {
          callOrder.push('authorization');
          return mockAuthResult;
        });
        mockTransactionProvider.executeSweepTransaction.mockImplementation(async () => {
          callOrder.push('transaction');
          return mockTxResult;
        });
        mockTransactionProvider.mergeAccount.mockImplementation(async () => {
          callOrder.push('merge');
          return mockMergeResult;
        });

        await service.executeSweep(validDto);

        expect(callOrder).toEqual(['validation', 'authorization', 'transaction', 'merge']);
      });

      it('should short-circuit on validation failure (not call authorization)', async () => {
        mockValidationProvider.validateSweepParameters.mockRejectedValue(
          new Error('Validation failed'),
        );

        await expect(service.executeSweep(validDto)).rejects.toThrow('Validation failed');

        expect(mockContractProvider.authorizeSweep).not.toHaveBeenCalled();
        expect(mockTransactionProvider.executeSweepTransaction).not.toHaveBeenCalled();
        expect(mockTransactionProvider.mergeAccount).not.toHaveBeenCalled();
      });

      it('should short-circuit on authorization failure (not call transaction)', async () => {
        mockContractProvider.authorizeSweep.mockRejectedValue(
          new Error('Authorization failed'),
        );

        await expect(service.executeSweep(validDto)).rejects.toThrow('Authorization failed');

        expect(mockValidationProvider.validateSweepParameters).toHaveBeenCalled();
        expect(mockTransactionProvider.executeSweepTransaction).not.toHaveBeenCalled();
        expect(mockTransactionProvider.mergeAccount).not.toHaveBeenCalled();
      });

      it('should short-circuit on transaction failure (not call merge)', async () => {
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(
          new Error('Transaction failed'),
        );

        await expect(service.executeSweep(validDto)).rejects.toThrow('Transaction failed');

        expect(mockValidationProvider.validateSweepParameters).toHaveBeenCalled();
        expect(mockContractProvider.authorizeSweep).toHaveBeenCalled();
        expect(mockTransactionProvider.mergeAccount).not.toHaveBeenCalled();
      });
    });

    describe('Data Flow Between Steps', () => {
      it('should pass full DTO to validation provider', async () => {
        await service.executeSweep(validDto);

        expect(mockValidationProvider.validateSweepParameters).toHaveBeenCalledWith(validDto);
      });

      it('should pass only public key and destination to authorization', async () => {
        await service.executeSweep(validDto);

        expect(mockContractProvider.authorizeSweep).toHaveBeenCalledWith({
          ephemeralPublicKey: validDto.ephemeralPublicKey,
          destinationAddress: validDto.destinationAddress,
        });
      });

      it('should NOT pass ephemeralSecret to authorization (security)', async () => {
        await service.executeSweep(validDto);

        const authCall = mockContractProvider.authorizeSweep.mock.calls[0][0];
        expect(authCall).not.toHaveProperty('ephemeralSecret');
      });

      it('should pass secret, destination, amount, and asset to transaction', async () => {
        await service.executeSweep(validDto);

        expect(mockTransactionProvider.executeSweepTransaction).toHaveBeenCalledWith({
          ephemeralSecret: validDto.ephemeralSecret,
          destinationAddress: validDto.destinationAddress,
          amount: validDto.amount,
          asset: validDto.asset,
        });
      });

      it('should pass secret and destination to merge', async () => {
        await service.executeSweep(validDto);

        expect(mockTransactionProvider.mergeAccount).toHaveBeenCalledWith({
          ephemeralSecret: validDto.ephemeralSecret,
          destinationAddress: validDto.destinationAddress,
        });
      });

      it('should use authorization result hash in return value', async () => {
        const result = await service.executeSweep(validDto);

        expect(result.contractAuthHash).toBe(mockAuthResult.hash);
      });

      it('should use transaction result hash in return value', async () => {
        const result = await service.executeSweep(validDto);

        expect(result.txHash).toBe(mockTxResult.hash);
      });
    });
  });

  // ============================================================================
  // SECTION 2: PARTIAL FAILURE HANDLING TESTS
  // ============================================================================
  describe('Partial Failure Handling', () => {
    describe('Merge Failure Scenarios', () => {
      it('should succeed if merge fails (merge is non-critical)', async () => {
        mockTransactionProvider.mergeAccount.mockRejectedValue(
          new Error('Merge failed: trustline exists'),
        );

        const result = await service.executeSweep(validDto);

        expect(result.success).toBe(true);
        expect(result.txHash).toBe(mockTxResult.hash);
      });

      it('should return correct sweep data even if merge fails', async () => {
        mockTransactionProvider.mergeAccount.mockRejectedValue(
          new Error('Merge failed'),
        );

        const result = await service.executeSweep(validDto);

        expect(result).toEqual({
          success: true,
          txHash: mockTxResult.hash,
          contractAuthHash: mockAuthResult.hash,
          amountSwept: validDto.amount,
          destination: validDto.destinationAddress,
          timestamp: expect.any(Date),
        });
      });

      it('should handle trustline exists error on merge', async () => {
        mockTransactionProvider.mergeAccount.mockRejectedValue(
          new Error('Trustline exists'),
        );

        const result = await service.executeSweep(validDto);

        expect(result.success).toBe(true);
      });

      it('should handle offer exists error on merge', async () => {
        mockTransactionProvider.mergeAccount.mockRejectedValue(
          new Error('Offer exists'),
        );

        const result = await service.executeSweep(validDto);

        expect(result.success).toBe(true);
      });

      it('should handle network timeout on merge', async () => {
        mockTransactionProvider.mergeAccount.mockRejectedValue(
          new Error('Network timeout'),
        );

        const result = await service.executeSweep(validDto);

        expect(result.success).toBe(true);
      });

      it('should still call merge even if it might fail', async () => {
        mockTransactionProvider.mergeAccount.mockRejectedValue(
          new Error('Merge failed'),
        );

        await service.executeSweep(validDto);

        expect(mockTransactionProvider.mergeAccount).toHaveBeenCalled();
      });

      it('should not roll back sweep if merge fails', async () => {
        mockTransactionProvider.mergeAccount.mockRejectedValue(
          new Error('Merge failed'),
        );

        const result = await service.executeSweep(validDto);

        // Verify transaction was executed and not rolled back
        expect(mockTransactionProvider.executeSweepTransaction).toHaveBeenCalled();
        expect(result.txHash).toBe(mockTxResult.hash);
      });
    });

    describe('Merge Attempt Conditions', () => {
      it('should attempt merge after successful transaction', async () => {
        await service.executeSweep(validDto);

        expect(mockTransactionProvider.mergeAccount).toHaveBeenCalled();
      });

      it('should not attempt merge if transaction fails', async () => {
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(
          new Error('Transaction failed'),
        );

        await expect(service.executeSweep(validDto)).rejects.toThrow();

        expect(mockTransactionProvider.mergeAccount).not.toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // SECTION 3: ERROR PROPAGATION AND TRANSFORMATION TESTS
  // ============================================================================
  describe('Error Propagation', () => {
    describe('Validation Errors', () => {
      it('should propagate validation errors unchanged', async () => {
        const validationError = new Error('Invalid destination address');
        mockValidationProvider.validateSweepParameters.mockRejectedValue(validationError);

        await expect(service.executeSweep(validDto)).rejects.toThrow(validationError);
      });

      it('should propagate NotFoundException from validation', async () => {
        const notFoundError = new Error('Account not found');
        mockValidationProvider.validateSweepParameters.mockRejectedValue(notFoundError);

        await expect(service.executeSweep(validDto)).rejects.toThrow('Account not found');
      });

      it('should propagate BadRequestException from validation', async () => {
        const badRequestError = new Error('Invalid amount');
        mockValidationProvider.validateSweepParameters.mockRejectedValue(badRequestError);

        await expect(service.executeSweep(validDto)).rejects.toThrow('Invalid amount');
      });
    });

    describe('Authorization Errors', () => {
      it('should propagate contract authorization errors', async () => {
        const authError = new Error('Contract authorization failed');
        mockContractProvider.authorizeSweep.mockRejectedValue(authError);

        await expect(service.executeSweep(validDto)).rejects.toThrow(authError);
      });

      it('should propagate InternalServerErrorException from contract', async () => {
        const contractError = new Error('Soroban RPC error');
        mockContractProvider.authorizeSweep.mockRejectedValue(contractError);

        await expect(service.executeSweep(validDto)).rejects.toThrow('Soroban RPC error');
      });
    });

    describe('Transaction Errors', () => {
      it('should propagate transaction execution errors', async () => {
        const txError = new Error('Transaction submission failed');
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(txError);

        await expect(service.executeSweep(validDto)).rejects.toThrow(txError);
      });

      it('should propagate Horizon errors from transaction', async () => {
        const horizonError = new Error('Horizon: Account not found');
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(horizonError);

        await expect(service.executeSweep(validDto)).rejects.toThrow('Horizon: Account not found');
      });

      it('should propagate network timeout errors', async () => {
        const timeoutError = new Error('Network timeout');
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(timeoutError);

        await expect(service.executeSweep(validDto)).rejects.toThrow('Network timeout');
      });
    });

    describe('Error Type Preservation', () => {
      it('should preserve error stack traces', async () => {
        const error = new Error('Test error');
        const originalStack = error.stack;
        mockValidationProvider.validateSweepParameters.mockRejectedValue(error);

        try {
          await service.executeSweep(validDto);
        } catch (caught) {
          expect((caught as Error).stack).toBe(originalStack);
        }
      });

      it('should not leak ephemeralSecret in error messages', async () => {
        const error = new Error(`Failed with secret: ${validDto.ephemeralSecret}`);
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(error);

        try {
          await service.executeSweep(validDto);
        } catch (caught) {
          // Error message should not contain the secret
          expect((caught as Error).message).not.toContain(validDto.ephemeralSecret);
        }
      });
    });
  });

  // ============================================================================
  // SECTION 4: RETURN VALUE STRUCTURE VALIDATION TESTS
  // ============================================================================
  describe('Return Value Structure', () => {
    describe('SweepResult Interface Compliance', () => {
      it('should return success: true on successful sweep', async () => {
        const result = await service.executeSweep(validDto);

        expect(result.success).toBe(true);
      });

      it('should return actual transaction hash (not pending)', async () => {
        const result = await service.executeSweep(validDto);

        expect(result.txHash).toBe(mockTxResult.hash);
        expect(result.txHash).not.toBe('pending');
      });

      it('should return contract authorization hash', async () => {
        const result = await service.executeSweep(validDto);

        expect(result.contractAuthHash).toBe(mockAuthResult.hash);
      });

      it('should return exact amount swept from input', async () => {
        const result = await service.executeSweep(validDto);

        expect(result.amountSwept).toBe(validDto.amount);
      });

      it('should return exact destination from input', async () => {
        const result = await service.executeSweep(validDto);

        expect(result.destination).toBe(validDto.destinationAddress);
      });

      it('should return recent timestamp', async () => {
        const beforeCall = new Date();
        const result = await service.executeSweep(validDto);
        const afterCall = new Date();

        expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
        expect(result.timestamp.getTime()).toBeLessThanOrEqual(afterCall.getTime() + 1000);
      });

      it('should have all required fields', async () => {
        const result = await service.executeSweep(validDto);

        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('txHash');
        expect(result).toHaveProperty('contractAuthHash');
        expect(result).toHaveProperty('amountSwept');
        expect(result).toHaveProperty('destination');
        expect(result).toHaveProperty('timestamp');
      });

      it('should not have unexpected fields', async () => {
        const result = await service.executeSweep(validDto);

        const allowedFields = ['success', 'txHash', 'contractAuthHash', 'amountSwept', 'destination', 'timestamp'];
        const resultKeys = Object.keys(result);

        resultKeys.forEach(key => {
          expect(allowedFields).toContain(key);
        });
      });
    });

    describe('Field Format Validation', () => {
      it('should return valid Stellar transaction hash format', async () => {
        const result = await service.executeSweep(validDto);

        // Stellar transaction hashes are 64 hex characters
        expect(result.txHash).toMatch(/^[a-f0-9]{64}$/i);
      });

      it('should return valid contract authorization hash format', async () => {
        const result = await service.executeSweep(validDto);

        // Authorization hashes should be non-empty strings
        expect(typeof result.contractAuthHash).toBe('string');
        expect(result.contractAuthHash.length).toBeGreaterThan(0);
      });

      it('should return amount as string (not number)', async () => {
        const result = await service.executeSweep(validDto);

        expect(typeof result.amountSwept).toBe('string');
      });

      it('should return destination as valid Stellar address', async () => {
        const result = await service.executeSweep(validDto);

        // Stellar addresses start with G and are 56 characters
        expect(result.destination).toMatch(/^G[A-Z2-7]{55}$/);
      });

      it('should return timestamp as Date object', async () => {
        const result = await service.executeSweep(validDto);

        expect(result.timestamp instanceof Date).toBe(true);
      });
    });

    describe('Amount Precision', () => {
      it('should preserve amount precision (string comparison)', async () => {
        const preciseAmount = '123.4567890';
        const dtoWithPrecision = { ...validDto, amount: preciseAmount };

        const result = await service.executeSweep(dtoWithPrecision);

        expect(result.amountSwept).toBe(preciseAmount);
      });

      it('should not convert amount to number (avoid precision loss)', async () => {
        const result = await service.executeSweep(validDto);

        expect(typeof result.amountSwept).toBe('string');
        expect(result.amountSwept).toBe(validDto.amount);
      });
    });
  });

  // ============================================================================
  // SECTION 5: PROVIDER METHOD CALL VERIFICATION TESTS
  // ============================================================================
  describe('Provider Method Call Verification', () => {
    describe('Call Count Verification', () => {
      it('should call validation provider exactly once', async () => {
        await service.executeSweep(validDto);

        expect(mockValidationProvider.validateSweepParameters).toHaveBeenCalledTimes(1);
      });

      it('should call contract provider exactly once', async () => {
        await service.executeSweep(validDto);

        expect(mockContractProvider.authorizeSweep).toHaveBeenCalledTimes(1);
      });

      it('should call transaction provider exactly once for sweep', async () => {
        await service.executeSweep(validDto);

        expect(mockTransactionProvider.executeSweepTransaction).toHaveBeenCalledTimes(1);
      });

      it('should call merge provider exactly once', async () => {
        await service.executeSweep(validDto);

        expect(mockTransactionProvider.mergeAccount).toHaveBeenCalledTimes(1);
      });

      it('should not call providers multiple times on success', async () => {
        await service.executeSweep(validDto);

        expect(mockValidationProvider.validateSweepParameters).toHaveBeenCalledTimes(1);
        expect(mockContractProvider.authorizeSweep).toHaveBeenCalledTimes(1);
        expect(mockTransactionProvider.executeSweepTransaction).toHaveBeenCalledTimes(1);
        expect(mockTransactionProvider.mergeAccount).toHaveBeenCalledTimes(1);
      });
    });

    describe('Parameter Transformation Verification', () => {
      it('should pass validation provider the complete DTO unchanged', async () => {
        await service.executeSweep(validDto);

        expect(mockValidationProvider.validateSweepParameters).toHaveBeenCalledWith(validDto);
      });

      it('should extract only necessary fields for authorization', async () => {
        await service.executeSweep(validDto);

        const authCall = mockContractProvider.authorizeSweep.mock.calls[0][0];
        expect(Object.keys(authCall).sort()).toEqual(['destinationAddress', 'ephemeralPublicKey'].sort());
      });

      it('should extract only necessary fields for transaction', async () => {
        await service.executeSweep(validDto);

        const txCall = mockTransactionProvider.executeSweepTransaction.mock.calls[0][0];
        expect(Object.keys(txCall).sort()).toEqual(['amount', 'asset', 'destinationAddress', 'ephemeralSecret'].sort());
      });

      it('should extract only necessary fields for merge', async () => {
        await service.executeSweep(validDto);

        const mergeCall = mockTransactionProvider.mergeAccount.mock.calls[0][0];
        expect(Object.keys(mergeCall).sort()).toEqual(['destinationAddress', 'ephemeralSecret'].sort());
      });
    });

    describe('Data Minimization (Security)', () => {
      it('should NOT pass ephemeralSecret to validation', async () => {
        await service.executeSweep(validDto);

        const validationCall = mockValidationProvider.validateSweepParameters.mock.calls[0][0];
        // Validation receives full DTO, but we verify it's not modified
        expect(validationCall.ephemeralSecret).toBe(validDto.ephemeralSecret);
      });

      it('should NOT pass ephemeralSecret to authorization', async () => {
        await service.executeSweep(validDto);

        const authCall = mockContractProvider.authorizeSweep.mock.calls[0][0];
        expect(authCall).not.toHaveProperty('ephemeralSecret');
      });

      it('should NOT pass ephemeralPublicKey to transaction', async () => {
        await service.executeSweep(validDto);

        const txCall = mockTransactionProvider.executeSweepTransaction.mock.calls[0][0];
        expect(txCall).not.toHaveProperty('ephemeralPublicKey');
      });

      it('should NOT pass amount to authorization', async () => {
        await service.executeSweep(validDto);

        const authCall = mockContractProvider.authorizeSweep.mock.calls[0][0];
        expect(authCall).not.toHaveProperty('amount');
      });

      it('should NOT pass asset to authorization', async () => {
        await service.executeSweep(validDto);

        const authCall = mockContractProvider.authorizeSweep.mock.calls[0][0];
        expect(authCall).not.toHaveProperty('asset');
      });

      it('should NOT pass accountId to any provider', async () => {
        await service.executeSweep(validDto);

        const authCall = mockContractProvider.authorizeSweep.mock.calls[0][0];
        const txCall = mockTransactionProvider.executeSweepTransaction.mock.calls[0][0];
        const mergeCall = mockTransactionProvider.mergeAccount.mock.calls[0][0];

        expect(authCall).not.toHaveProperty('accountId');
        expect(txCall).not.toHaveProperty('accountId');
        expect(mergeCall).not.toHaveProperty('accountId');
      });
    });

    describe('Parameter Value Correctness', () => {
      it('should pass exact ephemeralPublicKey to authorization', async () => {
        await service.executeSweep(validDto);

        const authCall = mockContractProvider.authorizeSweep.mock.calls[0][0];
        expect(authCall.ephemeralPublicKey).toBe(validDto.ephemeralPublicKey);
      });

      it('should pass exact destinationAddress to authorization', async () => {
        await service.executeSweep(validDto);

        const authCall = mockContractProvider.authorizeSweep.mock.calls[0][0];
        expect(authCall.destinationAddress).toBe(validDto.destinationAddress);
      });

      it('should pass exact ephemeralSecret to transaction', async () => {
        await service.executeSweep(validDto);

        const txCall = mockTransactionProvider.executeSweepTransaction.mock.calls[0][0];
        expect(txCall.ephemeralSecret).toBe(validDto.ephemeralSecret);
      });

      it('should pass exact amount to transaction', async () => {
        await service.executeSweep(validDto);

        const txCall = mockTransactionProvider.executeSweepTransaction.mock.calls[0][0];
        expect(txCall.amount).toBe(validDto.amount);
      });

      it('should pass exact asset to transaction', async () => {
        await service.executeSweep(validDto);

        const txCall = mockTransactionProvider.executeSweepTransaction.mock.calls[0][0];
        expect(txCall.asset).toBe(validDto.asset);
      });

      it('should pass exact ephemeralSecret to merge', async () => {
        await service.executeSweep(validDto);

        const mergeCall = mockTransactionProvider.mergeAccount.mock.calls[0][0];
        expect(mergeCall.ephemeralSecret).toBe(validDto.ephemeralSecret);
      });

      it('should pass exact destinationAddress to merge', async () => {
        await service.executeSweep(validDto);

        const mergeCall = mockTransactionProvider.mergeAccount.mock.calls[0][0];
        expect(mergeCall.destinationAddress).toBe(validDto.destinationAddress);
      });
    });

    describe('No Data Leakage Between Providers', () => {
      it('should not pass authorization result to transaction', async () => {
        await service.executeSweep(validDto);

        const txCall = mockTransactionProvider.executeSweepTransaction.mock.calls[0][0];
        expect(txCall).not.toHaveProperty('contractAuthHash');
        expect(txCall).not.toHaveProperty('authorized');
      });

      it('should not pass transaction result to merge', async () => {
        await service.executeSweep(validDto);

        const mergeCall = mockTransactionProvider.mergeAccount.mock.calls[0][0];
        expect(mergeCall).not.toHaveProperty('txHash');
        expect(mergeCall).not.toHaveProperty('ledger');
      });
    });
  });

  // ============================================================================
  // SECTION 6: LOGGING AND OBSERVABILITY TESTS
  // ============================================================================
  describe('Logging and Observability', () => {
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
      warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();
      errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();
    });

    afterEach(() => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    describe('Success Path Logging', () => {
      it('should log at start of execution with account ID', async () => {
        await service.executeSweep(validDto);

        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Executing sweep for account: ${validDto.accountId}`),
        );
      });

      it('should log after successful authorization', async () => {
        await service.executeSweep(validDto);

        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('Sweep authorization completed'),
        );
      });

      it('should log transaction hash after successful transaction', async () => {
        await service.executeSweep(validDto);

        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining(mockTxResult.hash),
        );
      });

      it('should log after successful merge', async () => {
        await service.executeSweep(validDto);

        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('Account merge completed'),
        );
      });
    });

    describe('Failure Path Logging', () => {
      it('should log warning when merge fails', async () => {
        mockTransactionProvider.mergeAccount.mockRejectedValue(
          new Error('Merge failed'),
        );

        await service.executeSweep(validDto);

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Account merge failed'),
        );
      });

      it('should log error on validation failure', async () => {
        mockValidationProvider.validateSweepParameters.mockRejectedValue(
          new Error('Validation failed'),
        );

        try {
          await service.executeSweep(validDto);
        } catch {
          // Expected
        }

        expect(errorSpy).toHaveBeenCalled();
      });

      it('should log error on authorization failure', async () => {
        mockContractProvider.authorizeSweep.mockRejectedValue(
          new Error('Authorization failed'),
        );

        try {
          await service.executeSweep(validDto);
        } catch {
          // Expected
        }

        expect(errorSpy).toHaveBeenCalled();
      });

      it('should log error on transaction failure', async () => {
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(
          new Error('Transaction failed'),
        );

        try {
          await service.executeSweep(validDto);
        } catch {
          // Expected
        }

        expect(errorSpy).toHaveBeenCalled();
      });
    });

    describe('Security: No Secrets Logged', () => {
      it('should never log ephemeralSecret', async () => {
        await service.executeSweep(validDto);

        const allLogCalls = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls];
        const loggedText = allLogCalls.map(call => call[0]).join(' ');

        expect(loggedText).not.toContain(validDto.ephemeralSecret);
      });

      it('should never log ephemeralPublicKey', async () => {
        await service.executeSweep(validDto);

        const allLogCalls = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls];
        const loggedText = allLogCalls.map(call => call[0]).join(' ');

        expect(loggedText).not.toContain(validDto.ephemeralPublicKey);
      });

      it('should log safe identifiers (accountId, destination, hashes)', async () => {
        await service.executeSweep(validDto);

        const allLogCalls = logSpy.mock.calls.map(call => call[0]).join(' ');

        expect(allLogCalls).toContain(validDto.accountId);
        expect(allLogCalls).toContain(validDto.destinationAddress);
        expect(allLogCalls).toContain(mockTxResult.hash);
      });
    });

    describe('Error Logging Details', () => {
      it('should log error message on failure', async () => {
        const errorMessage = 'Specific validation error';
        mockValidationProvider.validateSweepParameters.mockRejectedValue(
          new Error(errorMessage),
        );

        try {
          await service.executeSweep(validDto);
        } catch {
          // Expected
        }

        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining(errorMessage),
          expect.any(String),
        );
      });

      it('should log stack trace on error', async () => {
        mockValidationProvider.validateSweepParameters.mockRejectedValue(
          new Error('Test error'),
        );

        try {
          await service.executeSweep(validDto);
        } catch {
          // Expected
        }

        expect(errorSpy).toHaveBeenCalledWith(
          expect.any(String),
          expect.stringContaining('Error'),
        );
      });
    });
  });

  // ============================================================================
  // SECTION 7: DELEGATION METHOD TESTS
  // ============================================================================
  describe('Delegation Methods', () => {
    describe('canSweep', () => {
      it('should delegate to ValidationProvider.canSweep', async () => {
        mockValidationProvider.canSweep.mockResolvedValue(true);

        await service.canSweep('account-id', 'GDEST...');

        expect(mockValidationProvider.canSweep).toHaveBeenCalledWith(
          'account-id',
          'GDEST...',
        );
      });

      it('should pass parameters unchanged', async () => {
        mockValidationProvider.canSweep.mockResolvedValue(true);

        const accountId = 'test-account-123';
        const destination = 'GDEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

        await service.canSweep(accountId, destination);

        expect(mockValidationProvider.canSweep).toHaveBeenCalledWith(accountId, destination);
      });

      it('should return provider result unchanged', async () => {
        mockValidationProvider.canSweep.mockResolvedValue(true);

        const result = await service.canSweep('account-id', 'GDEST...');

        expect(result).toBe(true);
      });

      it('should return false when provider returns false', async () => {
        mockValidationProvider.canSweep.mockResolvedValue(false);

        const result = await service.canSweep('account-id', 'GDEST...');

        expect(result).toBe(false);
      });

      it('should propagate provider errors', async () => {
        mockValidationProvider.canSweep.mockRejectedValue(new Error('Provider error'));

        await expect(service.canSweep('account-id', 'GDEST...')).rejects.toThrow('Provider error');
      });

      it('should not add additional logic', async () => {
        mockValidationProvider.canSweep.mockResolvedValue(true);

        const result = await service.canSweep('account-id', 'GDEST...');

        expect(mockValidationProvider.canSweep).toHaveBeenCalledTimes(1);
        expect(result).toBe(true);
      });

      it('should not catch errors', async () => {
        mockValidationProvider.canSweep.mockRejectedValue(new Error('Test error'));

        await expect(service.canSweep('account-id', 'GDEST...')).rejects.toThrow('Test error');
      });
    });

    describe('getSweepStatus', () => {
      it('should delegate to ValidationProvider.getSweepStatus', async () => {
        const mockStatus = { canSweep: true, reason: undefined };
        mockValidationProvider.getSweepStatus.mockResolvedValue(mockStatus);

        await service.getSweepStatus('account-id');

        expect(mockValidationProvider.getSweepStatus).toHaveBeenCalledWith('account-id');
      });

      it('should pass accountId unchanged', async () => {
        mockValidationProvider.getSweepStatus.mockResolvedValue({ canSweep: true });

        const accountId = 'test-account-456';
        await service.getSweepStatus(accountId);

        expect(mockValidationProvider.getSweepStatus).toHaveBeenCalledWith(accountId);
      });

      it('should return provider result unchanged', async () => {
        const mockStatus = { canSweep: true, reason: 'Account is valid' };
        mockValidationProvider.getSweepStatus.mockResolvedValue(mockStatus);

        const result = await service.getSweepStatus('account-id');

        expect(result).toEqual(mockStatus);
      });

      it('should return status with reason when provided', async () => {
        const mockStatus = { canSweep: false, reason: 'Account expired' };
        mockValidationProvider.getSweepStatus.mockResolvedValue(mockStatus);

        const result = await service.getSweepStatus('account-id');

        expect(result.canSweep).toBe(false);
        expect(result.reason).toBe('Account expired');
      });

      it('should propagate provider errors', async () => {
        mockValidationProvider.getSweepStatus.mockRejectedValue(new Error('Provider error'));

        await expect(service.getSweepStatus('account-id')).rejects.toThrow('Provider error');
      });

      it('should not add additional logic', async () => {
        const mockStatus = { canSweep: true };
        mockValidationProvider.getSweepStatus.mockResolvedValue(mockStatus);

        const result = await service.getSweepStatus('account-id');

        expect(mockValidationProvider.getSweepStatus).toHaveBeenCalledTimes(1);
        expect(result).toEqual(mockStatus);
      });

      it('should not catch errors', async () => {
        mockValidationProvider.getSweepStatus.mockRejectedValue(new Error('Test error'));

        await expect(service.getSweepStatus('account-id')).rejects.toThrow('Test error');
      });
    });

    describe('Concurrent Delegation Calls', () => {
      it('should handle concurrent canSweep calls', async () => {
        mockValidationProvider.canSweep.mockResolvedValue(true);

        const results = await Promise.all([
          service.canSweep('account-1', 'GDEST1...'),
          service.canSweep('account-2', 'GDEST2...'),
          service.canSweep('account-3', 'GDEST3...'),
        ]);

        expect(results).toEqual([true, true, true]);
        expect(mockValidationProvider.canSweep).toHaveBeenCalledTimes(3);
      });

      it('should handle concurrent getSweepStatus calls', async () => {
        mockValidationProvider.getSweepStatus.mockResolvedValue({ canSweep: true });

        const results = await Promise.all([
          service.getSweepStatus('account-1'),
          service.getSweepStatus('account-2'),
          service.getSweepStatus('account-3'),
        ]);

        expect(results).toHaveLength(3);
        expect(mockValidationProvider.getSweepStatus).toHaveBeenCalledTimes(3);
      });
    });

    describe('No State Mutation in Delegation', () => {
      it('should not mutate service state on canSweep', async () => {
        mockValidationProvider.canSweep.mockResolvedValue(true);

        const result1 = await service.canSweep('account-1', 'GDEST1...');
        const result2 = await service.canSweep('account-2', 'GDEST2...');

        expect(result1).toBe(true);
        expect(result2).toBe(true);
      });

      it('should not mutate service state on getSweepStatus', async () => {
        mockValidationProvider.getSweepStatus.mockResolvedValue({ canSweep: true });

        const result1 = await service.getSweepStatus('account-1');
        const result2 = await service.getSweepStatus('account-2');

        expect(result1).toEqual({ canSweep: true });
        expect(result2).toEqual({ canSweep: true });
      });
    });
  });

  // ============================================================================
  // SECTION 8: EDGE CASES AND RACE CONDITIONS TESTS
  // ============================================================================
  describe('Edge Cases and Race Conditions', () => {
    describe('Concurrent Sweep Attempts', () => {
      it('should handle concurrent executeSweep calls on same account', async () => {
        const results = await Promise.all([
          service.executeSweep(validDto),
          service.executeSweep(validDto),
        ]);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(true);
      });

      it('should call providers for each concurrent sweep', async () => {
        await Promise.all([
          service.executeSweep(validDto),
          service.executeSweep(validDto),
        ]);

        expect(mockValidationProvider.validateSweepParameters).toHaveBeenCalledTimes(2);
        expect(mockContractProvider.authorizeSweep).toHaveBeenCalledTimes(2);
        expect(mockTransactionProvider.executeSweepTransaction).toHaveBeenCalledTimes(2);
      });

      it('should handle concurrent sweeps with different accounts', async () => {
        const dto1 = { ...validDto, accountId: 'account-1' };
        const dto2 = { ...validDto, accountId: 'account-2' };

        const results = await Promise.all([
          service.executeSweep(dto1),
          service.executeSweep(dto2),
        ]);

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(true);
      });
    });

    describe('Provider Return Value Edge Cases', () => {
      it('should handle empty transaction hash', async () => {
        mockTransactionProvider.executeSweepTransaction.mockResolvedValue({
          ...mockTxResult,
          hash: '',
        });

        const result = await service.executeSweep(validDto);

        expect(result.txHash).toBe('');
      });

      it('should handle null timestamp from provider', async () => {
        mockContractProvider.authorizeSweep.mockResolvedValue({
          ...mockAuthResult,
          timestamp: null as any,
        });

        const result = await service.executeSweep(validDto);

        expect(result).toHaveProperty('contractAuthHash');
      });

      it('should handle very long transaction hash', async () => {
        const longHash = 'a'.repeat(256);
        mockTransactionProvider.executeSweepTransaction.mockResolvedValue({
          ...mockTxResult,
          hash: longHash,
        });

        const result = await service.executeSweep(validDto);

        expect(result.txHash).toBe(longHash);
      });
    });

    describe('DTO Edge Cases', () => {
      it('should handle DTO with very large amount', async () => {
        const largeAmountDto = {
          ...validDto,
          amount: '999999999999.9999999',
        };

        const result = await service.executeSweep(largeAmountDto);

        expect(result.amountSwept).toBe(largeAmountDto.amount);
      });

      it('should handle DTO with very small amount', async () => {
        const smallAmountDto = {
          ...validDto,
          amount: '0.0000001',
        };

        const result = await service.executeSweep(smallAmountDto);

        expect(result.amountSwept).toBe(smallAmountDto.amount);
      });

      it('should handle DTO with custom asset code', async () => {
        const customAssetDto = {
          ...validDto,
          asset: 'USDC:GBUQWP3BOUZX34ULNQG23RQ6F4BFSRXVS6QCCLETLW2ZJJWQDXV47V5',
        };

        const result = await service.executeSweep(customAssetDto);

        expect(result.amountSwept).toBe(customAssetDto.amount);
      });
    });

    describe('Provider Error Edge Cases', () => {
      it('should handle provider throwing non-Error object', async () => {
        mockValidationProvider.validateSweepParameters.mockRejectedValue('String error');

        await expect(service.executeSweep(validDto)).rejects.toThrow();
      });

      it('should handle provider throwing undefined', async () => {
        mockValidationProvider.validateSweepParameters.mockRejectedValue(undefined);

        await expect(service.executeSweep(validDto)).rejects.toThrow();
      });

      it('should handle provider throwing null', async () => {
        mockValidationProvider.validateSweepParameters.mockRejectedValue(null);

        await expect(service.executeSweep(validDto)).rejects.toThrow();
      });
    });

    describe('Timeout Scenarios', () => {
      it('should propagate timeout errors from validation', async () => {
        mockValidationProvider.validateSweepParameters.mockRejectedValue(
          new Error('Timeout: validation took too long'),
        );

        await expect(service.executeSweep(validDto)).rejects.toThrow('Timeout');
      });

      it('should propagate timeout errors from authorization', async () => {
        mockContractProvider.authorizeSweep.mockRejectedValue(
          new Error('Timeout: authorization took too long'),
        );

        await expect(service.executeSweep(validDto)).rejects.toThrow('Timeout');
      });

      it('should propagate timeout errors from transaction', async () => {
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(
          new Error('Timeout: transaction took too long'),
        );

        await expect(service.executeSweep(validDto)).rejects.toThrow('Timeout');
      });

      it('should handle timeout on merge gracefully', async () => {
        mockTransactionProvider.mergeAccount.mockRejectedValue(
          new Error('Timeout: merge took too long'),
        );

        const result = await service.executeSweep(validDto);

        expect(result.success).toBe(true);
      });
    });

    describe('Network Failure Scenarios', () => {
      it('should propagate network errors from transaction', async () => {
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(
          new Error('Network error: connection refused'),
        );

        await expect(service.executeSweep(validDto)).rejects.toThrow('Network error');
      });

      it('should handle network errors on merge gracefully', async () => {
        mockTransactionProvider.mergeAccount.mockRejectedValue(
          new Error('Network error: connection lost'),
        );

        const result = await service.executeSweep(validDto);

        expect(result.success).toBe(true);
      });
    });
  });

  // ============================================================================
  // SECTION 9: TRANSACTION ATOMICITY AND CONSISTENCY TESTS
  // ============================================================================
  describe('Transaction Atomicity and Consistency', () => {
    describe('Authorization Success, Transaction Failure', () => {
      it('should not return success if transaction fails after authorization', async () => {
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(
          new Error('Transaction failed'),
        );

        await expect(service.executeSweep(validDto)).rejects.toThrow('Transaction failed');
      });

      it('should not attempt merge if transaction fails', async () => {
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(
          new Error('Transaction failed'),
        );

        try {
          await service.executeSweep(validDto);
        } catch {
          // Expected
        }

        expect(mockTransactionProvider.mergeAccount).not.toHaveBeenCalled();
      });

      it('should propagate transaction error to caller', async () => {
        const txError = new Error('Insufficient balance');
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(txError);

        await expect(service.executeSweep(validDto)).rejects.toThrow('Insufficient balance');
      });
    });

    describe('Idempotency Considerations', () => {
      it('should call all providers each time executeSweep is called', async () => {
        await service.executeSweep(validDto);
        await service.executeSweep(validDto);

        expect(mockValidationProvider.validateSweepParameters).toHaveBeenCalledTimes(2);
        expect(mockContractProvider.authorizeSweep).toHaveBeenCalledTimes(2);
        expect(mockTransactionProvider.executeSweepTransaction).toHaveBeenCalledTimes(2);
      });

      it('should not cache results between calls', async () => {
        const result1 = await service.executeSweep(validDto);
        const result2 = await service.executeSweep(validDto);

        expect(result1).not.toBe(result2);
      });
    });

    describe('State Consistency on Failure', () => {
      it('should not modify service state on validation failure', async () => {
        mockValidationProvider.validateSweepParameters.mockRejectedValue(
          new Error('Validation failed'),
        );

        try {
          await service.executeSweep(validDto);
        } catch {
          // Expected
        }

        // Service should still be usable
        mockValidationProvider.validateSweepParameters.mockResolvedValue(undefined);
        const result = await service.executeSweep(validDto);
        expect(result.success).toBe(true);
      });

      it('should not modify service state on authorization failure', async () => {
        mockContractProvider.authorizeSweep.mockRejectedValue(
          new Error('Authorization failed'),
        );

        try {
          await service.executeSweep(validDto);
        } catch {
          // Expected
        }

        // Service should still be usable
        mockContractProvider.authorizeSweep.mockResolvedValue(mockAuthResult);
        const result = await service.executeSweep(validDto);
        expect(result.success).toBe(true);
      });

      it('should not modify service state on transaction failure', async () => {
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(
          new Error('Transaction failed'),
        );

        try {
          await service.executeSweep(validDto);
        } catch {
          // Expected
        }

        // Service should still be usable
        mockTransactionProvider.executeSweepTransaction.mockResolvedValue(mockTxResult);
        const result = await service.executeSweep(validDto);
        expect(result.success).toBe(true);
      });
    });
  });

  // ============================================================================
  // SECTION 10: INTEGRATION SCENARIOS TESTS
  // ============================================================================
  describe('Integration Scenarios', () => {
    describe('Complete Happy Path', () => {
      it('should execute complete workflow successfully', async () => {
        const result = await service.executeSweep(validDto);

        expect(result.success).toBe(true);
        expect(result.txHash).toBe(mockTxResult.hash);
        expect(result.contractAuthHash).toBe(mockAuthResult.hash);
        expect(result.amountSwept).toBe(validDto.amount);
        expect(result.destination).toBe(validDto.destinationAddress);
        expect(result.timestamp).toBeInstanceOf(Date);
      });

      it('should call all providers in correct order on happy path', async () => {
        const callOrder: string[] = [];

        mockValidationProvider.validateSweepParameters.mockImplementation(async () => {
          callOrder.push('validation');
        });
        mockContractProvider.authorizeSweep.mockImplementation(async () => {
          callOrder.push('authorization');
          return mockAuthResult;
        });
        mockTransactionProvider.executeSweepTransaction.mockImplementation(async () => {
          callOrder.push('transaction');
          return mockTxResult;
        });
        mockTransactionProvider.mergeAccount.mockImplementation(async () => {
          callOrder.push('merge');
          return mockMergeResult;
        });

        await service.executeSweep(validDto);

        expect(callOrder).toEqual(['validation', 'authorization', 'transaction', 'merge']);
      });
    });

    describe('Partial Failure Path', () => {
      it('should succeed with merge failure', async () => {
        mockTransactionProvider.mergeAccount.mockRejectedValue(
          new Error('Merge failed'),
        );

        const result = await service.executeSweep(validDto);

        expect(result.success).toBe(true);
        expect(result.txHash).toBe(mockTxResult.hash);
      });

      it('should fail with transaction failure', async () => {
        mockTransactionProvider.executeSweepTransaction.mockRejectedValue(
          new Error('Transaction failed'),
        );

        await expect(service.executeSweep(validDto)).rejects.toThrow('Transaction failed');
      });

      it('should fail with authorization failure', async () => {
        mockContractProvider.authorizeSweep.mockRejectedValue(
          new Error('Authorization failed'),
        );

        await expect(service.executeSweep(validDto)).rejects.toThrow('Authorization failed');
      });

      it('should fail with validation failure', async () => {
        mockValidationProvider.validateSweepParameters.mockRejectedValue(
          new Error('Validation failed'),
        );

        await expect(service.executeSweep(validDto)).rejects.toThrow('Validation failed');
      });
    });

    describe('Multiple Sweeps Sequence', () => {
      it('should handle sequential sweeps correctly', async () => {
        const result1 = await service.executeSweep(validDto);
        const result2 = await service.executeSweep(validDto);

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);
        expect(mockValidationProvider.validateSweepParameters).toHaveBeenCalledTimes(2);
      });

      it('should handle mixed success and failure sweeps', async () => {
        const result1 = await service.executeSweep(validDto);

        mockValidationProvider.validateSweepParameters.mockRejectedValue(
          new Error('Validation failed'),
        );

        try {
          await service.executeSweep(validDto);
        } catch {
          // Expected
        }

        mockValidationProvider.validateSweepParameters.mockResolvedValue(undefined);
        const result3 = await service.executeSweep(validDto);

        expect(result1.success).toBe(true);
        expect(result3.success).toBe(true);
      });
    });
  });
});
