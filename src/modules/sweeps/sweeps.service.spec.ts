import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';

import { SweepsService } from './sweeps.service.js';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import { TransactionProvider } from './providers/transaction.provider.js';

describe('SweepsService', () => {
  let service: SweepsService;
  let validationProvider: ValidationProvider;
  let contractProvider: ContractProvider;
  let transactionProvider: TransactionProvider;

  const mockValidationProvider = {
    validateSweepParameters: jest.fn(),
    canSweep: jest.fn(),
    getSweepStatus: jest.fn(),
  };

  const mockContractProvider = {
    authorizeSweep: jest.fn(),
  };

  const mockTransactionProvider = {
    executeSweepTransaction: jest.fn(),
    mergeAccount: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SweepsService,
        {
          provide: ValidationProvider,
          useValue: mockValidationProvider,
        },
        {
          provide: ContractProvider,
          useValue: mockContractProvider,
        },
        {
          provide: TransactionProvider,
          useValue: mockTransactionProvider,
        },
      ],
    }).compile();

    service = module.get<SweepsService>(SweepsService);
    validationProvider = module.get<ValidationProvider>(ValidationProvider);
    contractProvider = module.get<ContractProvider>(ContractProvider);
    transactionProvider = module.get<TransactionProvider>(TransactionProvider);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('executeSweep', () => {
    const validDto = {
      accountId: 'test-account-id',
      ephemeralPublicKey:
        'GEPH47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      ephemeralSecret:
        'SEPH47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      destinationAddress:
        'GDEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      amount: '100.0000000',
      asset: 'native',
    };

    const mockAuthResult = {
      authorized: true,
      hash: 'auth-hash',
      timestamp: new Date(),
    };

    beforeEach(() => {
      mockValidationProvider.validateSweepParameters.mockResolvedValue(undefined);
      mockContractProvider.authorizeSweep.mockResolvedValue(mockAuthResult);
    });

    it('should execute complete sweep workflow', async () => {
      const result = await service.executeSweep(validDto);

      expect(result).toEqual({
        success: true,
        txHash: 'pending',
        contractAuthHash: mockAuthResult.hash,
        amountSwept: validDto.amount,
        destination: validDto.destinationAddress,
        timestamp: expect.any(Date),
      });
    });

    it('should call validation provider first', async () => {
      await service.executeSweep(validDto);

      expect(
        mockValidationProvider.validateSweepParameters,
      ).toHaveBeenCalledWith(validDto);
    });

    it('should call contract provider second', async () => {
      await service.executeSweep(validDto);

      expect(mockContractProvider.authorizeSweep).toHaveBeenCalledWith({
        ephemeralPublicKey: validDto.ephemeralPublicKey,
        destinationAddress: validDto.destinationAddress,
      });
    });

    it('should not call transaction provider in MVP flow', async () => {
      await service.executeSweep(validDto);

      expect(
        mockTransactionProvider.executeSweepTransaction,
      ).not.toHaveBeenCalled();
      expect(mockTransactionProvider.mergeAccount).not.toHaveBeenCalled();
    });

    it('should propagate validation errors', async () => {
      mockValidationProvider.validateSweepParameters.mockRejectedValue(
        new Error('Validation failed'),
      );

      await expect(service.executeSweep(validDto)).rejects.toThrow(
        'Validation failed',
      );
    });

    it('should propagate contract errors', async () => {
      mockContractProvider.authorizeSweep.mockRejectedValue(
        new Error('Contract failed'),
      );

      await expect(service.executeSweep(validDto)).rejects.toThrow(
        'Contract failed',
      );
    });
  });

  describe('canSweep', () => {
    it('should delegate to ValidationProvider', async () => {
      mockValidationProvider.canSweep.mockResolvedValue(true);

      const result = await service.canSweep('account-id', 'GDEST...');

      expect(mockValidationProvider.canSweep).toHaveBeenCalledWith(
        'account-id',
        'GDEST...',
      );
      expect(result).toBe(true);
    });
  });

  describe('getSweepStatus', () => {
    it('should delegate to ValidationProvider', async () => {
      const mockStatus = { canSweep: true };
      mockValidationProvider.getSweepStatus.mockResolvedValue(mockStatus);

      const result = await service.getSweepStatus('account-id');

      expect(mockValidationProvider.getSweepStatus).toHaveBeenCalledWith(
        'account-id',
      );
      expect(result).toEqual(mockStatus);
    });
  });
});