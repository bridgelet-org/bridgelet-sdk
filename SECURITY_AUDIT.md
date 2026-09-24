# Security Audit — Secrets at Rest

Inventory of sensitive data categories persisted by this service and their
current protection level. This supplements the base64-encryption finding
already tracked for account secret keys.

| Category                    | Where stored                                | Current protection                                               | Status                              |
| --------------------------- | ------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| Stellar account secret keys | `accounts` table, `secret` column           | Envelope-encrypted via `SecretEncryptionUtil` + `KmsKeyProvider` | OK                                  |
| Claim tokens                | `accounts` table, hashed only               | SHA-256 hash, plaintext never persisted                          | OK                                  |
| JWT signing secret          | Environment variable (`JWT_SECRET`)         | Not stored in DB; relies on deployment secret manager            | Needs deployment-level confirmation |
| Database credentials        | Environment variables                       | Not stored in DB or repo; relies on deployment secret manager    | Needs deployment-level confirmation |
| Webhook secrets             | `webhooks` table, `secret` column           | Stored as-is (no encryption-at-rest confirmed)                   | Gap — see follow-up issue           |
| API keys (integrators)      | `accounts` table / future `api-keys` module | Rotation/revocation being added (see below)                      | In progress                         |

## Gaps identified

- Webhook `secret` column is not confirmed encrypted at rest, unlike account
  secret keys. Filed as a follow-up rather than fixed silently here.

## Process

New findings must be appended to this table with a `Status` and, once
triaged, a linked GitHub issue number (see
`docs/security-audit-reconciliation.md`).
