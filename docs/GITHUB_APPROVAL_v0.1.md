# Checkpoint C8 — operator-attested GitHub identity links and approved credits

**Status:** WINDOWS ACCEPTED 2026-11-18; C8 commit pending. **Base:** `development` at `836dc82` (C7 committed). **Mode:** Trusted local operator CLI only; no live payment enablement.

## Purpose

C7 already stores immutable, project-scoped candidate evidence for merged GitHub pull-request authors and submitted human reviewers. C8 connects that evidence to the existing OpenPayables credit and distribution engine:

1. A trusted operator creates an OpenPayables contributor and joins them to a project using the existing commands.
2. `github identity link` binds a candidate's **numeric GitHub user ID** to one existing project contributor. The link is project-scoped, append-only, one-to-one, and cannot silently be reassigned. A login is display-only.
3. `github approve` requires that link and an explicit operator decision (`small` = 1, `medium` = 3, `large` = 8). It automatically selects the existing `development` category for a PR author or `review` for a reviewer.
4. One database transaction inserts the immutable credit event **and** candidate approval record. A repeated command with identical terms returns the original award; conflicting terms or simultaneous races cannot create duplicate credits. `credit reverse` remains the established correction mechanism; the approval record is retained for audit.
5. Existing credit balances and deterministic dollar allocation use these points without any changes to the payment code. **Credit awards do not themselves create funds, obligations, Stripe transfers, or bank payouts.**

## CLI examples (after discovering actual candidates)

```powershell
npm run cli -- github candidates PROJECT_ID
npm run cli -- contributor create alice "Alice"
npm run cli -- project join PROJECT_ID alice
npm run cli -- github identity link PROJECT_ID GITHUB_NUMERIC_USER_ID alice
npm run cli -- github candidates PROJECT_ID
npm run cli -- github approve PROJECT_ID GITHUB_NUMERIC_REPO_ID CANDIDATE_KEY large "Accepted implementation"
npm run cli -- credit balances PROJECT_ID
npm run cli -- credit history PROJECT_ID
```

The candidate queue includes `githubRepoId`, `githubUserId`, `candidateKey`, `linkedContributorId`, `awardId` and `approvedSize`. **Use values returned by the queue**, not guessed IDs. Reviewers may be approved separately, once per human reviewer per PR. The operator is responsible for assessing the actual contribution and whether the person is eligible under the project's terms. A submitted review is evidence, not proof of substantive contribution.

### Important identity boundary

A C8 link is **operator-attested**. It confirms that the project's trusted operator associated two records; it **does not authenticate the GitHub account holder**, prove consent, establish tax/payment identity, or validate legal entitlement. Before making live contributor payments, use a contributor-controlled sign-in/claim process (such as GitHub OAuth), explicit terms/consent, and appropriate Stripe recipient onboarding, subject to Stripe's provider review. C8 does not expose these commands as a public multi-tenant API.

## Database and safety

`sql/008_checkpoint_c8.sql` adds two append-only tables in the existing dedicated PostgreSQL schema:

- `github_identity_links`: `(project_id, github_user_id)` primary key and `(project_id, contributor_id)` unique constraint; foreign key to current project membership.
- `github_candidate_approvals`: one `(project_id, github_repo_id, candidate_key)` approval, linked to exactly one immutable `credit_events` award ID, with the approving operator, rubric size and reason recorded.

The candidate is row-locked in the approval transaction so concurrent submissions serialize. The immutable GitHub source key `repo:REPO_ID:pr:PULL_ID:ROLE:USER_ID` distinguishes evidence across projects/repositories. The payment backend remains unchanged and accepts **only TEST** Stripe keys.

## Acceptance scope

- Existing 61 unit and 15 PostgreSQL integration tests still pass.
- New unit tests cover author/reviewer metadata, stable IDs, invalid sizes/keys, and 1/3/8 point behavior.
- New dedicated-database integration tests cover mapping permissions/conflicts, no award without an identity link, exact-once repeat and concurrent approvals, unchanged audit history, and deterministic **8:3 credits → $8/$3 from an operator-attested $11 TEST pool**, with obligations held and **no Stripe request**.
- The C7 public GitHub scan of `mightymetrika/openpayables` yielded zero candidates, so the end-to-end positive evidence-to-dollars case is **synthetic evidence in a dedicated test database**. A real positive public PR/review import is useful in a later acceptance exercise; do not pretend it has already happened.
- No migration or code changes outside the OpenPayables repository. Do not touch BlindStats or RandomPlayables databases.

## Windows acceptance evidence — 2026-11-18

- `npm run db:migrate`: passed against the OpenPayables development database.
- `npm run check`: **64 unit tests passed**, **ESLint passed**, **TypeScript build passed**. The 20 integration tests skipped in the unit run were separately executed and passed.
- `npm run test:integration`: **20 PostgreSQL integration tests passed** (3 core PostgreSQL, 8 finance, 4 GitHub discovery, 5 GitHub approval).
- `git diff --cached --check`: passed; **11 staged C8 implementation/documentation files**. CRLF/LF warnings were informational.
- Positive end-to-end approval and allocation were exercised with **synthetic GitHub evidence** in the dedicated test DB. The live public GitHub scan in C7 yielded zero candidates, so a real merged-PR approval is not claimed. No extra GitHub test PR, Stripe transfer, payout, or live operation was necessary.
- Repository's `mncube` contributor attribution is Git history attribution and does not establish a C8 numeric-ID link or entitlement to compensation.

## Next after acceptance

Commit/push the accepted 11 C8 files with these updated documents to `development`; keep `main` unchanged. Next, build least-privilege reusable GitHub App installation and contributor-controlled identity authorization for independent operators. Do not enable live money movement until Stripe and operational requirements are resolved.
