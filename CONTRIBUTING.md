# Contributing

## Automated PR Naming Checks

All pull requests are validated automatically for branch naming and PR title format.

- During the initial rollout, checks run in warning mode until **2026-02-27**.
- After that date, pull requests are blocked until naming issues are fixed.

### Branch Name Format

Accepted pattern:

`(fix|feature|test|chore|docs)/issue-NUMBER-brief-description`

Regex used by CI:

`^(fix|feature|test|chore|docs)/issue-[0-9]+-[a-z0-9-]+$`

Examples:

- `fix/issue-42-jwt-error-handling`
- `feature/issue-50-webhook-service`

`main` and `develop` are exempt for release/hotfix workflows.

### PR Title Format

Accepted pattern:

`(Fix|Feature|Test|Chore|Docs): Brief description (#NUMBER)`

Regex used by CI:

`^(Fix|Feature|Test|Chore|Docs): .+ \(#[0-9]+\)$`

Examples:

- `Fix: Handle JWT errors in TokenVerificationProvider (#42)`
- `Test: Add unit tests for ClaimLookupProvider (#43)`

### How To Fix A Branch Name

Rename your local branch and push the new branch:

```bash
git branch -m fix/issue-42-jwt-error-handling
git push origin -u fix/issue-42-jwt-error-handling
```

Then update the PR to use the renamed branch. If needed, close the old PR and open a new one from the renamed branch.

### How To Fix A PR Title

Edit the PR title directly in GitHub:

1. Open the pull request.
2. Click the title field.
3. Update it to the required format.
4. Save changes.
