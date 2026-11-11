import { Registry } from 'prom-client';
import { PaymentMonitorHealthProvider } from './payment-monitor-health.provider.js';

async function metricValue(
  registry: Registry,
  name: string,
): Promise<number | undefined> {
  const metric = registry.getSingleMetric(name);
  if (!metric) throw new Error(`Metric ${name} was not registered`);
  const snapshot = await metric.get();
  return snapshot.values[0]?.value;
}

describe('PaymentMonitorHealthProvider', () => {
  it('tracks elapsed seconds and resets on a processed event', async () => {
    const registry = new Registry();
    const provider = new PaymentMonitorHealthProvider(registry);
    const start = new Date('2026-01-01T00:00:00.000Z');

    provider.recordProcessedEvent(start);
    expect(
      provider.getSecondsSinceLastEvent(new Date('2026-01-01T00:01:05.000Z')),
    ).toBe(65);

    expect(
      await metricValue(registry, 'payment_monitor_seconds_since_last_event'),
    ).toBe(0);

    provider.recordProcessedEvent(new Date('2026-01-01T00:02:00.000Z'));
    expect(
      provider.getSecondsSinceLastEvent(new Date('2026-01-01T00:02:10.000Z')),
    ).toBe(10);
    expect(provider.getLastProcessedEventAt().toISOString()).toBe(
      '2026-01-01T00:02:00.000Z',
    );
  });

  it('updates the gauge and increments stream restart counter', async () => {
    const registry = new Registry();
    const provider = new PaymentMonitorHealthProvider(registry);
    provider.recordProcessedEvent(new Date('2026-01-01T00:00:00.000Z'));

    const seconds = provider.refreshGauge(new Date('2026-01-01T00:00:30.000Z'));
    provider.recordStreamRestart();
    provider.recordStreamRestart();

    expect(seconds).toBe(30);
    expect(
      await metricValue(registry, 'payment_monitor_seconds_since_last_event'),
    ).toBe(30);
    expect(
      await metricValue(registry, 'payment_monitor_stream_restarts_total'),
    ).toBe(2);
  });
});
