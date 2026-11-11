import { Registry } from 'prom-client';
import { AccountMetricsProvider } from './account-metrics.provider.js';
import { AccountStatus } from '../../modules/accounts/enums/account-status.enum.js';

async function metricValues(
  registry: Registry,
  name: string,
): Promise<Record<string, number>> {
  const metric = registry.getSingleMetric(name);
  if (!metric) throw new Error(`Metric ${name} was not registered`);
  const snapshot = await metric.get();
  return Object.fromEntries(
    snapshot.values.map((sample) => [
      sample.labels.status as string,
      sample.value,
    ]),
  );
}

describe('AccountMetricsProvider', () => {
  it('sets account counts and oldest ages for the tracked statuses', async () => {
    const countBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { status: AccountStatus.CLAIMING, count: '2' },
        { status: AccountStatus.PARTIAL_SWEEP, count: '1' },
        { status: AccountStatus.PENDING_PAYMENT, count: '4' },
      ]),
    };
    const ageBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { status: AccountStatus.CLAIMING, age_seconds: '42.9' },
        { status: AccountStatus.PARTIAL_SWEEP, age_seconds: '7' },
      ]),
    };
    const repository = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(countBuilder)
        .mockReturnValueOnce(ageBuilder),
    };
    const registry = new Registry();
    const provider = new AccountMetricsProvider(repository as never, registry);

    await provider.refresh();

    await expect(metricValues(registry, 'accounts_by_status')).resolves.toEqual(
      expect.objectContaining({
        [AccountStatus.CLAIMING]: 2,
        [AccountStatus.PARTIAL_SWEEP]: 1,
        [AccountStatus.PENDING_PAYMENT]: 4,
        [AccountStatus.CLAIMED]: 0,
        [AccountStatus.EXPIRED]: 0,
        [AccountStatus.FAILED]: 0,
      }),
    );
    await expect(
      metricValues(registry, 'oldest_account_age_seconds'),
    ).resolves.toEqual(
      expect.objectContaining({
        [AccountStatus.CLAIMING]: 42.9,
        [AccountStatus.PARTIAL_SWEEP]: 7,
        [AccountStatus.PENDING_PAYMENT]: 0,
      }),
    );
  });

  it('logs and does not throw when the metric query fails', async () => {
    const repository = {
      createQueryBuilder: jest.fn(() => {
        throw new Error('database unavailable');
      }),
    };
    const registry = new Registry();
    const provider = new AccountMetricsProvider(repository as never, registry);
    const warnSpy = jest
      .spyOn(
        (provider as unknown as { logger: { warn: (msg: string) => void } })
          .logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    await expect(provider.refresh()).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('database unavailable'),
    );
  });
});
