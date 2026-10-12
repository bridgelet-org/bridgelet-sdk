# Deployment

## `EPHEMERAL_ACCOUNT_WASM_HASH` (issue #811)

Each `POST /accounts` deploys its **own** `EphemeralAccount` contract instance
and initializes that instance. `EphemeralAccount` in bridgelet-core holds all of
an account's on-chain state (status, expiry ledger, recorded payments,
`swept_to`) and its `initialize()` returns `Error::AlreadyInitialized`
(`Error(Contract, #1)`) on any second call — so a single shared contract ID
allowed exactly one account per deployment.

- `EPHEMERAL_ACCOUNT_WASM_HASH` is the 64-hex-char WASM hash of the uploaded
  ephemeral-account contract. It is required outside tests and validated by
  `validateEnv()` in `src/config/env-validation.ts`, which reports
  `EPHEMERAL_ACCOUNT_WASM_HASH is missing` or
  `EPHEMERAL_ACCOUNT_WASM_HASH must be a 64-character hex string`. A hash that
  is not uploaded on the target network makes the deploy transaction fail, and
  the account is marked `FAILED` rather than handed to the caller.
- On testnet the value is `ephemeralAccountWasmHash` in
  `bridgelet-core/deployments/testnet.json`. On mainnet, take it from the
  `stellar contract upload` output for the mainnet build.
- `stellar.contracts.ephemeralAccount` (`EPHEMERAL_ACCOUNT_CONTRACT_ID`) is still
  required by the payment monitor, sweeps and `ContractProvider`, but account
  creation never initializes it.
- Deploys are salted with 32 random bytes, so retrying an account creation
  cannot collide with an earlier deployment.
- Redeploy the contract and bump this value (and
  `EPHEMERAL_ACCOUNT_CONTRACT_VERSION`) whenever a new ephemeral-account WASM is
  uploaded; instances deployed from an older hash keep running against the
  older code.
- Each new account costs one extra deploy transaction (rent + fees) on top of
  the existing `createAccount` and `initialize` transactions. Size the funding
  account accordingly.

## Database connection pool (issue #516)

Pool settings live in two places that must be kept in sync:

- `src/config/database.config.ts` (`POOL_CONFIG`) – used by the running
  NestJS app via `TypeOrmModule.forRootAsync`.
- `src/config/typeorm.config.ts` – used by the TypeORM CLI
  (`migration:run`, `migration:revert`, `migration:generate`).

Both currently set:

```ts
{
  min: 2,
  max: 10,
  connectionTimeoutMillis: 3000,
}
```

### What each option actually does

This repo previously used `acquireTimeoutMillis` instead of
`connectionTimeoutMillis`. `pg-pool` does not recognize
`acquireTimeoutMillis` as an option and silently ignores it, so the
intended fail-fast behavior was never in effect. Concretely:

- **`max`** is the only hard cap. It limits how many physical
  connections one app instance opens to Postgres.
- **`min`** does _not_ eagerly open connections at startup. In
  `pg-pool`, `min` only stops the pool from closing idle connections
  below that floor once they already exist (see `_isAboveMin` in
  `pg-pool/index.js`). It has no effect on cold-start latency.
- **`connectionTimeoutMillis`** is the real option name. It governs
  two things at once: how long a brand-new physical connection attempt
  may take, and — this is the part that matters for pool exhaustion —
  how long a caller queues waiting for an already-open connection once
  the pool is fully saturated (`_isFull()` in `pg-pool`). If this is
  unset (as it effectively was, since `acquireTimeoutMillis` was
  ignored), a caller that arrives when all `max` connections are busy
  queues **indefinitely** with no error: a silent hang, not
  backpressure. With it set to `3000`, that caller now fails after 3s
  with `timeout exceeded when trying to connect`, which NestJS
  surfaces as a request-level error instead of a hung connection.

### Sizing `max` against expected concurrency

This repo does not currently have a load-testing script or a
documented concurrency figure checked in (issue #516 assumed a
"50 concurrent requests" load test existed; as of this audit it does
not — see the PR for this issue). Until one exists, size `max`
using this reasoning instead of a specific benchmark:

1. **Pool size is not request concurrency.** A request only holds a
   connection for the duration of its DB work, not its full
   lifetime. If the average DB-bound portion of a request is short
   (a few ms to tens of ms), a pool much smaller than the peak
   concurrent HTTP request count can still serve it, as long as
   requests queue briefly rather than reject outright.
2. **Watch for connection-holding operations.** `ClaimRedemptionProvider.redeemClaim`
   opens a `dataSource.transaction(...)` with a `pessimistic_write`
   lock while it validates and transitions account state — this holds
   one pool connection for longer than a typical read, and multiple
   concurrent redemptions against _different_ accounts will each hold
   a connection concurrently (they don't block each other; they're
   different rows). Size `max` with headroom for the expected number
   of concurrent in-flight redemptions/sweeps, not just steady-state
   reads.
3. **Multiply by instance count, not just per-instance `max`.**
   `max: 10` is _per NestJS instance_. If you run N instances behind a
   load balancer, total connections to Postgres are `N * max` (plus
   any CLI/migration connections). Check that against Postgres's own
   `max_connections` (`SHOW max_connections;`) with headroom for
   other services and superuser/admin connections.
4. **Recommended starting point for production:** `max: 10` per
   instance is reasonable for a small number of instances (2-4)
   against a standard managed Postgres tier. If you scale out app
   instances, either lower `max` per instance proportionally or put a
   connection pooler (e.g. PgBouncer in transaction mode) in front of
   Postgres so instance count doesn't multiply raw connections
   linearly.
5. **Before raising `max` in response to timeouts,** check whether
   the real cause is connection-holding queries/transactions running
   long, not too few connections — a bigger pool just delays hitting
   the same ceiling if a query is the actual bottleneck.

When a real load-testing setup is added, replace this section with
the measured concurrency figure and the `max` value it justifies.

## Deploying on Render (issue #824)

A fresh clone should reach a working testnet deployment from this section
alone. `validateEnv()` in `src/config/env-validation.ts` runs before the Nest
app is created, so every mistake below stops the process at boot with the
variable named instead of surfacing later as a wrong claim link or a blocked
browser.

### 1. Service type and commands

- **Type:** Web Service (Node runtime). The repo's `docker-compose.yml` pins
  `node:22-bookworm-slim` and `postgres:16-alpine`; Render's Node 22 image
  matches that.
- **Build command:** `npm ci && npm run build`
- **Start command:** `npm run start:prod` (`node dist/main.js`)
- **Health check path:** `/health` — `HealthController` answers 200 with
  `{"status":"ok",...}` after a `SELECT 1`, and 503 `degraded` once the pool is
  exhausted (issue #516). Render restarts an instance that fails this check.
- **Port:** read from `PORT`; set it to Render's value (defaults to `3000`).

### 2. Postgres

- Add a Render Postgres 16 instance and copy its values into
  `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`,
  `DATABASE_PASSWORD`.
- `DATABASE_SYNC` stays `false`. `isSynchronizeAllowed()` throws outside
  `NODE_ENV=test`, so a deployed instance that tries to sync dies at boot
  instead of silently altering the schema. Apply schema changes with
  `npm run migration:run` as a one-off job.
- Size the pool per instance: `max: 10` is per NestJS process, so N instances
  open up to `N * 10` connections (see the pool section above).

### 3. Which `NODE_ENV` to use

- **`production`** — anything reachable from the internet, *including a public
  testnet demo*. This is the mode where a wildcard `CORS_ORIGINS` and a missing
  `CLAIM_BASE_URL` are refused at startup.
- **`development`** — your machine only. Still requires `CLAIM_BASE_URL` (point
  it at the local port) since #824.
- **`test`** — jest only. Several required variables are tolerated there, so
  never deploy with it.
- `NODE_ENV=production` is not the same statement as "mainnet": mainnet sweeps
  are still blocked on a production-capable signer (issue #823), while a
  testnet demo running in `production` mode is supported.

### 4. Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` on Render (see above). |
| `DATABASE_HOST` / `DATABASE_PORT` / `DATABASE_NAME` / `DATABASE_USER` / `DATABASE_PASSWORD` | yes | From the Render Postgres instance. |
| `STELLAR_NETWORK` | yes | `testnet` or `mainnet`. |
| `STELLAR_HORIZON_URL` / `STELLAR_SOROBAN_RPC_URL` | yes | Match the network. |
| `JWT_SECRET` | yes | Generate per environment; rotate with `docs/jwt-secret-rotation-runbook.md`. |
| `ENCRYPTION_KEY` | yes | 64 hex chars. Fallback key when KMS is off. |
| `EPHEMERAL_ACCOUNT_WASM_HASH` | yes (outside tests) | 64 hex chars, from `bridgelet-core/deployments/testnet.json`. |
| `SWEEP_CONTROLLER_CONTRACT_ID` | yes (outside tests) | Controller that authorizes sweeps. |
| `CLAIM_BASE_URL` | yes (outside tests) | Public URL of this service, no trailing slash. |
| `CORS_ORIGINS` | yes in production | Explicit origin list; `*` is refused. |
| `PORT` | recommended | Render sets it; the app defaults to 3000. |
| `KMS_ENABLED` / `KMS_KEY_ID` / `AWS_REGION` | recommended | Envelope encryption instead of the fallback key. |
| `KMS_DATA_KEY_PATH` / `KMS_ENCRYPTED_DATA_KEY` | recommended | Without either, the wrapped data key is regenerated on restart and existing secrets stop decrypting. |
| `FUNDING_ACCOUNT_SECRET` | yes in practice | Pays for account deploys; size it (each account = one extra deploy transaction). |
| `RECOVERY_ACCOUNT_PUBLIC` | yes in practice | Recovery target for sweeps. |
| `SWEEP_SIGNING_KEY_SEED` | yes in practice | Testnet/demo signer seed; the production signer is issue #823. |
| `DATABASE_SYNC` | no | Must stay `false` outside tests. |
| `DATABASE_LOGGING`, `LOG_LEVEL`, `API_RATE_LIMIT`, `PAYMENT_POLL_INTERVAL_MS`, `WEBHOOK_*`, `*_INTERVAL_MS` | optional | Tuning only; defaults are fine for a first deploy. |

Server-only by convention: `JWT_SECRET`, `ENCRYPTION_KEY`,
`FUNDING_ACCOUNT_SECRET`, `SWEEP_SIGNING_KEY_SEED`, `DATABASE_PASSWORD` — never
expose them to the frontend, in a build-time variable, or in a public log.

### 5. Deploy checklist

1. Postgres created, `DATABASE_*` exported, `DATABASE_SYNC=false`.
2. `EPHEMERAL_ACCOUNT_WASM_HASH` and `SWEEP_CONTROLLER_CONTRACT_ID` taken from
   `bridgelet-core/deployments/<network>.json`.
3. `CLAIM_BASE_URL` = the service's own public URL, no trailing slash.
4. `CORS_ORIGINS` = the frontend origin(s), never `*`.
5. `npm run migration:run` executed once against the new database.
6. `GET /health` returns 200 before the service takes traffic.
7. Redeploying the SweepController produces a new contract ID and a new
   `SWEEP_CONTROLLER_CONTRACT_ID`: each ephemeral account stores the controller
   in effect when it was created, so a redeploy only affects **new** accounts —
   accounts already created keep sweeping through the old controller.
