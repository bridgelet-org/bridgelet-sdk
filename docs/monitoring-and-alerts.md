# Monitoring and Alerts

The service exposes Prometheus metrics at `GET /metrics` (unauthenticated).
`GET /health` returns `200` with `status: "ok"` or `status: "degraded"` and
includes both the PostgreSQL pool check and the payment-monitor lag check.

## Metrics added for stuck payments and monitor lag (#993)

| Metric                                     | Type    | Labels       | Meaning                                                                         |
| ------------------------------------------ | ------- | ------------ | ------------------------------------------------------------------------------- |
| `accounts_by_status`                       | gauge   | `status`     | Non-deleted accounts in each lifecycle state.                                   |
| `oldest_account_age_seconds`               | gauge   | `status`     | Age of the oldest account in `claiming`, `partial_sweep`, or `pending_payment`. |
| `expiry_job_failures_total`                | counter | -            | Expiry query, missing-contract-ID, and per-account expiry failures.             |
| `sweep_failure_by_code_total`              | counter | `error_code` | Failed sweeps by stable contract/Horizon error code.                            |
| `payment_monitor_stream_restarts_total`    | counter | -            | Horizon SSE error/reconnect events.                                             |
| `payment_monitor_seconds_since_last_event` | gauge   | -            | Seconds since either monitor last processed a Horizon event.                    |

Existing sweep metrics (`sweep_completed_total`, `sweep_failed_total`,
`sweep_success_rate`) remain available.

`accounts_by_status` and `oldest_account_age_seconds` are refreshed on the
scheduler maintenance pass (`EXPIRY_CHECK_INTERVAL_MS`, default 5 minutes).

## Configuration

| Variable                           | Default           | Effect                                                                                              |
| ---------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `STUCK_ACCOUNT_THRESHOLD_MS`       | `600000` (10 min) | Accounts in `CLAIMING`/`PARTIAL_SWEEP` older than this emit `account.stuck` once per stuck episode. |
| `PAYMENT_MONITOR_LAG_THRESHOLD_MS` | `300000` (5 min)  | `/health` becomes `degraded` when `payment_monitor_seconds_since_last_event` exceeds this.          |

## Prometheus alert rules

```yaml
groups:
  - name: bridgelet-payments
    rules:
      - alert: BridgeletStuckAccount
        expr: oldest_account_age_seconds{status=~"claiming|partial_sweep"} > 900
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'Account stuck in {{ $labels.status }} for {{ $value | humanizeDuration }}'
          description: >-
            An account has remained in a non-terminal sweep state beyond the
            expected window. Check the claim/sweep logs for the account, verify
            Horizon payment status, and retry the claim with the original token
            (PARTIAL_SWEEP) or investigate the CLAIMING lock.

      - alert: BridgeletExpiryJobFailing
        expr: increase(expiry_job_failures_total[15m]) > 0
        labels:
          severity: warning
        annotations:
          summary: 'Expiry job failures detected'
          description: >-
            Inspect scheduler logs for database errors, missing contract IDs, or
            Soroban expiry failures. Expired accounts that cannot be expired keep
            funds recoverable past the intended window.

      - alert: BridgeletPaymentMonitorLagging
        expr: payment_monitor_seconds_since_last_event > 300
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: 'Payment monitor has not seen a Horizon event for {{ $value }}s'
          description: >-
            Check Horizon availability, the SSE stream error logs, and
            payment_monitor_stream_restarts_total. Also inspect GET /health; it
            reports degraded when this exceeds PAYMENT_MONITOR_LAG_THRESHOLD_MS.
            Payments may still arrive, but automatic detection is delayed.

      - alert: BridgeletSweepSuccessRateLow
        expr: sweep_success_rate < 0.95
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: 'Sweep success rate is {{ $value | humanizePercentage }}'
          description: >-
            Group sweep_failure_by_code_total by error_code to identify the
            dominant failure. HORIZON_TIMEOUT and tx_* codes usually indicate
            transient network/sequence issues; contract error codes need manual
            review before retrying.

      - alert: BridgeletPaymentStreamRestarts
        expr: increase(payment_monitor_stream_restarts_total[10m]) > 3
        labels:
          severity: warning
        annotations:
          summary: 'Payment streams are reconnecting repeatedly'
          description: >-
            Repeated stream errors usually mean Horizon rate limiting,
            connectivity loss, or an account stream that cannot progress. Check
            provider logs and Horizon status before restarting the service.
```

## Stuck-account webhook

When an account exceeds `STUCK_ACCOUNT_THRESHOLD_MS` in `CLAIMING` or
`PARTIAL_SWEEP`, `account.stuck` is delivered once for that account/status
episode. See [Webhook Events](./webhook-events.md#accountstuck) for the payload.
The notification is intended for operators or an incident workflow, not as a
replacement for the gauges above.
