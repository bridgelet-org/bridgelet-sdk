import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Registry, register } from 'prom-client';

/**
 * Shared liveness signal for both payment detection paths (#993):
 * the interval poller (`PaymentMonitorService`) and the Horizon SSE streams
 * (`PaymentMonitorProvider`).
 *
 * `lastProcessedEventAt` starts at process start rather than `null`, so a
 * freshly started service is not immediately reported as lagging. Any event
 * received by either monitor moves it forward. Health compares the elapsed
 * time against `app.paymentMonitorLagThresholdMs`.
 */
@Injectable()
export class PaymentMonitorHealthProvider {
  private readonly secondsSinceLastEventGauge: Gauge;
  private readonly streamRestartsCounter: Counter;

  private lastProcessedEventAt = new Date();

  constructor(registry: Registry = register) {
    this.secondsSinceLastEventGauge = this.getOrCreateGauge(
      'payment_monitor_seconds_since_last_event',
      'Seconds since the payment monitor last processed a Horizon event',
      registry,
    );
    this.streamRestartsCounter = this.getOrCreateCounter(
      'payment_monitor_stream_restarts_total',
      'Total number of Horizon payment stream error/reconnect events',
      registry,
    );

    this.secondsSinceLastEventGauge.set(0);
  }

  recordProcessedEvent(at: Date = new Date()): void {
    this.lastProcessedEventAt = new Date(at.getTime());
    this.secondsSinceLastEventGauge.set(0);
  }

  recordStreamRestart(): void {
    this.streamRestartsCounter.inc();
  }

  refreshGauge(now: Date = new Date()): number {
    const seconds = this.getSecondsSinceLastEvent(now);
    this.secondsSinceLastEventGauge.set(seconds);
    return seconds;
  }

  getSecondsSinceLastEvent(now: Date = new Date()): number {
    return Math.max(
      0,
      Math.floor((now.getTime() - this.lastProcessedEventAt.getTime()) / 1_000),
    );
  }

  getLastProcessedEventAt(): Date {
    return new Date(this.lastProcessedEventAt.getTime());
  }

  private getOrCreateGauge(
    name: string,
    help: string,
    registry: Registry,
  ): Gauge {
    const existing = registry.getSingleMetric(name);
    if (existing) return existing as Gauge;
    return new Gauge({ name, help, registers: [registry] });
  }

  private getOrCreateCounter(
    name: string,
    help: string,
    registry: Registry,
  ): Counter {
    const existing = registry.getSingleMetric(name);
    if (existing) return existing as Counter;
    return new Counter({ name, help, registers: [registry] });
  }
}
