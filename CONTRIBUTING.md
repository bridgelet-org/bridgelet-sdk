# Contributing to Bridgelet SDK

Thank you for contributing to the Bridgelet SDK! Please follow these guidelines to ensure a smooth review process.

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

## Getting Started

1. **Fork the repository** and clone your fork locally
2. **Create a feature branch** from `main`:

```bash
   git checkout -b fix/issue-123-description
   # or
   git checkout -b feature/issue-456-description
```

3. **Never push directly to `main`** - always work in a branch

## Development Workflow

### 1. Make Your Changes

- **Only modify files directly related to your issue**
- Do not refactor, rename, or "improve" code outside the scope of your task
- If you must use AI, use it cautiously and contiously.
- Touching unnecessary files makes reviews harder and increases the chance of merge conflicts
- Preserve codebase integrity by staying focused on the issue requirements

### 2. Run Tests Locally

Before submitting your PR, ensure all checks pass:

```bash
# Format check
npx prettier --check .

# Fix formatting (if needed)
npx prettier --write .

# Linting
npm run lint

# Run all tests
npm run test

# Run specific test file
npm test -- your-test-file.spec.ts

# Build verification
npm run build
```

**All of these must pass before submitting your PR.**

### 3. Commit Your Changes

Write clear, concise commit messages:

```bash
# Good examples:
git commit -m "Fix: Handle TokenExpiredError in TokenVerificationProvider"
git commit -m "Test: Add unit tests for ClaimLookupProvider"
git commit -m "Refactor: Extract Stellar address validation logic"

# Bad examples:
git commit -m "fixed stuff"
git commit -m "updates"
git commit -m "wip"
```

## Pull Request Guidelines

### Before Submitting

- [ ] All tests pass locally (`npm run test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Code is properly formatted (`npx prettier --check .`)
- [ ] Build succeeds (`npm run build`)
- [ ] Only relevant files are modified
- [ ] No commented-out code added (unless marked as `TEMPORARY:` per project conventions)

### PR Title Format

Use conventional commit format:

```
Fix: Brief description of what was fixed (#issue-number)
Test: Brief description of tests added (#issue-number)
Feature: Brief description of feature (#issue-number)
```

**Examples:**

- `Fix: Resolve JWT error handling in claims service (#42)`
- `Test: Add comprehensive unit tests for ClaimRedemptionProvider (#43)`

### PR Description

Include:

1. **Issue reference**: "Closes #123" or "Fixes #456"
2. **What changed**: Brief summary of your changes 3-4 lines
3. **Testing**: Confirmation that all CI checks pass locally

**Example:**

```markdown
Closes #42

## Changes

- Added try-catch for TokenExpiredError and JsonWebTokenError in decodeClaimToken
- Errors now properly throw UnauthorizedException
- All 33 tests passing

## Testing

✅ Lint passed
✅ All tests passed (33/33)
✅ Build successful
```

## CI Pipeline

When you open a PR, our CI will automatically run:

1. **Format Check** - Ensures code follows Prettier conventions
2. **Linting** - Validates code quality and standards
3. **Unit Tests** - Runs all test suites
4. **Build Verification** - Confirms the project builds successfully

**Your PR will not be merged until all CI checks pass.**

## Code Review Process

1. Maintainers will review your PR within 48-72 hours
2. Address any requested changes promptly
3. Keep discussions focused and professional
4. Once approved, maintainers will merge your PR

## Important Notes

### Temporary Workarounds

The project has temporary workarounds for missing services (see README "TEMPORARY DEVELOPMENT WORKAROUNDS" section). Do not:

- Remove or uncomment `TEMPORARY:` marked code unless specifically instructed
- Attempt to implement missing services (WebhooksService) unless assigned

### Scope Discipline

**This is critical:** Contributors often feel compelled to "improve" code beyond their assigned task. Please resist this urge. Unrelated changes:

- Make PRs harder to review
- Increase risk of introducing bugs
- Delay merge time
- May cause your PR to be rejected

If you notice issues outside your scope, open a separate issue instead.

## Questions?

- Check the [README](./README.md) for project setup and architecture
- Review existing issues and PRs for context
- Open a discussion issue if you need clarification before starting work

---

**Thank you for helping improve Bridgelet SDK!** 🚀
