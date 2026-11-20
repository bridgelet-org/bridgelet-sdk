# Security Audit Findings Tracking (kike-alt-963)

Standalone documentation helper for issue #963: confirm findings in
`SECURITY.md` and `SECURITY_AUDIT.md` have corresponding tracked issues (or are
explicitly accepted/deferred), not just a static markdown snapshot.

## Audit-to-tracking checklist

For each finding listed in `SECURITY.md` / `SECURITY_AUDIT.md`:

| Finding (summary)                                     | Source section    | Severity | Tracked issue/link | Status                  | Notes        |
| ----------------------------------------------------- | ----------------- | -------- | ------------------ | ----------------------- | ------------ |
| _example: webhook SSRF validation_                    | SECURITY_AUDIT.md | _TBD_    | _#xxxx or link_    | open/mitigated/accepted | _owner/date_ |
| _example: secret encryption key rotation/persistence_ | SECURITY_AUDIT.md | _TBD_    | _#xxxx_            | open/mitigated/accepted |              |
| _example: claim redemption rate limiting/bruteforce_  | SECURITY.md       | _TBD_    | _#xxxx_            | open/mitigated/accepted |              |

## Process expectations

- **Traceability:** every material finding must reference a tracked issue/epic or
  an explicit acceptance/defer decision with rationale and approver.
- **No static-only audits:** audit markdown should be a living index that links to
  tracking artifacts, not the sole record of remediation state.
- **Status hygiene:** when a finding is fixed, update both the tracking issue and
  the audit doc status/notes; link PRs that remediate.
- **Coverage:** include unresolved findings, partially mitigated items, and
  intentionally accepted risks (with justification and review date).

## Recommended next steps

1. Extract all findings from `SECURITY.md` and `SECURITY_AUDIT.md` into the table.
2. Create/link issues for untracked findings and assign owners/severity.
3. Mark accepted risks explicitly with rationale and next review date.
4. Keep this mapping updated as part of security remediation PRs.
