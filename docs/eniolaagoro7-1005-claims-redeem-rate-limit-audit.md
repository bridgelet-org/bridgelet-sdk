# Claims Redeem Rate Limiting Audit (eniolaagoro7-1005)

Standalone audit helper for issue #1005: confirm `/claims/redeem` has an explicit, documented, and tested rate limit / brute-force guard.

## Why this route needs explicit protection

- `/claims/redeem` triggers on-chain fund movement and accepts bearer claim tokens.
- Invalid/rejected attempts (bad signature, malformed payload, non-existent token) must still consume budget to prevent probing/oracle abuse.
- `/claims/verify` is a related high-value oracle route and should also be explicitly throttled.

## Expected configuration (to confirm in code)

- `ClaimsController` applies `@UseGuards(ThrottlerGuard)` (or equivalent) at controller/route scope.
- `POST /claims/redeem` has an explicit per-route `@Throttle` limit tighter than app-wide default (e.g. 5 requests / 60s).
- `POST /claims/verify` has an explicit per-route `@Throttle` limit (e.g. 10 requests / 60s), tracked separately.
- App-wide throttler default does not replace route-specific limits for these unauthenticated claim routes.

## Test expectations

- Repeated invalid redemption attempts to `/claims/redeem` return `429 Too Many Requests` once the route limit is exceeded.
- Rejections (validation/signature/token-not-found) count toward the limit.
- Route limits are independent: exhausting verify budget does not throttle redeem and vice versa.
- `GET /claims/:id` behavior remains consistent with intended policy (app-wide or explicit limit as documented).

## Documentation cross-reference

- `docs/claims-rate-limits.md`
- `docs/api-reference.md` (Claims section, unauthenticated + rate limited)
- `src/modules/claims/claims.controller.ts`
- `src/modules/claims/claims.redeem-throttle.spec.ts`
