import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  rpc,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  xdr,
  Account,
} from '@stellar/stellar-sdk';
import { StellarService, AccountInfo } from './stellar.service.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockRpcServer = {
  simulateTransaction: jest.fn(),
  getLatestLedger: jest.fn(),
  getAccount: jest.fn(),
  sendTransaction: jest.fn(),
};

const mockContract = { call: jest.fn() };

const mockTxBuilder = {
  addOperation: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn(),
};

const mockAssembledTxBuilder = {
  build: jest.fn(),
};

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual<typeof import('@stellar/stellar-sdk')>(
    '@stellar/stellar-sdk',
  );
  return {
    ...actual,
    Contract: jest.fn(() => mockContract),
    rpc: {
      ...actual.rpc,
      Server: jest.fn(() => mockRpcServer),
      Api: {
        ...actual.rpc.Api,
        isSimulationError: jest.fn(),
      },
      assembleTransaction: jest.fn(() => mockAssembledTxBuilder),
    },
    TransactionBuilder: jest.fn(() => mockTxBuilder),
  };
});

// ── Valid test addresses (real Stellar keypairs) ──────────────────────────────

const CREATOR_ADDR = 'GBFNL5K6HIHD3ZLZBX75P43LD3ZMJCUFJWIV63BEIC6VMBZ32SSR426Y';
const RECOVERY_ADDR = 'GDCUA4MGMSR6UBHWUFPNPFVJOE2575FXRMIPLA47WJ3PEVXYUNMFMU4D';
const SWEPT_TO_ADDR = 'GBFXKJJF4MYKYQQPUEWY3N7DZSI7IW4GGVFGFBVVIAVQITZO554ZJ5C3';
// Valid Stellar secret key
const FUNDING_SECRET = 'SBZBKSEXDKQ7NHWJDMF3S6LJH5B5YSIPY3ESUIWOSPUFAGYXUSFTZBVZ';
const FUNDING_PUBLIC = 'GBBFBAMZ2GTJNCHAHTRZVUJWS5ZABRRTVIV4272Q77RP4HI6LYPXURQD';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal ScVal map that mimics get_info() return value */
function buildAccountInfoScVal(overrides: Partial<{
  status: string;
  expiryLedger: number;
  paymentReceived: boolean;
  paymentCount: number;
  sweptTo: string | null;
}> = {}): xdr.ScVal {
  const {
    status = 'Active',
    expiryLedger = 1000,
    paymentReceived = false,
    paymentCount = 0,
    sweptTo = null,
  } = overrides;

  const actual = jest.requireActual<typeof import('@stellar/stellar-sdk')>(
    '@stellar/stellar-sdk',
  );

  const entry = (key: string, val: xdr.ScVal) =>
    new actual.xdr.ScMapEntry({ key: actual.xdr.ScVal.scvSymbol(key), val });

  const sweptToVal = sweptTo
    ? actual.xdr.ScVal.scvVec([actual.Address.fromString(sweptTo).toScVal()])
    : actual.xdr.ScVal.scvVec([]);

  return actual.xdr.ScVal.scvMap([
    entry('creator', actual.Address.fromString(CREATOR_ADDR).toScVal()),
    entry('status', actual.xdr.ScVal.scvVec([actual.xdr.ScVal.scvSymbol(status)])),
    entry('expiry_ledger', actual.xdr.ScVal.scvU32(expiryLedger)),
    entry('recovery_address', actual.Address.fromString(RECOVERY_ADDR).toScVal()),
    entry('payment_received', actual.xdr.ScVal.scvBool(paymentReceived)),
    entry('payment_count', actual.xdr.ScVal.scvU32(paymentCount)),
    entry('payments', actual.xdr.ScVal.scvVec([])),
    entry('swept_to', sweptToVal),
  ]);
}

/** Stub AccountInfo returned by mocked getAccountInfo */
const stubAccountInfo = (expiryLedger: number): AccountInfo => ({
  creator: CREATOR_ADDR,
  status: 'Active',
  expiryLedger,
  recoveryAddress: RECOVERY_ADDR,
  paymentReceived: false,
  paymentCount: 0,
  payments: [],
  sweptTo: null,
});

const CONTRACT_ID = 'CDUMMYCONTRACTID123456789ABCDEFGHIJKLMNOPQRSTUV';

const mockConfig: Record<string, string> = {
  'stellar.horizonUrl': 'https://horizon-testnet.stellar.org',
  'stellar.network': 'testnet',
  'stellar.sorobanRpcUrl': 'https://soroban-testnet.stellar.org',
  'stellar.contracts.ephemeralAccount': CONTRACT_ID,
  'stellar.fundingSecret': FUNDING_SECRET,
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('StellarService — getAccountInfo & expireAccount', () => {
  let service: StellarService;
  let mockTx: { sign: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockTx = { sign: jest.fn() };
    mockTxBuilder.build.mockReturnValue(mockTx);
    mockAssembledTxBuilder.build.mockReturnValue(mockTx);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const v = mockConfig[key];
              if (v === undefined) throw new Error(`Config not found: ${key}`);
              return v;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StellarService>(StellarService);
  });

  // ── getAccountInfo ──────────────────────────────────────────────────────────

  describe('getAccountInfo', () => {
    it('returns typed AccountInfo on success', async () => {
      const retval = buildAccountInfoScVal({ status: 'Active', expiryLedger: 500 });

      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: { retval },
        latestLedger: 100,
      } as unknown as rpc.Api.SimulateTransactionSuccessResponse);

      const info: AccountInfo = await service.getAccountInfo(CONTRACT_ID);

      expect(info.status).toBe('Active');
      expect(info.expiryLedger).toBe(500);
      expect(info.paymentReceived).toBe(false);
      expect(info.payments).toEqual([]);
      expect(info.sweptTo).toBeNull();
    });

    it('uses simulateTransaction (no signing)', async () => {
      const retval = buildAccountInfoScVal();
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: { retval },
        latestLedger: 100,
      } as unknown as rpc.Api.SimulateTransactionSuccessResponse);

      await service.getAccountInfo(CONTRACT_ID);

      expect(mockRpcServer.simulateTransaction).toHaveBeenCalledTimes(1);
      // sendTransaction must NOT be called for a read-only call
      expect(mockRpcServer.sendTransaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when contract is not initialized', async () => {
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(true);
      mockRpcServer.simulateTransaction.mockResolvedValue({
        error: 'Contract not initialized',
      } as unknown as rpc.Api.SimulateTransactionErrorResponse);

      await expect(service.getAccountInfo(CONTRACT_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws InternalServerErrorException on RPC failure', async () => {
      mockRpcServer.simulateTransaction.mockRejectedValue(new Error('RPC down'));

      await expect(service.getAccountInfo(CONTRACT_ID)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('throws InternalServerErrorException when retval is missing', async () => {
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: { retval: undefined },
        latestLedger: 100,
      } as unknown as rpc.Api.SimulateTransactionSuccessResponse);

      await expect(service.getAccountInfo(CONTRACT_ID)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('parses sweptTo address when present', async () => {
      const retval = buildAccountInfoScVal({ status: 'Swept', sweptTo: SWEPT_TO_ADDR });

      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: { retval },
        latestLedger: 100,
      } as unknown as rpc.Api.SimulateTransactionSuccessResponse);

      const info = await service.getAccountInfo(CONTRACT_ID);
      expect(info.status).toBe('Swept');
      expect(info.sweptTo).toBe(SWEPT_TO_ADDR);
    });
  });

  // ── expireAccount ───────────────────────────────────────────────────────────

  describe('expireAccount', () => {
    /**
     * Spy on getAccountInfo so expireAccount tests are isolated from
     * the ScVal parsing logic (already covered in getAccountInfo tests).
     */
    let getAccountInfoSpy: jest.SpyInstance;

    beforeEach(() => {
      getAccountInfoSpy = jest.spyOn(service, 'getAccountInfo');
    });

    it('calls expire() and submits when ledger has passed expiry', async () => {
      getAccountInfoSpy.mockResolvedValue(stubAccountInfo(500));
      mockRpcServer.getLatestLedger.mockResolvedValue({ latestLedger: 600 });
      mockRpcServer.getAccount.mockResolvedValue(new Account(FUNDING_PUBLIC, '1'));
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: {},
        latestLedger: 600,
      } as unknown as rpc.Api.SimulateTransactionSuccessResponse);
      mockRpcServer.sendTransaction.mockResolvedValue({ hash: 'abc' });

      await service.expireAccount(CONTRACT_ID);

      expect(mockRpcServer.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it('returns early (non-fatal) when current ledger < expiry_ledger', async () => {
      getAccountInfoSpy.mockResolvedValue(stubAccountInfo(1000));
      mockRpcServer.getLatestLedger.mockResolvedValue({ latestLedger: 500 });

      await expect(service.expireAccount(CONTRACT_ID)).resolves.toBeUndefined();
      expect(mockRpcServer.sendTransaction).not.toHaveBeenCalled();
    });

    it('returns early (non-fatal) when contract returns NotExpired', async () => {
      getAccountInfoSpy.mockResolvedValue(stubAccountInfo(500));
      mockRpcServer.getLatestLedger.mockResolvedValue({ latestLedger: 600 });
      mockRpcServer.getAccount.mockResolvedValue(new Account(FUNDING_PUBLIC, '1'));
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(true);
      mockRpcServer.simulateTransaction.mockResolvedValue({
        error: 'Error::NotExpired',
      } as unknown as rpc.Api.SimulateTransactionErrorResponse);

      await expect(service.expireAccount(CONTRACT_ID)).resolves.toBeUndefined();
      expect(mockRpcServer.sendTransaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for InvalidStatus (terminal)', async () => {
      getAccountInfoSpy.mockResolvedValue(stubAccountInfo(500));
      mockRpcServer.getLatestLedger.mockResolvedValue({ latestLedger: 600 });
      mockRpcServer.getAccount.mockResolvedValue(new Account(FUNDING_PUBLIC, '1'));
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(true);
      mockRpcServer.simulateTransaction.mockResolvedValue({
        error: 'Error::InvalidStatus',
      } as unknown as rpc.Api.SimulateTransactionErrorResponse);

      await expect(service.expireAccount(CONTRACT_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws InternalServerErrorException on unexpected RPC error', async () => {
      getAccountInfoSpy.mockResolvedValue(stubAccountInfo(500));
      mockRpcServer.getLatestLedger.mockResolvedValue({ latestLedger: 600 });
      mockRpcServer.getAccount.mockRejectedValue(new Error('RPC failure'));

      await expect(service.expireAccount(CONTRACT_ID)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
