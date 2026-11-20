# Webhook Delete Semantics (mxllv-1010)

Standalone documentation helper for issue #1010: clarify `DELETE /webhooks/:id` semantics (hard vs soft delete) and impact on delivery history.

## Observed contract/behavior

- **Route:** `DELETE /webhooks/:id` (see README/API reference key endpoints).
- **Controller/service intent:** deactivation-oriented behavior is consistent with `findAll()` returning only `isActive: true` rows.
- **Entity/history:** `webhook_deliveries` references `webhooks.id` with `ON DELETE CASCADE` in schema docs/migrations context; hard-deleting a webhook row would remove delivery history via FK cascade, while soft deactivation (`isActive=false`) preserves rows/history.

## Clarified semantics (recommended/documented)

- `DELETE /webhooks/:id` should be treated as **soft delete/deactivation** (`isActive = false`) rather than physical row removal.
- Deactivated subscriptions:
  - no longer appear in `GET /webhooks` active listings,
  - stop receiving future deliveries,
  - retain historical `webhook_deliveries` records for audit/debug/replay analysis.
- Hard delete, if ever introduced, must be a separate explicit administrative operation with clear retention implications.

## API documentation guidance

- Document in `docs/api-reference.md` that `DELETE /webhooks/:id` deactivates (soft-deletes) a subscription.
- Note that delivery history remains available via stored delivery records subject to retention policy, because the webhook row is not physically removed by this endpoint.
