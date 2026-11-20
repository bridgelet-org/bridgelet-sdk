# @stellar/stellar-sdk Dependency Audit (kike-alt-990)

Standalone audit helper for issue #990: a newer `@stellar/stellar-sdk` release is
available; confirm the upgrade path and impact on `src/modules/stellar` and any
manual error-string/contract parsing.

## Audit checklist

- **Current vs latest:** compare `package.json` (and lockfile if/when used by CI)
  pinned/resolved version of `@stellar/stellar-sdk` with the latest published
  release and its changelog/breaking changes.
- **Stellar module usage:** review `src/modules/stellar/**` for APIs that changed
  in newer major/minor releases (Horizon/Soroban/RPC clients, transaction/
  operation builders, key/strkey helpers, network/passphrase handling).
- **Manual parsing fragility:** identify code that parses error strings,
  response shapes, or contract/simulation results by string matching or
  undocumented fields; prefer typed/structured error surfaces exposed by the SDK.
- **Encoding/serialization:** verify any assumptions about XDR/base64/StrKey
  encoding remain valid across SDK versions.
- **Test/compat surface:** run/extend unit/integration coverage around Stellar
  calls and error handling (out of scope for this standalone doc, but required
  before merge of an upgrade).

## Recommended upgrade approach

1. Bump `@stellar/stellar-sdk` in a dedicated change with changelog review.
2. Update Stellar module call sites for renamed/removed APIs and stricter types.
3. Replace brittle string-matching on errors with stable codes/typed checks where
   available; document any unavoidable parsing.
4. Validate against target network/testnet flows used by this service.
5. Record the decision (upgrade, defer, or pin with rationale) in this audit.

## Status

- **State:** audit documented (standalone). Actual dependency bump and code
  changes require a separate, tested implementation PR per repo process.
