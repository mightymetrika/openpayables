# GitHub integration v0.1 — closeout and next-chat handoff

**Date:** 2026-11-19 (Pacific)  
**Repository:** `https://github.com/mightymetrika/openpayables`  
**Accepted `development` HEAD:** `5a94518` (`feat: simplify contributor enrollment and review workflow`), pushed to `origin/development`, working tree clean  
**Intentionally unchanged `main`:** `28a79a4`  
**Status:** Core local-operator GitHub integration accepted as v0.1; **real positive merged-PR-to-preview demonstration remains outstanding**.

## What is already working

- **C7:** Read public merged pull requests and submitted PR reviews, preserve stable numeric GitHub identifiers, store immutable candidates idempotently.
- **C8:** Operator-attested project-specific GitHub identity links and explicit, exactly-once contribution-credit approval; positive synthetic-test 8:3 point allocation to 800/300 cents.
- **C9:** Repository-scoped GitHub App installation authentication, binding isolation; real GitHub App ID `5825297`, installation ID `183507524` used with repository `mightymetrika/openpayables` (repo ID `1460710596`). Private key remains in the local user directory outside the repo. **Never place it in archives, chats, or Git.**
- **C10:** Contributor-controlled GitHub Device Flow checks that the authenticated numeric GitHub ID matches the operator-attested link. Real `whoami` authenticated `mightymetrika`; no user OAuth/refresh token stored. Real `whoami` did **not** persist a project-specific verification record.
- **C11:** One-command operator `project setup` and `project setup-status`; actual `openpayables-c11-0ecc34cd` setup succeeded and repeated unchanged setup was idempotent. Real GitHub App sync authenticated and returned an expected empty candidate set.
- **C12:** `github enroll`, paginated `github review pending`, and read-only `distribution preview` join the workflow. Enrollment requires already discovered evidence, is operator-attested, and must not be confused with verified user control.
- **All C12 acceptance checks:** 88/88 unit tests, 38/38 PostgreSQL integration tests, ESLint, TypeScript build, migration check, staging whitespace check. The real `github review pending` command succeeded with `pending: []` in the local project.

## Definition of accepted versus not yet demonstrated

**Accepted:** real GitHub App authentication; real device authorization; local project setup and repeat setup; real empty-case sync/queue; synthetic positive evidence → enrollment → explicit approval → credit → dollar-preview tests; no automatic credits or money movement.

**Not yet demonstrated in a single real-world flow:** importing an actual qualifying merged PR, enrolling its real author, optional contributor-owned verification, approving that actual candidate, and previewing a distribution. The existing `mightymetrika/openpayables` acceptance scans found zero eligible merged PRs. Do **not** create a meaningless PR or pay someone just to fill this gap. Wait for a legitimate candidate or intentionally choose an existing public repository with actual accepted PRs and appropriate operator authorization.

**Not implemented/accepted:** private repository intake, public cross-operator installation of the existing App, hosted multi-tenant identity/access control or one-click setup, automated subjective scoring, LIVE payments, bank settlement of an individual OpenPayables obligation. No BlindStats/RandomPlayables code or database changes. Stripe Connect eligibility review is still pending; each paying operator must own its own funds and Stripe account. OpenPayables itself is free/open source, not a subscription business.

## Reproducible local operator flow (only when real eligible evidence exists)

Use **Windows PowerShell 5.1** in the actual `development` checkout. Set the dedicated OpenPayables database and local operator context; set GitHub App environment variables from local secrets as documented in `docs/GITHUB_APP_INSTALLATION_v0.1.md` and `docs/GITHUB_IDENTITY_VERIFICATION_v0.1.md`.

```powershell
npm run cli -- project setup PROJECT_ID "Project name" owner/repo
npm run cli -- project setup-status PROJECT_ID
npm run cli -- github sync PROJECT_ID owner/repo YYYY-MM-DD
npm run cli -- github review pending PROJECT_ID
# Only proceed if a real candidate exists and the operator has reviewed its source link:
npm run cli -- github enroll PROJECT_ID NUMERIC_GITHUB_USER_ID CONTRIBUTOR_ID "Display name"
# The actual contributor authenticates through Device Flow (separate from operator attestation):
npm run cli -- github identity verify PROJECT_ID CONTRIBUTOR_ID
npm run cli -- github identity show PROJECT_ID CONTRIBUTOR_ID
# Approval is an intentional human decision; C8 does not currently require verification:
npm run cli -- github approve PROJECT_ID NUMERIC_REPO_ID CANDIDATE_KEY medium "Accepted contribution"
npm run cli -- credit balances PROJECT_ID
npm run cli -- distribution preview PROJECT_ID 1100
# Read-only follow-up to confirm approved candidate no longer appears as pending:
npm run cli -- github review pending PROJECT_ID
```

`CANDIDATE_KEY`, GitHub numeric IDs and project names must be copied from actual CLI output; never guess them. Do **not** approve an arbitrary third-party contributor or create funds/obligations without explicit operator authority. Keep test accounting separate from actual money. A preview is only a hypothetical division of cents, not funding or a payment promise.

## Future live-evidence acceptance criteria

When eligible existing real PR evidence becomes available: successful authenticated scan with at least one `newCandidate`; verified candidate/source URL/repo/user mapping; controlled enrollment and (ideally) account-control verification; exactly one explicit credit award; deterministic preview; no duplicate award on repeat/re-sync; no Stripe transfer or obligation. Record results and any actual friction in `PROJECT_HANDOFF.md` before making more code changes. Existing automated positive-case tests do **not** replace this final real-evidence observation.

## New-chat technical workflow

- Obtain **a fresh archive of the accepted `development` branch**; previously attached repository text dumps were exported from old `main` (Checkpoint B) and are **NOT** an accurate C12 source snapshot.
- Keep all handoff files **inside the repo** (`PROJECT_HANDOFF.md` plus this file). Use complete path-preserving ZIP patches containing full changed files, not diffs. Never package node_modules, .env secrets, database URLs beyond documented local test values, Stripe keys, GitHub private PEM, or local output.
- Windows PowerShell 5.1: apply to clean `development`, run `git diff --check`, dedicated `openpayables` migration, `npm run check`, separate `openpayables_test` integration suite, stage/validate, then commit/push `development` only after acceptance. `main` remains unchanged unless explicitly requested.
- Prefer finishing the working MVP over new speculative checklists or frontend designs. Do not merge funds between operators. Never use LIVE Stripe keys or claim Stripe's business-model eligibility has been approved.
- Next work should be driven by a real eligible PR acceptance result, actual operator friction, or Stripe's written response, not an automatic C13 infrastructure expansion.
