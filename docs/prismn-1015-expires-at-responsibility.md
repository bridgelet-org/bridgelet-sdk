# `Account.expiresAt` vs StellarService / Contract Expiry (prismn-1015)

Standalone documentation helper for issue #1015: clarify whether `expiresAt` is only used for DB-side scheduler expiry sweeps or should also be passed/enforced on-chain, and document the intended split of responsibility.

## Observed Context
- README notes: "`expiresAt` Date is currently unused in `StellarService`".
- Accounts persist `expiresAt` (Date) and the system computes/uses expiry-related timing (e.g. ledger conversion and scheduler sweeps) for lifecycle management.

## Intended Split of Responsibility (documented expectation)

### DB-side / Application responsibility (`expiresAt`)
- **Source of truth for lifecycle scheduling:** `expiresAt` (and related persisted state) drives application jobs (e.g. expiry sweep/unclaimed timeout handling) and API-visible lifecycle decisions.
- **Operational visibility:** used for status transitions, admin/list filtering context, and reclaim/sweep orchestration timing.
- **Validation boundary:** claim/token redemption paths must reject/handle accounts that are already expired per DB/app rules rather than relying on downstream failures.

### Contract-side / On-chain responsibility
- **On-chain enforcement boundary:** contract interactions rely on contract parameters/ledger-based expiry semantics (e.g. `expiry_ledger`) where applicable.
- **Deterministic settlement:** on-chain behavior must remain correct even if app scheduling is delayed; contract-level expiry/authorization semantics should not assume the scheduler is the only guard.
- **Idempotency/safety:** on-chain calls should be safe under retries and partial completion scenarios.

## Clarification Needed in Implementation/Code Comments
- If `StellarService` does not currently consume `expiresAt`, document that it consumes derived/explicit expiry inputs (e.g. `expiresIn`/`expiry_ledger`) instead.
- Ensure `docs/api-reference.md` / schema docs explicitly state: `expiresAt` is persisted DB/application time; contract enforcement (if any) is based on chain/ledger parameters passed at creation/redemption flows.
- If contract-side expiry enforcement is required but missing, treat as a follow-up implementation gap (separate from this documentation clarification).

## Summary
`expiresAt` should be clearly defined as the application/DB lifecycle timestamp for scheduling and validation, while on-chain enforcement depends on explicit contract inputs (`expiry_ledger`/equivalent). Both layers must be documented to avoid assuming one subsumes the other.
