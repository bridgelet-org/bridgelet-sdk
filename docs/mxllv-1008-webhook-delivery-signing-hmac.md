# Webhook Delivery Signing (HMAC) for Integrators (mxllv-1008)

Standalone documentation helper for issue #1008: document how outbound webhook deliveries are signed and how integrators verify authenticity.

## Signing scheme

- **Algorithm:** HMAC-SHA256.
- **Key:** the webhook subscription `secret` configured at creation (`POST /webhooks`) or rotated via update (`PUT /webhooks/:id`), when supported.
- **Input:** the exact raw HTTP request body bytes/string sent by the service (JSON payload including the `event` field).
- **Output encoding:** lowercase/standard hex digest.
- **Header:** `X-Bridgelet-Signature: sha256=<hex-digest>`.
- **Event header:** `X-Bridgelet-Event: <event-name>` (also present in body as `event`).

## Verification steps (receiver)

1. Read the raw request body exactly as received (do not re-serialize before verification).
2. Compute `expected = HMAC_SHA256(secret, raw_body)` and hex-encode it.
3. Parse `sha256=<value>` from `X-Bridgelet-Signature`.
4. Compare using a constant-time equality check.
5. Reject requests with missing/invalid signatures or mismatches; optionally enforce timestamp/replay protections if your integration adds them.

## Operational notes

- Treat the webhook `secret` as sensitive; store it securely and rotate if compromised.
- If no secret is configured, deliveries may be unverifiable by this scheme; integrators should require secrets in production.
- `WebhookResponseDto` must not expose the secret in list/get responses.
- Delivery attempt metadata (status/response/error/timestamps) is recorded in webhook delivery entities/logs for observability; see `webhook-delivery.entity.ts` and webhook event docs.

## Cross-reference

- `docs/webhook-events.md` (event payloads and delivery guarantees)
- `src/modules/webhooks/entities/webhook-delivery.entity.ts` (delivery attempt fields)
