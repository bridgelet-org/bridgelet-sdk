# Database Schema

The current schema is created entirely through the migrations in `src/database/migrations/`.

## Tables

- `accounts`: stores ephemeral account lifecycle data, including encrypted secret material, funding metadata, expiry timestamps, and optional claim metadata.
- `claims`: stores completed claim records and references `accounts.id` through a cascading foreign key on `accountId`.
- `webhooks`: stores outbound webhook subscriptions.
- `webhook_deliveries`: stores per-delivery webhook attempts, including the subscribed webhook reference (`subscription_id`), event type, payload hash, retry count, last response details, delivery timestamp, and creation timestamp. It references `webhooks.id` with `ON DELETE CASCADE` and has a composite index on (`subscription_id`, `created_at`).
- `contract_events`: stores events indexed by `SorobanEventsIndexerService` from
  `STELLAR_SOROBAN_RPC_URL`. The service polls every
  `STELLAR_CONTRACT_EVENT_POLL_INTERVAL_MS` milliseconds (30,000 by default),
  resumes after the greatest stored ledger, and falls back to Horizon `/events`
  when Soroban RPC is unavailable. It records `AccountCreated`,
  `PaymentReceived`, `SweepExecutedMulti`, and `AccountExpired` events.

## Account Status Enum

`account_status_enum` contains eight values. The order below is the order the
PostgreSQL type actually has — what an `ORDER BY status` would use — not a
lifecycle order, and it was assembled by four migrations rather than declared
once:

| #   | Value             | Set when                                                                                                | Terminal |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `initializing`    | a row is written before Stellar or the contract is touched, so a failed creation is still traceable     | no       |
| 2   | `pending_payment` | `createEphemeralAccount` succeeded on Horizon and on the contract                                       | no       |
| 3   | `pending_claim`   | the funding payment is confirmed on-chain                                                               | no       |
| 4   | `claiming`        | a redemption holds the row lock for this account                                                        | no       |
| 5   | `partial_sweep`   | the contract authorized the sweep but the Horizon payment failed, or a redemption stalled in `claiming` | no       |
| 6   | `claimed`         | sweep and payment both succeeded                                                                        | **yes**  |
| 7   | `expired`         | the expiry job ran past `expiresAt`                                                                     | **yes**  |
| 8   | `failed`          | creation, initialization, or payment monitoring failed                                                  | **yes**  |

Where the order came from: `1718100000000-CreateAccountsTable` created five
values (`pending_payment`, `pending_claim`, `claimed`, `expired`, `failed`);
`1718100002000` added `initializing BEFORE 'pending_payment'`;
`1718100004000` added `claiming AFTER 'pending_claim'`; and `1718100008000`
added `partial_sweep AFTER 'claiming'`. Each of those migrations also rewrites
existing rows on the way down, so the value set and the data move together.

## Account Status Transitions

Every allowed transition is enumerated exactly once, in code:
[`src/modules/accounts/enums/account-status-transitions.ts`](../src/modules/accounts/enums/account-status-transitions.ts).
Anything not in that map is rejected by `assertValidAccountStatusTransition`,
and `account-status-transitions.spec.ts` asserts that every enum value appears
as a key and that no terminal state has an outgoing edge — so adding a status
without adding its transitions fails the suite rather than producing a status
nothing can leave.

```text
initializing ──► pending_payment ──► pending_claim ──► claiming ──► claimed
     │                 │                  │              │  ▲
     │                 │                  │              │  └── retry ──┐
     │                 │                  │              ▼             │
     │                 │                  │        partial_sweep ──────┘
     │                 │                  │              │
     └─────────────────┴──────────────────┴──────────────┴──► failed

pending_payment ─┐
pending_claim  ──┴──► expired        claimed / expired / failed: terminal
```

| From                           | To                | Trigger                                                                                                                                                                               | How the write is guarded                                                                                                            |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `initializing`                 | `pending_payment` | account creation succeeded on both Horizon and the contract                                                                                                                           | `assert` — `accounts.service.ts`                                                                                                    |
| `initializing`                 | `failed`          | creation threw; or the INITIALIZING cleanup found the row older than `INITIALIZING_TIMEOUT_MS` (600000 ms by default)                                                                 | `assert` — `accounts.service.ts`, `scheduler.service.ts`                                                                            |
| `pending_payment`              | `pending_claim`   | the funding payment is confirmed                                                                                                                                                      | conditional update `WHERE status = 'pending_payment'` — `payment-monitor.service.ts`; also written by `payment-monitor-provider.ts` |
| `pending_payment`              | `expired`         | expiry job, past `expiresAt`                                                                                                                                                          | `assert` — `scheduler.service.ts`                                                                                                   |
| `pending_payment`              | `failed`          | payment monitoring failed for this account                                                                                                                                            | plain update — `payment-monitor-provider.ts`                                                                                        |
| `pending_claim`                | `claiming`        | a redemption took the row lock (`SELECT … FOR UPDATE`)                                                                                                                                | `assert` — `claim-redemption.provider.ts`                                                                                           |
| `pending_claim`                | `expired`         | expiry job, past `expiresAt`                                                                                                                                                          | `assert` — `scheduler.service.ts`                                                                                                   |
| `claiming`                     | `claimed`         | sweep and Horizon payment both succeeded                                                                                                                                              | `assert` — `claim-redemption.provider.ts`                                                                                           |
| `claiming`                     | `partial_sweep`   | the contract authorized the sweep but the Horizon payment failed; or the reconciler found the row stalled in `claiming` past `SWEEP_RECONCILIATION_TIMEOUT_MS`                        | `assert` on the redemption path; plain update in `scheduler.service.ts` for the stalled-row path                                    |
| `claiming`                     | `pending_claim`   | a failed redemption released the slot so the same token can be retried — deliberately not taken when the attempt began in `partial_sweep`, because the contract is already in `Swept` | plain update — `claim-redemption.provider.ts`                                                                                       |
| `partial_sweep`                | `claiming`        | a retry of a partially swept account took the row lock                                                                                                                                | `assert` — `claim-redemption.provider.ts`                                                                                           |
| `partial_sweep`                | `claimed`         | the retry's Horizon payment succeeded                                                                                                                                                 | `assert` — `claim-redemption.provider.ts`                                                                                           |
| `partial_sweep`                | `failed`          | allowed by the map; no code path writes it today                                                                                                                                      | —                                                                                                                                   |
| `claimed`, `expired`, `failed` | —                 | terminal: no outgoing transitions                                                                                                                                                     | the spec asserts these stay empty                                                                                                   |

The same rule holds for `pending_claim → failed`: the map permits it, nothing
writes it yet. Those two edges are the map being deliberately wider than the
current code, so a future failure path has a legal transition to use.

### Three ways these writes are guarded, and what each one can detect

Worth knowing before adding a fourth status, because only the first style
notices a drift:

1. **`assertValidAccountStatusTransition(from, to)`** before the write — the
   redemption, creation, expiry, and initialization-cleanup paths. This is the
   only style that fails loudly when the row is in a state the guard did not
   expect.
2. **A conditional `UPDATE … WHERE status = '<expected>'`** — the payment
   monitor's `pending_payment → pending_claim`. The WHERE clause is the guard,
   which makes it safe against a concurrent writer, but a mismatch affects zero
   rows and returns quietly.
3. **A plain update naming only the row id** — `payment-monitor-provider.ts`
   (`→ pending_claim`, `→ failed`), the stalled-claim reconciler
   (`→ partial_sweep`), and the redemption failure revert
   (`→ pending_claim` / `→ partial_sweep`). Every one of these writes a
   transition the map allows, so the state machine stays correct; what they
   cannot do is detect that the row was somewhere unexpected, because they never
   read the current status.

### Keeping this in sync

Adding a status or a transition is a four-place change, and skipping any one of
them is what produced this document's gap in the first place:

1. `account-status.enum.ts` — the new value. The existing values keep their
   spelling: the string is what the database type stores.
2. A migration that adds the value with `BEFORE`/`AFTER` to place it in the
   type's order, since `ALTER TYPE … ADD VALUE` appends otherwise.
3. `ACCOUNT_STATUS_TRANSITIONS` — the edges into and out of it. The spec fails
   if a status has no entry, and a terminal state with an outgoing edge fails
   too.
4. This page — the value table, the transition table, and the guard style of any
   new write path.

## Connection Pool Configuration

TypeORM is configured with the following pool settings in both
`src/config/database.config.ts` (NestJS runtime) and
`src/config/typeorm.config.ts` (migration CLI):

| Setting                | Value | Rationale                                                                                                                                                    |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `min`                  | 2     | Keeps two warm connections alive to avoid TCP + TLS + PostgreSQL auth latency on the first request after an idle period.                                     |
| `max`                  | 10    | Caps per-instance connections to leave room for other services sharing the PostgreSQL server. Aligns with a conservative PgBouncer transaction-mode default. |
| `acquireTimeoutMillis` | 3000  | Fail-fast: surface an error after 3 s if no connection becomes available rather than queuing silently, which would mask connection leaks.                    |

Settings are passed to the underlying `pg` Pool constructor via the TypeORM `extra` key.

## Pool Health Check

`GET /health` performs a live pool probe: it races a `SELECT 1` against the
`acquireTimeoutMillis` (3 000 ms) timeout and reports one of three states:

| `services.database.healthy` | `services.database.poolExhausted` | Meaning                                                         |
| --------------------------- | --------------------------------- | --------------------------------------------------------------- |
| `true`                      | `false`                           | Normal operation                                                |
| `false`                     | `true`                            | All pool connections are in use — scale up or investigate leaks |
| `false`                     | `false`                           | Database unreachable (network, credentials, etc.)               |

## Database Indexes

### accounts

| Index name                      | Columns               | Query served                                                                                                                      |
| ------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `IDX_accounts_publicKey`        | `publicKey`           | Account lookup by Stellar public key                                                                                              |
| `IDX_accounts_integratorId`     | `integratorId`        | Per-integrator isolation: `GET /accounts/:id` and list scope by owning integrator (issue #468)                                    |
| contractId                      | varchar(56), nullable | Stellar contract ID of the ephemeral account, set once Horizon + contract creation succeed (`stellar.contracts.ephemeralAccount`) |
| `IDX_accounts_status`           | `status`              | Status-filtered API list (`GET /accounts?status=…`)                                                                               |
| `IDX_accounts_claimTokenHash`   | `claimTokenHash`      | Token redemption lookup                                                                                                           |
| `IDX_accounts_expiresAt`        | `expiresAt`           | Range scans on expiry timestamp                                                                                                   |
| `IDX_accounts_status_expiresAt` | `status`, `expiresAt` | Expiry scheduler: `WHERE status IN (…) AND expiresAt < NOW()` — composite eliminates the bitmap AND step                          |
| `IDX_accounts_status_createdAt` | `status`, `createdAt` | INITIALIZING cleanup: `WHERE status = 'initializing' AND createdAt < <cutoff>`                                                    |
| `IDX_accounts_createdAt`        | `createdAt`           | Audit / time-boxed reporting range scans                                                                                          |

### claims

| Index name             | Columns     | Query served                              |
| ---------------------- | ----------- | ----------------------------------------- |
| `IDX_claims_accountId` | `accountId` | FK lookup when joining claims to accounts |

### webhooks

| Index name              | Columns    | Query served                        |
| ----------------------- | ---------- | ----------------------------------- |
| `IDX_webhooks_isActive` | `isActive` | Filter active webhook subscriptions |

### contract_events

| Index name                    | Columns                                     | Query served                                                 |
| ----------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `UQ_contract_events_identity` | `event_type`, `contract_address`, `tx_hash` | Prevents duplicate inserts when RPC polling retries an event |

### claim_audit_log

Records every claim redemption attempt (success and failure), powering the
issue #472 audit trail.

| Column            | Type        | Notes                                                       |
| ----------------- | ----------- | ----------------------------------------------------------- |
| `id`              | uuid        | PK                                                          |
| `accountId`       | uuid        | Account the claim belongs to (indexed)                      |
| `destinationHash` | varchar(64) | SHA-256 of destination address (never stored in plain text) |
| `ipHash`          | varchar(64) | SHA-256 of requester IP, nullable                           |
| `outcome`         | varchar(10) | `success` ✓ / `failure` ✗ / `partial` ~                     |
| `failureReason`   | text        | Error message on failure, nullable                          |
| `attemptedAt`     | timestamptz | Attempt timestamp (indexed)                                 |

| Index name            | Columns       | Query served                      |
| --------------------- | ------------- | --------------------------------- |
| `IDX_..._accountId`   | `accountId`   | Per-account attempt history       |
| `IDX_..._attemptedAt` | `attemptedAt` | Time-boxed audit / abuse analysis |

### Index design notes (EXPLAIN ANALYZE audit)

- The **composite indexes on `accounts`** use `status` as the leading column because it is a low-cardinality enum (8 values) that prunes the candidate set effectively before the timestamp column filters further. PostgreSQL can also use `IDX_accounts_status_expiresAt` and `IDX_accounts_status_createdAt` as left-prefix scans for status-only queries.
- `IDX_accounts_status` (single-column) is retained alongside the composites to support `EXPLAIN ANALYZE`-verified single-predicate queries.
- All indexes use the default B-tree access method, which supports equality, range (`<`, `>`), and `ORDER BY` optimisations.

## Migration Verification

`src/database/migrations.integration.spec.ts` provisions a fresh embedded PostgreSQL database, applies every migration, verifies:

1. The resulting schema matches TypeORM entity metadata (`schemaInSync: true`).
2. The `claims.accountId` and `webhook_deliveries.subscription_id` foreign keys are enforced (inserts with orphan UUIDs are rejected).
3. The three high-traffic composite/standalone indexes exist after migration `1718100006000`.
4. The `contract_events` table exists with the expected columns and accepts inserts after migration `1718100007000`.
