import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller.js';

/** Shared factory: creates a NestJS test module with a mocked DataSource. */
async function buildModule(
  dataSourceMock: Partial<DataSource>,
): Promise<TestingModule> {
  return Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      {
        provide: getDataSourceToken(),
        useValue: dataSourceMock,
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
      const db = result.services.database as {
        healthy: boolean;
        poolExhausted: boolean;
      };
      expect(db.healthy).toBe(true);
      expect(db.poolExhausted).toBe(false);
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
      // Simulate a query that never resolves within the health-check window.
      // We use a jest fake timer to advance time past DB_HEALTH_TIMEOUT_MS so
      // the internal setTimeout fires without making the test actually wait.
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
      const db = result.services.database as {
        healthy: boolean;
        poolExhausted: boolean;
        error?: string;
      };
      expect(db.healthy).toBe(false);
      expect(db.poolExhausted).toBe(true);
      expect(db.error).toContain('exhausted');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Degraded path: generic database error (connection refused, etc.)
  // ──────────────────────────────────────────────────────────────────────────
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
      const db = result.services.database as {
        healthy: boolean;
        poolExhausted: boolean;
        error?: string;
      };
      expect(db.healthy).toBe(false);
      expect(db.poolExhausted).toBe(false);
      expect(db.error).toContain('ECONNREFUSED');
    });
  });
});
