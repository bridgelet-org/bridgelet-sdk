# Webhook Events Documentation Coverage (kike-alt-965)

Standalone documentation helper for issue #965: confirm every event name emitted
in code (e.g. `account.created`, `sweep.completed`, `sweep.failed`, etc.) is
documented in `docs/webhook-events.md`.

## Events to verify present in `docs/webhook-events.md`
Cross-check each emitted/supported event name against documentation:

| Event | Typical emitter/context | Must document |
| --- | --- | --- |
| `account.created` | Account creation flow | payload, trigger, delivery notes |
| `account.expires_soon` | Expiry warning/scheduler | payload, timing/threshold semantics |
| `account.claimed` | Claim/redemption flow | payload, relation to sweep events |
| `sweep.completed` | Claim redemption / sweep success | payload, when emitted, idempotency notes |
| `sweep.failed` | Claim redemption / sweep failure | payload, failure fields/reasons |
| `sweep.partial` | Partial sweep outcomes (if emitted) | payload and distinction from completed/failed |

> Note: confirm the authoritative set from `WebhookEvent` types/enums, controller
> validation, and emit/trigger call sites (e.g. `webhooks.service.ts`,
> `claim-redemption.provider.ts`, DTOs) and update docs for any additions/removals.

## Coverage checklist
- [ ] Every emitted event constant/name appears in `docs/webhook-events.md`.
- [ ] Each event documents JSON payload shape, required/optional fields, and an example.
- [ ] Event-specific semantics documented (e.g. `sweep.completed` vs `sweep.failed`
      vs `sweep.partial`, and whether `account.claimed` co-occurs).
- [ ] Header/signing context cross-referenced (e.g. `X-Bridgelet-Event`,
      `X-Bridgelet-Signature`) where applicable.
- [ ] No undocumented/commented-out events referenced in README without doc coverage.

## Outcome
- If gaps found: add/align sections in `docs/webhook-events.md` to match emitted
  behavior and mark removed/unused events clearly.
