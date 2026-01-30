import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { Claim } from './entities/claim.entity.js';
import { Account, AccountStatus } from '../accounts/entities/account.entity.js';
type ClaimsService = import('./claims.service.js').ClaimsService;
type TokenVerificationProvider =
  import('./providers/token-verification.provider.js').TokenVerificationProvider;
type ClaimRedemptionProvider =
  import('./providers/claim-redemption.provider.js').ClaimRedemptionProvider;
type ClaimLookupProvider =
  import('./providers/claim-lookup.provider.js').ClaimLookupProvider;
type SweepsService = import('../sweeps/sweeps.service.js').SweepsService;
type WebhooksService = import('../webhooks/webhooks.service.js').WebhooksService;

const validPublicKey = Keypair.random().publicKey();
const validDestinationAddress = Keypair.random().publicKey();

class MockTokenExpiredError extends Error {}
class MockJsonWebTokenError extends Error {}

await jest.unstable_mockModule('jsonwebtoken', () => ({
  default: {
    verify: jest.fn(),
    TokenExpiredError: MockTokenExpiredError,
    JsonWebTokenError: MockJsonWebTokenError,
  },
}));

const jwt = (await import('jsonwebtoken')).default;
const { ClaimsService } = await import('./claims.service.js');
const { TokenVerificationProvider } = await import(
  './providers/token-verification.provider.js'
);
const { ClaimRedemptionProvider } = await import(
  './providers/claim-redemption.provider.js'
);
const { ClaimLookupProvider } = await import(
  './providers/claim-lookup.provider.js'
);
const { SweepsService } = await import('../sweeps/sweeps.service.js');
const { WebhooksService } = await import('../webhooks/webhooks.service.js');

describe('ClaimsService', () => {
  let service: ClaimsService;
  let tokenVerificationProvider: TokenVerificationProvider;
  let claimRedemptionProvider: ClaimRedemptionProvider;
  let claimLookupProvider: ClaimLookupProvider;

  const mockClaimRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockAccountRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
    getOrThrow: jest.fn(),
  };

  const mockSweepsService = {
    executeSweep: jest.fn(),
  };

  const mockWebhooksService = {
    triggerEvent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimsService,
        TokenVerificationProvider,
        ClaimRedemptionProvider,
        ClaimLookupProvider,
        {
          provide: getRepositoryToken(Claim),
          useValue: mockClaimRepository,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: mockAccountRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: SweepsService,
          useValue: mockSweepsService,
        },
        {
          provide: WebhooksService,
          useValue: mockWebhooksService,
        },
      ],
    }).compile();

    service = module.get<ClaimsService>(ClaimsService);
    tokenVerificationProvider = module.get<TokenVerificationProvider>(
      TokenVerificationProvider,
    );
    claimRedemptionProvider = module.get<ClaimRedemptionProvider>(
      ClaimRedemptionProvider,
    );
    claimLookupProvider = module.get<ClaimLookupProvider>(ClaimLookupProvider);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('TokenVerificationProvider', () => {
    const validToken = 'valid.jwt.token';
    const tokenHash =
      '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae';

    const mockAccount = {
      id: 'account-id',
      publicKey: validPublicKey,
      claimTokenHash: tokenHash,
      amount: '100.0000000',
      asset: 'native',
      status: AccountStatus.PENDING_CLAIM,
      expiresAt: new Date(Date.now() + 86400000), // 24 hours from now
    };

    const mockDecodedToken = {
      publicKey: validPublicKey,
      type: 'claim',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    beforeEach(() => {
      mockConfigService.getOrThrow.mockReturnValue('test-secret');
      (jwt.verify as jest.Mock).mockReturnValue(mockDecodedToken);
    });

    it('should successfully verify valid token with eligible account', async () => {
      mockAccountRepository.findOne.mockResolvedValue(mockAccount);

      const result =
        await tokenVerificationProvider.verifyClaimToken(validToken);

      expect(result).toEqual({
        valid: true,
        accountId: mockAccount.id,
        amount: mockAccount.amount,
        asset: mockAccount.asset,
        expiresAt: mockAccount.expiresAt,
      });
      expect(jwt.verify).toHaveBeenCalledWith(validToken, 'test-secret');
    });

    it('should return correct verification response with amount and expiry', async () => {
      mockAccountRepository.findOne.mockResolvedValue(mockAccount);

      const result =
        await tokenVerificationProvider.verifyClaimToken(validToken);

      expect(result.valid).toBe(true);
      expect(result.amount).toBe('100.0000000');
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should throw UnauthorizedException for expired JWT', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new (jwt as any).TokenExpiredError('jwt expired');
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for invalid JWT signature', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new (jwt as any).JsonWebTokenError('invalid signature');
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for token with wrong type', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({
        ...mockDecodedToken,
        type: 'access',
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for non-existent account', async () => {
      mockAccountRepository.findOne.mockResolvedValue(null);

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ConflictException for already claimed account', async () => {
      mockAccountRepository.findOne.mockResolvedValue({
        ...mockAccount,
        status: AccountStatus.CLAIMED,
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw UnauthorizedException for expired account', async () => {
      mockAccountRepository.findOne.mockResolvedValue({
        ...mockAccount,
        status: AccountStatus.EXPIRED,
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException for account without payment', async () => {
      mockAccountRepository.findOne.mockResolvedValue({
        ...mockAccount,
        status: AccountStatus.PENDING_PAYMENT,
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw UnauthorizedException when current time exceeds expiry', async () => {
      mockAccountRepository.findOne.mockResolvedValue({
        ...mockAccount,
        expiresAt: new Date(Date.now() - 1000), // Already expired
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('ClaimLookupProvider', () => {
    const claimId = 'claim-id-123';

    const mockClaim = {
      id: claimId,
      accountId: 'account-id',
      destinationAddress: validDestinationAddress,
      amountSwept: '100.0000000',
      asset: 'native',
      sweepTxHash: 'tx-hash',
      claimedAt: new Date('2026-01-14T17:49:20.265Z'),
      account: {
        id: 'account-id',
        publicKey: validPublicKey,
      },
    };

    it('should retrieve claim by ID with account relation', async () => {
      mockClaimRepository.findOne.mockResolvedValue(mockClaim);

      await claimLookupProvider.findClaimById(claimId);

      expect(mockClaimRepository.findOne).toHaveBeenCalledWith({
        where: { id: claimId },
        relations: ['account'],
      });
    });

    it('should return properly formatted ClaimDetailsDto', async () => {
      mockClaimRepository.findOne.mockResolvedValue(mockClaim);

      const result = await claimLookupProvider.findClaimById(claimId);

      expect(result).toEqual({
        id: mockClaim.id,
        accountId: mockClaim.accountId,
        destinationAddress: mockClaim.destinationAddress,
        amountSwept: mockClaim.amountSwept,
        asset: mockClaim.asset,
        sweepTxHash: mockClaim.sweepTxHash,
        claimedAt: mockClaim.claimedAt,
      });
    });

    it('should throw NotFoundException when claim does not exist', async () => {
      mockClaimRepository.findOne.mockResolvedValue(null);

      await expect(claimLookupProvider.findClaimById(claimId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('ClaimsService Integration - Token & Lookup', () => {
    const validToken = 'valid.jwt.token';
    const claimId = 'claim-id';

    const mockVerificationResponse = {
      valid: true,
      accountId: 'account-id',
      amount: '100.0000000',
      asset: 'native',
      expiresAt: new Date(),
    };

    const mockClaimDetails = {
      id: claimId,
      accountId: 'account-id',
      destinationAddress:
        validDestinationAddress,
      amountSwept: '100.0000000',
      asset: 'native',
      sweepTxHash: 'tx-hash',
      claimedAt: new Date(),
    };

    it('should delegate verifyClaimToken to TokenVerificationProvider', async () => {
      jest
        .spyOn(tokenVerificationProvider, 'verifyClaimToken')
        .mockResolvedValue(mockVerificationResponse);

      const result = await service.verifyClaimToken(validToken);

      expect(tokenVerificationProvider.verifyClaimToken).toHaveBeenCalledWith(
        validToken,
      );
      expect(result).toEqual(mockVerificationResponse);
    });

    it('should delegate findClaimById to ClaimLookupProvider', async () => {
      jest
        .spyOn(claimLookupProvider, 'findClaimById')
        .mockResolvedValue(mockClaimDetails);

      const result = await service.findClaimById(claimId);

      expect(claimLookupProvider.findClaimById).toHaveBeenCalledWith(claimId);
      expect(result).toEqual(mockClaimDetails);
    });

    it('should properly pass parameters to providers', async () => {
      jest
        .spyOn(tokenVerificationProvider, 'verifyClaimToken')
        .mockResolvedValue(mockVerificationResponse);

      await service.verifyClaimToken(validToken);

      expect(tokenVerificationProvider.verifyClaimToken).toHaveBeenCalledWith(
        validToken,
      );
    });

    it('should return provider responses unchanged', async () => {
      jest
        .spyOn(tokenVerificationProvider, 'verifyClaimToken')
        .mockResolvedValue(mockVerificationResponse);

      const result = await service.verifyClaimToken(validToken);

      expect(result).toBe(mockVerificationResponse);
    });
  });

  describe('ClaimRedemptionProvider', () => {
    const validToken = 'valid.jwt.token';
    const destinationAddress =
      validDestinationAddress;
    const tokenHash =
      '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae';

    const mockSweepResult = {
      txHash: 'sweep-tx-hash',
    };

    const createMockAccount = () => ({
      id: 'account-id',
      publicKey: validPublicKey,
      secretKeyEncrypted: Buffer.from('test-secret').toString('base64'),
      claimTokenHash: tokenHash,
      amount: '100.0000000',
      asset: 'native',
      status: AccountStatus.PENDING_CLAIM,
      expiresAt: new Date(Date.now() + 86400000),
      metadata: { userId: 'user-123' },
    });

    const createMockClaim = (account: ReturnType<typeof createMockAccount>) => ({
      id: 'claim-id',
      accountId: account.id,
      destinationAddress,
      sweepTxHash: mockSweepResult.txHash,
      amountSwept: account.amount,
      asset: account.asset,
      claimedAt: new Date(),
    });

    let mockAccount: ReturnType<typeof createMockAccount>;
    let mockClaim: ReturnType<typeof createMockClaim>;

    beforeEach(() => {
      mockAccount = createMockAccount();
      mockClaim = createMockClaim(mockAccount);
      mockConfigService.getOrThrow.mockReturnValue('test-secret');
      (jwt.verify as jest.Mock).mockReturnValue({
        publicKey: validPublicKey,
        type: 'claim',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      jest
        .spyOn(tokenVerificationProvider, 'verifyClaimToken')
        .mockResolvedValue({
          valid: true,
          accountId: mockAccount.id,
          amount: mockAccount.amount,
          asset: mockAccount.asset,
          expiresAt: mockAccount.expiresAt,
        });
      mockAccountRepository.findOne.mockResolvedValue(mockAccount);
      mockSweepsService.executeSweep.mockResolvedValue(mockSweepResult);
      mockClaimRepository.create.mockReturnValue(mockClaim);
      mockClaimRepository.save.mockResolvedValue(mockClaim);
      mockWebhooksService.triggerEvent.mockResolvedValue(undefined);
    });

    it('should successfully redeem claim and execute sweep', async () => {
      const result = await claimRedemptionProvider.redeemClaim(
        validToken,
        destinationAddress,
      );

      expect(result).toEqual({
        success: true,
        txHash: mockSweepResult.txHash,
        amountSwept: mockAccount.amount,
        asset: mockAccount.asset,
        destination: destinationAddress,
        sweptAt: expect.any(Date),
      });
    });

    it('should create claim record with correct data', async () => {
      await claimRedemptionProvider.redeemClaim(validToken, destinationAddress);

      expect(mockClaimRepository.create).toHaveBeenCalledWith({
        accountId: mockAccount.id,
        destinationAddress,
        sweepTxHash: mockSweepResult.txHash,
        amountSwept: mockAccount.amount,
        asset: mockAccount.asset,
        claimedAt: expect.any(Date),
      });
      expect(mockClaimRepository.save).toHaveBeenCalledWith(mockClaim);
    });

    it('should not trigger sweep.completed webhook in MVP', async () => {
      await claimRedemptionProvider.redeemClaim(validToken, destinationAddress);

      expect(mockWebhooksService.triggerEvent).not.toHaveBeenCalled();
    });

    it('should update account status to CLAIMED', async () => {
      await claimRedemptionProvider.redeemClaim(validToken, destinationAddress);

      expect(mockAccountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AccountStatus.CLAIMED,
          destinationAddress,
          claimedAt: expect.any(Date),
        }),
      );
    });

    it('should return idempotent response for already-claimed account', async () => {
      const claimedAccount = {
        ...mockAccount,
        status: AccountStatus.CLAIMED,
      };
      const existingClaim = {
        ...mockClaim,
        sweepTxHash: 'existing-tx-hash',
      };

      mockAccountRepository.findOne.mockResolvedValue(claimedAccount);
      mockClaimRepository.findOne.mockResolvedValue(existingClaim);

      const result = await claimRedemptionProvider.redeemClaim(
        validToken,
        destinationAddress,
      );

      expect(result).toEqual({
        success: true,
        txHash: existingClaim.sweepTxHash,
        amountSwept: existingClaim.amountSwept,
        asset: existingClaim.asset,
        destination: existingClaim.destinationAddress,
        sweptAt: existingClaim.claimedAt,
        message: 'Claim was already redeemed',
      });
    });

    it('should throw BadRequestException for invalid Stellar address (wrong format)', async () => {
      await expect(
        claimRedemptionProvider.redeemClaim(validToken, 'invalid-address'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for address not starting with G', async () => {
      await expect(
        claimRedemptionProvider.redeemClaim(
          validToken,
          'SABCD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for address with wrong length', async () => {
      await expect(
        claimRedemptionProvider.redeemClaim(validToken, 'GSHORT'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should rollback account status when sweep fails', async () => {
      mockSweepsService.executeSweep.mockRejectedValue(
        new Error('Sweep failed'),
      );

      await expect(
        claimRedemptionProvider.redeemClaim(validToken, destinationAddress),
      ).rejects.toThrow();

      expect(mockAccountRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AccountStatus.PENDING_CLAIM,
          destinationAddress: '',
          claimedAt: null,
        }),
      );
    });

    it('should not trigger sweep.failed webhook on error in MVP', async () => {
      const error = new Error('Sweep failed');
      mockSweepsService.executeSweep.mockRejectedValue(error);

      await expect(
        claimRedemptionProvider.redeemClaim(validToken, destinationAddress),
      ).rejects.toThrow();

      expect(mockWebhooksService.triggerEvent).not.toHaveBeenCalled();
    });

    it('should re-throw error after cleanup', async () => {
      const error = new Error('Sweep failed');
      mockSweepsService.executeSweep.mockRejectedValue(error);

      await expect(
        claimRedemptionProvider.redeemClaim(validToken, destinationAddress),
      ).rejects.toThrow('Sweep failed');
    });

    it('should call SweepsService with correct parameters', async () => {
      await claimRedemptionProvider.redeemClaim(validToken, destinationAddress);

      expect(mockSweepsService.executeSweep).toHaveBeenCalledWith({
        accountId: mockAccount.id,
        ephemeralPublicKey: mockAccount.publicKey,
        ephemeralSecret: 'test-secret',
        destinationAddress,
        amount: mockAccount.amount,
        asset: mockAccount.asset,
      });
    });

    it('should decrypt ephemeral secret correctly', async () => {
      await claimRedemptionProvider.redeemClaim(validToken, destinationAddress);

      expect(mockSweepsService.executeSweep).toHaveBeenCalledWith(
        expect.objectContaining({
          ephemeralSecret: 'test-secret',
        }),
      );
    });
  });

  describe('ClaimsService Integration - Redemption', () => {
    const validToken = 'valid.jwt.token';
    const destinationAddress =
      validDestinationAddress;

    const mockRedemptionResponse = {
      success: true,
      txHash: 'tx-hash',
      amountSwept: '100.0000000',
      asset: 'native',
      destination: destinationAddress,
      sweptAt: new Date(),
    };

    it('should delegate redeemClaim to ClaimRedemptionProvider', async () => {
      jest
        .spyOn(claimRedemptionProvider, 'redeemClaim')
        .mockResolvedValue(mockRedemptionResponse);

      const result = await service.redeemClaim(validToken, destinationAddress);

      expect(claimRedemptionProvider.redeemClaim).toHaveBeenCalledWith(
        validToken,
        destinationAddress,
      );
      expect(result).toEqual(mockRedemptionResponse);
    });

    it('should properly pass parameters to provider', async () => {
      jest
        .spyOn(claimRedemptionProvider, 'redeemClaim')
        .mockResolvedValue(mockRedemptionResponse);

      await service.redeemClaim(validToken, destinationAddress);

      expect(claimRedemptionProvider.redeemClaim).toHaveBeenCalledWith(
        validToken,
        destinationAddress,
      );
    });

    it('should return provider response unchanged', async () => {
      jest
        .spyOn(claimRedemptionProvider, 'redeemClaim')
        .mockResolvedValue(mockRedemptionResponse);

      const result = await service.redeemClaim(validToken, destinationAddress);

      expect(result).toBe(mockRedemptionResponse);
    });
  });
});
