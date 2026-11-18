# Checkpoint C7 — public GitHub contribution discovery (TEST/local MVP)

**Date:** 2026-11-18 (US Pacific)

**Starting Git baseline:** `development` commit `e5c69c3` (C6 accepted and pushed)

**Status:** Windows acceptance passed on 2026-11-18; staged for commit on `development`.

## Purpose

OpenPayables can already approve individual credit events and allocate an operator-approved money pool. C7 adds the **missing read-only GitHub evidence intake**. C7 never awards points, approves money, initiates payment, changes Stripe records, or modifies a GitHub repository. C8 will implement identity confirmation and operator approval of candidates into immutable `credit_events`.

## New CLI

- `github source add <project-id> <owner/repo>` — verify GitHub's current public repository ID and bind it to an existing OpenPayables project. Idempotent on an identical source; rejects renamed/replaced identities. Does not install a GitHub App.
- `github source list <project-id>` — display the registered sources for the project.
- `github sync <project-id> <owner/repo> <since-YYYY-MM-DD> [max-pr-pages]` — GET-only discovery of PRs merged on or after midnight UTC of the supplied date, and submitted human reviews of those PRs. `max-pr-pages` defaults to 2; range 1–5.
- `github candidates <project-id> [offset]` — read the local evidence queue in pages of 100; `nextOffset` signals further records.

Example (use a **new** isolated local project):

```powershell
$env:OPENPAYABLES_DATABASE_URL = 'postgresql://openpayables:openpayables_local_only@127.0.0.1:5432/openpayables'
$env:OPENPAYABLES_OPERATOR_ID = 'local-operator'
npm run db:migrate
npm run cli -- project create c7-local-demo 'C7 evidence discovery'
npm run cli -- github source add c7-local-demo mightymetrika/openpayables
npm run cli -- github source list c7-local-demo
npm run cli -- github sync c7-local-demo mightymetrika/openpayables 2026-11-01
npm run cli -- github candidates c7-local-demo
```

This example is subject to current GitHub repository activity and rate limits; a valid scan may return zero candidates. It sends no provider or Stripe requests. Do not paste any access token into a command or chat. Public repository discovery works without a token; optional `OPENPAYABLES_GITHUB_TOKEN` can increase rate limits. If supplied, grant only the least permission needed, keep it outside Git and remove it from the session when no longer required.

## Evidence semantics

- **PR author candidate:** one per merged pull request and stable numeric GitHub author ID.
- **Reviewer candidate:** at most one per submitted human reviewer for that merged pull request; multiple accepted `APPROVED`, `CHANGES_REQUESTED` and `COMMENTED` reviews are grouped into a single candidate with source review IDs. Excludes the PR's author, bot accounts, pending/dismissed reviews, and reviews submitted after merge. A candidate is **not** a quality assessment.
- The stable identity is GitHub's numeric repository, pull request, and user ID. Login/title are descriptive only. GitHub usernames may change; there is **no implicit contributor matching**.
- Candidate records are append-only snapshots: identical rescans yield zero additions; any changed metadata is counted as `changedEvidence`, leaving the original persisted snapshot intact. C7 does not rewrite an approved award or infer a payout from changed GitHub evidence.
- No duplicate credit can result from C7 because **there is no award command in this slice**. The next checkpoint must deliberately link a GitHub numeric user ID to an operator-approved OpenPayables contributor ID before awarding anything.

## Boundaries and incomplete-data handling

The sync fetches closed PR pages ordered by GitHub's `updated_at` descending, checks `merged_at` against the UTC date, and fetches paginated review details for each qualifying merged PR. Requests are bounded: 50 total GitHub requests per CLI invocation, 1–5 PR pages (50 PRs/page), and up to 3 review pages (100 reviews/page) per PR. The connector refuses incomplete pagination, malformed payloads, duplicate source IDs, private/redirected repositories, rate-limit errors and unexpected HTTP statuses.

**Critical:** The full network discovery completes before a single candidate is written. A failed or incomplete scan leaves the candidate table unchanged. A failed database batch rolls back transactionally. Use a more recent `since` date (or increase max pages within the bounded limit) if you reach pagination limits; C7 is not yet a historical bulk import engine. The `since` date selects the **merge date**, not the date each reviewer submitted their review.

PostgreSQL `sql/007_checkpoint_c7.sql` introduces project-scoped `github_sources` and immutable `github_candidates`. There are no Stripe migrations or tenant-authentication changes. C7 does not create a hosted GitHub App, OAuth consent, automated scheduled polling, webhooks, private-repository support, or contributor payouts. The trusted operator CLI is not suitable as a public multi-tenant service.

## Windows acceptance results — 2026-11-18

- Dedicated development database migration succeeded.
- `npm run check`: **61/61 unit tests passed**, ESLint and TypeScript build passed. The 15 database integration tests are intentionally skipped by this command and were run separately.
- `npm run test:integration`: **15/15 PostgreSQL tests passed**, including 4 GitHub integration tests.
- `git diff --cached --check`: passed after staging the 11 C7 implementation files. PowerShell displayed informational LF/CRLF warnings.
- Public GitHub project `openpayables-c7-8dcd0ee2`: `github source add` registered `mightymetrika/openpayables` with GitHub numeric repository ID `1460710596`; `github source list` returned the same registration.
- `github sync` with `since=2026-11-01` returned `discovered=0`, `newCandidates=0`, `unchangedCandidates=0`, `changedEvidence=0`, `creditsAwarded=0`, `paymentObligationsCreated=0`; `github candidates` returned an empty array and `hasMore=false`.
- **Evidence boundary:** This live check demonstrates working public GitHub connectivity and a successful *empty* scan, not ingestion of a positive real PR/review. Positive candidate parsing, duplication and persistence were covered by automated tests. A further positive public-repo scan is useful but not a prerequisite to commit this tested C7 slice.
- No candidate approval, credit award, Stripe transfer or bank payout was performed.

## Acceptance

1. The full Windows `npm run check` and dedicated `npm run test:integration` suites must pass (passed 2026-11-18). New GitHub client unit tests use mocked API responses, including pagination/rate-limit failures and stable IDs. New PostgreSQL tests check duplicate registration, idempotent import, changed evidence, rollback, and no credit/payment side effects.
2. Optionally perform a **GET-only** public repository import with `github source add`, `github sync`, `github candidates`. Capture counts rather than any credentials.
3. Record observed results in `PROJECT_HANDOFF.md` (done); commit/push `development` after staging the acceptance documentation; keep `main` unchanged.

Reference: https://docs.github.com/en/rest/pulls/pulls and https://docs.github.com/en/rest/pulls/reviews . GitHub's default unauthenticated REST API quota is 60 requests/hour per originating IP; C7 caps its own requests below that but can't control other callers sharing the IP.
