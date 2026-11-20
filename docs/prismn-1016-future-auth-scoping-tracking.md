# Future Auth Scoping Tracking (prismn-1016)

Standalone tracking helper for issue #1016: `src/modules/accounts/FUTURE_AUTH_SCOPING.md` describes planned per-integrator auth scoping not yet implemented.

## Purpose

Track the forward-looking design in `src/modules/accounts/FUTURE_AUTH_SCOPING.md` so it does not remain an untracked, module-local note.

## Current State

- Design document exists: `src/modules/accounts/FUTURE_AUTH_SCOPING.md`.
- Described capability: per-integrator auth scoping (not yet implemented in runtime behavior).
- Risk if untracked: scope/ownership assumptions may drift from actual API auth/authorization model.

## Proposed Tracking / Implementation Plan

1. **Clarify doc home:** keep module-local doc as design input but link from `docs/` (or relocate) so architecture-level planning is discoverable.
2. **Define scope model:** integrator identity, credential issuance, allowed resources/actions, and token/claim boundaries.
3. **Data model & persistence:** schema/entities/migrations for integrator principals and scoped permissions (if required).
4. **AuthN/AuthZ enforcement:** guards/middleware/service checks for per-integrator scoping on relevant endpoints.
5. **Migration/compatibility:** backward compatibility for existing API JWT consumers and rollout/feature flag strategy.
6. **Testing & docs:** unit/integration/e2e coverage and updates to `docs/api-reference.md`, security docs, and runbooks.

## Acceptance/Linkage Checklist

- [ ] Tracking issue/epic links this document and `FUTURE_AUTH_SCOPING.md`.
- [ ] Concrete implementation milestones and owners identified.
- [ ] Security review covers tenant/integrator isolation and token scope boundaries.
- [ ] Documentation updated when implementation lands (or doc explicitly marked deferred with rationale).
