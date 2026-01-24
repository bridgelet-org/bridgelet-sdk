import { Test, TestingModule } from '@nestjs/testing';
import { ContractProvider } from './contract.provider';
import { ConfigService } from '@nestjs/config';

describe('ContractProvider', () => {
  let provider: ContractProvider;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('C_MOCK_CONTRACT_ID'),
          },
        },
      ],
    }).compile();

    provider = module.get<ContractProvider>(ContractProvider);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('authorizeSweep', () => {
    const validParams = {
      ephemeralPublicKey:
        'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665ON',
      destinationAddress: 'GD5J6HLF5666X4AZLTFTXGKWDBSUXSWXP6P5F20O1337',
    };

    it('should successfully authorize sweep with valid params', async () => {
      const result = await provider.authorizeSweep(validParams);

      expect(result.authorized).toBe(true);
      expect(result.hash).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should throw error for invalid ephemeral key format', async () => {
      await expect(
        provider.authorizeSweep({
          ...validParams,
          ephemeralPublicKey: 'INVALID_KEY',
        }),
      ).rejects.toThrow('Invalid ephemeral public key format');
    });

    it('should throw error for invalid destination address format', async () => {
      await expect(
        provider.authorizeSweep({
          ...validParams,
          destinationAddress: 'INVALID_KEY',
        }),
      ).rejects.toThrow('Invalid destination address format');
    });
  });

  describe('verifyAuthorization', () => {
    it('should return true for valid hash length (mock implementation)', async () => {
      // The current implementation checks if hash length is 64
      const validHash = 'a'.repeat(64);
      const result = await provider.verifyAuthorization(validHash);
      expect(result).toBe(true);
    });

    it('should return false for invalid hash', async () => {
      const result = await provider.verifyAuthorization('short-hash');
      expect(result).toBe(false);
    });
  });
});
