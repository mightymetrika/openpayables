# C12 — Contributor enrollment, review queue, and compensation preview

**Status:** C12 Windows PostgreSQL/Vitest acceptance passed on 2026-11-19; documentation updated, implementation commit/push still pending. Base: accepted `development` commit `239962f` (C11). No changes to the live-payment gate or other applications.

## Intended operator workflow

The operator first uses `project setup PROJECT NAME owner/repo` (C11) and `github sync PROJECT owner/repo YYYY-MM-DD` (C7/C9). Only merged PR authors and submitted reviewers discovered by GitHub can enter the queue. `github review pending PROJECT [OFFSET]` returns up to 50 **unapproved** candidates ordered by merge time, including repository ID, immutable candidate key, source URL and status of their project-specific GitHub identity mapping. Use `nextOffset` to page; `github candidates` still shows the full historic queue including approvals.

For a candidate with a numeric GitHub ID, the trusted local operator runs:

```powershell
npm run cli -- github enroll PROJECT_ID GITHUB_USER_ID CONTRIBUTOR_ID "Display name"
npm run cli -- github review pending PROJECT_ID
```

This **one** command creates (or safely reuses) the contributor, joins the project, and records the operator-attested identity link. The three writes share a PostgreSQL transaction and roll back together on any conflict. It requires pre-existing discovered evidence for that GitHub user **in the same project**, and it refuses changing an immutable mapping. A global contributor ID with an existing, different display name is rejected rather than silently overwritten. Repeating the same command returns `contributorCreatedNow: false`, `joinedNow: false`, and `linkedNow: false`.

The contributor can subsequently verify control of their linked GitHub account through the C10 GitHub App Device Flow:

```powershell
npm run cli -- github identity verify PROJECT_ID CONTRIBUTOR_ID
```

This is separate from enrollment: a trusted operator's assertion does **not** prove GitHub account ownership. The review queue shows `identityStatus` as `unlinked`, `operator_linked`, or `verified`. The current C8 `github approve` command **requires a link but not C10 verification**; operators should examine verification status as appropriate. No automatic scoring or points are assigned by enrolling, showing the queue, or verifying an identity.

A human operator reviews the immutable evidence link and reason, and chooses the existing 1/3/8 point rubric:

```powershell
npm run cli -- github approve PROJECT_ID GITHUB_REPO_ID CANDIDATE_KEY large "Accepted implementation"
npm run cli -- credit balances PROJECT_ID
npm run cli -- distribution preview PROJECT_ID 1100
```

`github approve` (C8) atomically and idempotently creates an immutable credit award and approval record; a conflicting repeat fails. The pending queue excludes approved items, but their history remains visible in `github candidates` and `credit history`.

## Preview semantics

The distribution preview accepts a hypothetical positive USD-cent pool and uses existing approved lifetime points, deterministic integer-cent allocation and largest-remainder rounding. An 8:3 credit split and 1100 cents yields 800 and 300 cents exactly. It **does not** check Stripe balances, verify or create funding, approve a period, reserve a pool, lock a financial snapshot, consume points, create payment obligations, or send money. A later actual distribution is independently approved and may use a different snapshot if credits change. There must be positive credits to calculate a preview.

## Safety and scope

- All commands operate on the isolated OpenPayables PostgreSQL database and are intended for a **trusted local operator**, not a multi-user web API. Access control for independent hosted operators is not provided by C12.
- No GitHub username is used as the accounting identity; the stable numeric user ID is stored with the immutable candidate key and internal contributor ID. The account's GitHub login may change.
- Existing project-specific GitHub App bindings and Stripe account ownership remain independent. C12 makes no GitHub API call, requests no new GitHub permission, stores no OAuth token, and never touches Stripe.
- The positive path is covered with synthetic GitHub candidate records in the separate PostgreSQL test database. An authenticated scan of `mightymetrika/openpayables` that returns zero qualifying PRs is a valid empty queue; there is no need to manufacture PRs.
- Existing financial constraints remain: Stripe TEST only, no live transfers, and pending Stripe business-model eligibility review.

## Windows acceptance — passed 2026-11-19

- `npm run db:migrate` completed on the dedicated `openpayables` development database (no C12 migration was necessary).
- `npm run check`: **88/88 unit tests passed**; ESLint and TypeScript build passed. Skipped database tests were run separately.
- `npm run test:integration`: **38/38 tests passed** using only the separate `openpayables_test` database (**126 total** across both suites).
- `git diff --check` and `git diff --cached --check` passed, with precisely the **eight intended C12 files** staged. Windows LF/CRLF conversion warnings were informational.
- A real project lookup, `github review pending openpayables-c11-0ecc34cd`, returned `pending: []`, `hasMore: false`, `nextOffset: null` and exit code 0. This validates the empty-queue path in the operator's existing local database, not ingestion of a real merged PR. Synthetic evidence in PostgreSQL integration tests covers enrollment, conflicts, filtering, approval-related behavior and allocation preview.
- The real queue lookup neither awarded credits nor created financial obligations or Stripe transfers. No actual contributor was enrolled, no GitHub identity was verified and no funded distribution was approved during this C12 real-project check.

**Next:** Commit the eight accepted files to `development` (base `239962f`) and push that branch only, leaving `main` unchanged at `28a79a4`. Keep Stripe live payments disabled while the eligibility review is pending.
