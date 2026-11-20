# API Reference Endpoint Coverage (kike-alt-964)

Standalone documentation helper for issue #964: confirm every endpoint listed in
README's "Key Endpoints" table has a matching, up-to-date section in
`docs/api-reference.md`.

## README "Key Endpoints" to verify documented

- `POST /accounts` — create ephemeral account
- `GET /accounts` — list accounts
- `GET /accounts/:id` — get account
- `GET /accounts/:id/sdk-config` — claim/payment deep-link config (no secrets)
- `POST /accounts/:id/claim` — (documented claim flow endpoint if listed; verify method/path semantics)
- `POST /claims/verify` — verify claim token / claimability
- `POST /claims/redeem` — redeem claim token / trigger sweep
- `GET /claims/:id` — claim status/details
- `POST /webhooks` — register webhook
- `GET /webhooks` — list webhooks
- `PUT /webhooks/:id` — update webhook
- `DELETE /webhooks/:id` — deactivate/delete webhook
- `GET /health` — health check

> Verify the exact set and methods against the current README table and
> controller routes; reconcile any path/method differences.

## Required per-endpoint documentation in `docs/api-reference.md`

- [ ] Method + path and short description
- [ ] Auth requirements (API key / claim token / public) and rate limits where applicable
- [ ] Path/query/body parameters with types/validation rules
- [ ] Success response schema/example and relevant status codes
- [ ] Error responses (400/401/404/409/429/5xx as applicable)
- [ ] Notes for semantics that are easy to misread (e.g. webhook delete soft-deactivation, claim token usage, unauthenticated-but-throttled routes)

## Outcome

- Any README-listed endpoint missing or out of sync in `docs/api-reference.md`
  should be added/updated so README and API reference remain consistent.
