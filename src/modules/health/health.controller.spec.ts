import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller.js';
import { PaymentMonitorHealthProvider } from '../../common/metrics/payment-monitor-health.provider.js';

/** Shared factory: creates a NestJS test module with a mocked DataSource. */
async function buildModule(
  dataSourceMock: Partial<DataSource>,
  monitorLagSeconds = 0,
): Promise<TestingModule> {
  return Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      {
        provide: getDataSourceToken(),
        useValue: dataSourceMock,
      },
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: jest.fn((key: string) => {
            if (key === 'app.paymentMonitorLagThresholdMs') return 300000;
            throw new Error(`Config key not found: ${key}`);
          }),
        },
      },
      {
        provide: PaymentMonitorHealthProvider,
        useValue: {
          refreshGauge: jest.fn(() => monitorLagSeconds),
          getLastProcessedEventAt: jest.fn(
            () => new Date(Date.now() - monitorLagSeconds * 1_000),
          ),
        },
      },
    ],
  }).compile();
}

describe('HealthController', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Happy-path: database responds quickly
  // ──────────────────────────────────────────────────────────────────────────
  describe('when the database pool is healthy', () => {
    let controller: HealthController;

    beforeEach(async () => {
      const module = await buildModule({
        query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      });
      controller = module.get(HealthController);
    });

    it('returns status "ok"', async () => {
      const result = await controller.check();
      expect(result.status).toBe('ok');
    });

    it('marks database as healthy', async () => {
      const result = await controller.check();
      const { healthy, poolExhausted } = result.services.database;
      expect(healthy).toBe(true);
      expect(poolExhausted).toBe(false);
    });

    it('includes an ISO timestamp', async () => {
      const result = await controller.check();
      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('reports stellar and soroban as ok', async () => {
      const result = await controller.check();
      expect(result.services.stellar).toBe('ok');
      expect(result.services.soroban).toBe('ok');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Degraded path: pool acquire timeout (all connections exhausted)
  // ──────────────────────────────────────────────────────────────────────────
  describe('when the connection pool is exhausted (acquire timeout)', () => {
    let controller: HealthController;

    beforeEach(async () => {
      jest.useFakeTimers();

      const module = await buildModule({
        query: jest.fn().mockImplementation(
          () =>
            new Promise<never>(() => {
              /* intentionally never resolves */
            }),
        ),
      });
      controller = module.get(HealthController);
    });

    afterEach(() => jest.useRealTimers());

    it('returns status "degraded"', async () => {
      const promise = controller.check();
      jest.runAllTimers();
      const result = await promise;
      expect(result.status).toBe('degraded');
    });

    it('marks database as unhealthy with poolExhausted=true', async () => {
      const promise = controller.check();
      jest.runAllTimers();
      const result = await promise;
      const { healthy, poolExhausted, error } = result.services.database;
      expect(healthy).toBe(false);
      expect(poolExhausted).toBe(true);
      expect(error).toContain('exhausted');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Degraded path: generic database error (connection refused, etc.)
  // ──────────────────────────────────────────────────────────────────────────
  describe('payment monitor lag', () => {
    it('reports healthy when lag is within the configured threshold', async () => {
      const module = await buildModule(
        { query: jest.fn().mockResolvedValue([{ ok: 1 }]) },
        120,
      );
      const controller = module.get(HealthController);

      const result = await controller.check();

      expect(result.status).toBe('ok');
      expect(result.services.paymentMonitor).toEqual(
        expect.objectContaining({
          healthy: true,
          secondsSinceLastEvent: 120,
          thresholdMs: 300000,
        }),
      );
    });

    it('reports degraded when lag exceeds the configured threshold', async () => {
      const module = await buildModule(
        { query: jest.fn().mockResolvedValue([{ ok: 1 }]) },
        301,
      );
      const controller = module.get(HealthController);

      const result = await controller.check();

      expect(result.status).toBe('degraded');
      expect(result.services.paymentMonitor.healthy).toBe(false);
    });
  });

  describe('when the database throws a generic error', () => {
    let controller: HealthController;

    beforeEach(async () => {
      const module = await buildModule({
        query: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      });
      controller = module.get(HealthController);
    });

    it('returns status "degraded"', async () => {
      const result = await controller.check();
      expect(result.status).toBe('degraded');
    });

    it('marks database as unhealthy but NOT pool-exhausted', async () => {
      const result = await controller.check();
      const { healthy, poolExhausted, error } = result.services.database;
      expect(healthy).toBe(false);
      expect(poolExhausted).toBe(false);
      expect(error).toContain('ECONNREFUSED');
    });
  });
});
