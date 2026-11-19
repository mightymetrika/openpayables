# OpenPayables — Project Handoff

**Date:** 2026-11-19 (US Pacific)
**Current version:** Checkpoints A–C9 committed. **C10 contributor-controlled GitHub identity verification accepted in Windows tests and real GitHub `whoami`; awaiting C10 source checkpoint commit.**
**Git baseline:** `28a79a4` on `main` (Checkpoint B); `e8afaf3` on `development` (C9 real GitHub acceptance docs committed and pushed).
**Remote:** https://github.com/mightymetrika/openpayables
**Working branch:** `development` at C9 `e8afaf3` with 14 C10 implementation files staged and passing validation; acceptance documentation update and C10 commit/push still pending. Do not change blindstats.

## Checkpoint C10 — contributor-controlled GitHub identity verification (WINDOWS + REAL DEVICE AUTH ACCEPTED; PENDING COMMIT)

- GitHub App **Device Flow** generates a short-lived user access token used once to query authenticated `GET /user`. The user enters the short code at GitHub; no user OAuth token or refresh token is stored. The App ID and public Client ID are distinct. A signed `GET /app` verifies their correspondence before any device authorization.
- `github identity whoami` performs a no-database-write device-flow smoke check, useful because the actual C7 project has no merged PR candidates.
- `github identity verify PROJECT CONTRIBUTOR` requires the authenticated GitHub numeric ID to **match** the existing immutable C8 operator-attested identity link and requires this App to be bound to the project. It creates a unique, immutable PostgreSQL verification record; `github identity show` and the candidate queue show this separate verification evidence.
- Existing C8 credit approvals remain operator-controlled and cannot be silently reassigned. C10 adds evidence of account control at a point in time; it does not prove legal identity or authorize live payments. No changes to Stripe, BlindStats or RandomPlayables.
- New migration `010_checkpoint_c10.sql`, adapter `src/github/device-flow.ts`, CLI support, unit/integration tests, and `docs/GITHUB_IDENTITY_VERIFICATION_v0.1.md`.
### C10 acceptance evidence — 2026-11-19 (US Pacific)

- **GitHub App settings:** Device Flow enabled for the existing Mightymetrika OpenPayables App (`5825297`); OAuth-on-installation remains off. No expanded repository permissions, callbacks or webhooks were required.
- **Windows migration:** `npm run db:migrate` completed successfully against the dedicated OpenPayables development PostgreSQL database.
- **Windows tests:** `npm run check` passed **80/80 unit tests**, ESLint and TypeScript build. The 28 database tests skipped by that command were run separately: `npm run test:integration` passed **28/28 PostgreSQL integration tests** against the dedicated `openpayables_test` database.
- **Git checks:** `git diff --check` and `git diff --cached --check` passed; 14 intended C10 implementation files staged. Windows LF/CRLF warnings were informational.
- **Real GitHub authentication:** `github identity whoami` completed the GitHub App Device Flow. GitHub's authenticated `/user` returned `githubLogin=mightymetrika` and stable `githubUserId=134214097`, with `verifiedBy=github_app_device_flow` and **`stored=false`**. No temporary device code, OAuth token, or private key is recorded in this handoff.
- **Scope of evidence:** The real `whoami` flow confirms GitHub account control, **not** a persisted project contributor verification; `whoami` makes no identity-record write. The exact C8-link-to-C10-verification positive path and adverse cases passed in the PostgreSQL integration suite using test data. The public C7 scan has no qualifying merged PRs and no real project-linked verification was performed. No test PR was created just to satisfy acceptance.
- **No financial side effects:** No credits, monetary obligations, Stripe funds, transfers or bank payouts were created or modified during the real `whoami` test. Stripe live approval remains pending; live payment keys are still disabled.

**NEXT:** Apply this documentation-only C10 acceptance patch, re-stage the updated three files, confirm all 14 intended files and whitespace validation, commit and push C10 on `development` only. Keep `main` at `28a79a4`. Then prioritize the next practical GitHub onboarding/operability MVP slice, avoiding unnecessary test-only PRs.

## Checkpoint A — validated

Validated on Windows 11, Node 24.19.0, PostgreSQL 17 using PowerShell 5.1:
- 1/3/8 contribution-credit awards, immutable history and reversal support, 8:3 balances.
- Advisory governance: frozen weighted voting snapshots, demonstrated 8:3 vote.
- Nine original unit tests and three PostgreSQL integration tests passed; lint, build, migration and local demo passed.
- Checkpoint A main baseline: `38a28a0`.

## Checkpoint B — implemented and validated

- `src/core/allocation.ts`: deterministic integer-cent largest-remainder allocation.
- `sql/002_checkpoint_b.sql`: operator-attested TEST funding, approved periods, frozen credit/amount snapshots, held obligations, immutable payment history, attempts and provider events.
- `src/storage/postgres/finance.ts`: reserved-pool controls, preparation, single attempt, reconciliation, Stripe event deduplication.
- `src/payments/provider.ts`: provider interface; `src/payments/stripe/test-client.ts`: TEST-only Stripe Connect REST adapter and Express onboarding.
- `src/server/webhook.ts`: locally bound signed Stripe TEST webhook listener.
- `src/cli/index.ts`: funding, distribution, payment and test Stripe commands; preserves Checkpoint A commands.
- `scripts/checkpoint-b-demo.ps1`: no-Stripe 8:3 credits -> $8/$3 TEST money-ledger demonstration.
- Implementation committed and pushed on `development` as `58ab02a`.

### Acceptance evidence — 2026-11-17

- Isolated Stripe sandbox **OpenPayables Development**; API account was verified before test operations; `livemode = false`.
- Synthetic contributor Alice's Stripe Connect Express account passed `details_submitted`, `payouts_enabled` and `charges_enabled` checks.
- $20.00 **simulated** Stripe top-up succeeded and appeared in the sandbox available balance. Separate OpenPayables operator-attested TEST ledger funding was $11.00 allocated using an 8:3 snapshot.
- Existing Alice $8.00 obligation: `held` -> `ready` -> `submitting` -> `transferred` through the OpenPayables CLI. Stripe independently verified a USD transfer of 800 cents to the intended connected account, `livemode = false`, `reversed = false`.
- Reconciliation reported the same transfer ID, `tr_1UcrZJPGvHvd36JRzD9t2R8z`, and a complete audit trail. A direct DB query confirmed **exactly one** payment attempt for Alice; Bob's $3.00 obligation remained **held** with zero payment attempts.
- `npm run test:integration`: **6/6 passed** (3 PostgreSQL core + 3 finance tests) against separate `openpayables_test` database.
- `npm run check`: **15/15 unit tests passed**, ESLint passed, TypeScript build passed. The six DB integration tests skipped in this command were separately run and passed.
- `git branch --show-current`: `development`; `git status --short`: empty.

**Financial boundary:** `fund add` is operator-attested **test funding**, not validation of externally received cash. `transferred` confirms a Stripe Connect transfer into the connected Stripe account, **not** a bank payout. No live keys accepted; no production settlement or legal/tax approval implied. Unknown payment outcomes must not be automatically resent.

## Checkpoint C1 — TEST-mode liquidity preflight (VALIDATED, COMMITTED)

- The `payment send` path first queries the authenticated Stripe TEST platform's **available USD balance**, before creating an immutable payment attempt. Insufficient funds or a failed balance query leave an already `ready` obligation untouched and create zero attempts.
- `stripe balance` is an explicit read-only operator CLI command, returning USD available cents (no key output).
- The Stripe TEST adapter rejects any balance payload that does not positively report `livemode=false`, and checks balance amounts are safe integers.
- The `payment send` preflight is deliberately **not an atomic provider balance reservation**. Concurrent transfers and external Stripe activity may still change availability; a subsequent ambiguous transfer error remains `unknown` and cannot be blindly retried.
- **Crucial financial boundary:** The Stripe platform balance aggregates funds; its availability does not prove that a given project received or owns revenue, nor that funds are free from other commitments. `fund add` remains operator-attested TEST funding. This step does not enable live payments or bank-payout tracking.
- New unit tests exercise available-versus-pending balances, test-mode rejection and malformed balances. An expanded PostgreSQL finance integration test asserts zero payment attempts when balance is insufficient.
- On Windows PowerShell 5.1, `npm run check`: **18 unit tests**, clean ESLint and build; `npm run test:integration`: **6 PostgreSQL tests**. C1 committed and pushed to `development` as `23a24ce`; working tree clean. `main` deliberately remains at `28a79a4`.

## Checkpoint C2 — Stripe TEST top-up source attribution (VALIDATED, COMMITTED)

- New migration `sql/003_checkpoint_c2.sql`: each TEST funding event identifies either an existing operator attestation or a provider-verified TEST receipt. Stripe account + top-up ID can be attributed to only **one** project. Historical attestations remain intact.
- `fund import-topup <project-id> <tu_...>` reads a previously created Stripe TEST top-up and validates ID, `livemode=false`, `status=succeeded`, USD, positive integer cents, Stripe balance transaction and authenticated platform account ID. This command **does not create top-ups or move money**.
- One project cannot mix operator-attested TEST funds with provider-verified top-ups, nor mix Stripe test platforms. Project locks serialize funding additions, imports and distribution approvals; existing reservation rules still apply.
- `fund status` reports attested and verified TEST amounts independently; `payment send` from a verified-funded project also checks that its Stripe account identity matches the project's receipt source before reserving an attempt. Existing Stripe TEST balance preflight still runs.
- Unit and integration test cases cover valid/invalid evidence, duplicate receipt rejection across projects, no mixed funding, reserved-pool limits and wrong-platform payment rejection.

### Acceptance evidence — 2026-11-17

- C2 migration succeeded in the dedicated development PostgreSQL database; `npm run test:integration` passed **7/7** tests against a separate test database. `npm run check` passed **27/27 unit tests**, ESLint and the TypeScript build after a one-line `rowCount` nullability correction. `git diff --check` passed.
- The isolated Stripe TEST platform returned a **succeeded $5.00 top-up** (`tu_1UcuKEPGvHvd36JRmBSy8HJf`) with USD balance transaction `txn_1UcuLDPGvHvd36JRV9ucVdpS`; `livemode = false`.
- `fund import-topup` attributed that receipt to the newly created project `openpayables-c2-verified-0c89cbaf`. `fund status` confirmed **0 attested, 500 verified TEST, 0 reserved, 500 remaining cents**.
- A second project (`openpayables-c2-duplicate-a525d7ae`) tried importing the **same** top-up. The CLI rejected it with `Stripe TEST top-up already attributed; duplicate funding refused` and a nonzero exit code. The first project retained 500 verified cents and the second remained at zero.
- The acceptance tests did **not** create any Stripe transfers or live payments and did not rerun Alice's completed Checkpoint B transfer.

**Limitations:** A provider-confirmed top-up shows a test funding event, **not** the app's actual subscription revenue, funds beneficially owned by the named OpenPayables project, or cash free of other platform liabilities. A top-up could be reversed or used elsewhere later. Later work must recheck/reconcile evidence and reservations across projects and assess provider/legal/tax requirements. Stripe LIVE keys and bank-payout features remain disabled.

## Checkpoint C3 — receipt-reversal holds and shared-platform commitments (VALIDATED, COMMITTED)

- Forward migration `sql/004_checkpoint_c3.sql` creates an **immutable funding receipt alert** per imported receipt. An observed reversal, status/amount/currency/transaction change, or platform mismatch creates a lasting alert. No existing original receipt or frozen distribution is silently rewritten. There is **no automatic alert clearing**: resolving a shortfall requires a separately reviewed corrective procedure.
- `fund recheck <project-id>` makes read-only Stripe TEST API calls for **every imported receipt assigned to that same Stripe TEST platform**. It returns receipt counts and persistent alert counts, without creating money or transfers. Network/API failure stops inspection rather than presuming a reversal.
- For verified-receipt projects, `distribution approve` now **rechecks Stripe receipts automatically**, excludes alerted receipts from usable funding, and considers **all approved allocation commitments across projects on the same platform**, serialized with an advisory lock. Existing attested-test projects retain their prior behavior.
- Verified-project `payment send` also rechecks platform receipts, confirms the platform funding ledger is solvent, and compares available USD balance against **all unpaid/uncertain obligations** for the same platform, not just one requested transfer. The preflight and external transfer are serialized for verified projects using a PostgreSQL advisory session lock. No failed preflight reserves a payment attempt.
- `fund status` adds `blockedVerifiedCents`; `remainingCents` can become **negative** after a funding reversal because existing obligations remain intact. A negative balance is a financial exception, not permission to remove or reallocate obligations.
- The automatic checks are scoped to OpenPayables **verified TEST** projects sharing the same Stripe account and database. Other platform activity and legacy **operator-attested** TEST projects cannot be fully attributed. The checks do **not** constitute a reservation at Stripe, prove project ownership, or track bank settlement. No live payment key/path exists.
### Acceptance evidence — 2026-11-17

- Development database forward migration completed successfully. The initial C3 validation detected two failing PostgreSQL integration tests caused by reused fake Stripe platform IDs in persistent test data; unique fake platform IDs corrected the test isolation. A separate `no-unsafe-finally` ESLint issue was corrected in transfer lock cleanup. The final corrected C3 code passed **8/8 PostgreSQL integration tests**, **29/29 unit tests**, ESLint and the TypeScript build; `git diff --check` passed (Windows LF/CRLF informational warnings only).
- With the Stripe TEST key, `fund recheck openpayables-c2-verified-0c89cbaf` returned platform `acct_1Ucqb8PGvHvd36JR`, `checked = 1`, `newlyObservedProblems = 0`, and `blockedReceipts = 0`.
- `fund status` for that project returned `attestedCents = 0`, `verifiedTestCents = 500`, `blockedVerifiedCents = 0`, `reservedCents = 0`, and `remainingCents = 500`.
- No new top-up or Stripe transfer was created during this C3 acceptance. The reversal/overcommit behavior was verified by automated tests using fake provider observations, **not** by intentionally reversing a real Stripe sandbox receipt.
- C3 committed and pushed to `development` as **`f263f46`**, working tree clean. `main` remains at `28a79a4`.


## Checkpoint C4 — operator-owned Stripe boundaries (VALIDATED AND PUSHED)

- **Product decision:** each independent project operator uses its *own* eligible Stripe account, funds and contributor relationships. Mightymetrika's account only pays its own project contributors; OpenPayables is the reusable software, not a central funds processor. OpenPayables itself is intended to be a free open-source utility. Adopting projects may generate their own subscription or other revenue and allocate their own funds to contributor compensation. Contributor recipients may use Stripe-hosted onboarding under the operator's Connect account.
- `sql/005_checkpoint_c4.sql` records immutable TEST-mode project/account bindings (no credentials). Existing verified-top-up projects are backfilled; a new imported verified receipt automatically binds its source platform.
- `stripe platform bind <project-id>` uses the operator's current `sk_test_` credentials to verify the owning Stripe platform's `/v1/account` ID. `stripe platform show` displays non-secret binding metadata. An existing binding cannot be reassigned silently.
- `payment prepare`, `payment send`, and `payment reconcile` require matching authenticated Stripe account credentials. Recipient account creation requires a prior project binding. Legacy attested-only projects require an explicit binding; unbound projects with earlier payment attempts require manual historical source verification before enabling further operations.
- C4 is **local, single-operator security hardening**, not a multi-tenant access system. The self-reported `OPENPAYABLES_OPERATOR_ID` does not authenticate an operator. A hosted version will require per-tenant authentication, approved OAuth/Stripe App or restricted-key connection flows, account-scoped webhooks, and separate funding/audits.
- Stripe docs reviewed: https://support.stripe.com/questions/plugin-user-migration-guide and https://support.stripe.com/questions/security-permissions-and-access-levels-when-connecting-your-stripe-account-to-a-third-party-platform . These do **not** constitute approval of this specific payments model.
- Documentation: `docs/OPERATOR_STRIPE_OWNERSHIP_v0.1.md` and `docs/LIVE_PAYMENT_READINESS_v0.1.md`. **No Stripe LIVE key or transfer path added.**

### C4 acceptance evidence — 2026-11-17 (Windows/PostgreSQL 17)

- `sql/005_checkpoint_c4.sql` applied successfully to the dedicated development database.
- `npm run test:integration` passed **9/9** tests on the separate `openpayables_test` database; after correcting only an expected-error regex, the account-mismatch tests reject mismatched TEST credentials **before** a transfer attempt.
- `npm run check` passed **29/29 unit tests**, ESLint and the TypeScript build; `git diff --check` passed. Line-ending warnings were informational.
- `stripe platform show openpayables-c2-verified-0c89cbaf` returned the existing platform `acct_1Ucqb8PGvHvd36JR`, `mode=test`, `bound_by=c4-verified-receipt-backfill`. This was a read-only local binding lookup, **not** a real payment or independent Stripe API acceptance test.
- No additional Stripe top-up, transfer, live account connection, or live payment was performed. C4 was committed and pushed to `development` as `15cb19c`; `git status --short` was empty. `main` remains at `28a79a4`.

## Checkpoint C4 post-commit cleanup and Stripe inquiry — completed

- The C4 accepted code was committed at `15cb19c`. Three Markdown whitespace lines and stale acceptance metadata were corrected, and the documentation-only follow-up was pushed as **`d03c455`**; the development working tree was clean, with `main` unchanged at `28a79a4`.
- Stripe support received the written **operator-owned model** eligibility inquiry on 2026-11-17. A human Connect review was requested. No answer, written approval, or case number has yet been received. LIVE remains disabled.

## Checkpoint C5 — TEST connected-account bank payouts (VALIDATED, COMMITTED)

- `sql/006_checkpoint_c5.sql` adds project/contributor-scoped **latest connected-bank-payout snapshots** and **immutable observations**. No obligations, funding, or transfers are modified by payout inspection.
- `StripeTestClient.listConnectedPayouts()` uses `GET /v1/payouts` with `Stripe-Account: <recipient-acct_...>`; rejects LIVE/malformed evidence, missing scope and incomplete pagination. The existing `sk_test_` guard remains hard-coded.
- `payout sync <project> <contributor>` requires the bound operator's Stripe account and a previously configured recipient; records status/arrival/failure changes with idempotent repeated sync and stops on invalid identity/amount or a regressive terminal state. `payout show` retrieves the local audit.
- Stripe's `paid` status applies to an **account-level payout**, possibly combining money from several Stripe transfers and unrelated transactions; it **never** changes an OpenPayables obligation to `paid_out`. A later `failed` observation remains visible. See `docs/BANK_PAYOUT_OBSERVATION_v0.1.md`.
- New tests cover GET-only account scope, pagination, invalid/LIVE responses, wrong platform, history idempotency, transitions and unchanged obligations.

### C5 acceptance evidence — 2026-11-17 (Windows/PostgreSQL 17; Stripe TEST sandbox)

- `sql/006_checkpoint_c5.sql` migration completed successfully on the dedicated OpenPayables development database.
- `npm run test:integration` passed **10/10 PostgreSQL tests** against `openpayables_test`; `npm run check` passed **40/40 unit tests**, ESLint and TypeScript build. All 11 expected C5 files were staged and `git diff --cached --check` passed; Windows LF/CRLF warnings were informational.
- Read-only live Stripe **sandbox API** check used the existing TEST platform `acct_1Ucqb8PGvHvd36JR`, existing synthetic Alice recipient `acct_1Ucr1LA9lZlrd52M`, and a new isolated observation project `openpayables-c5-observation-879152d9`. Project ownership binding matched the expected TEST platform.
- `payout sync` made **two successful GET-only inspections**: `observedPayouts=0`, `newPayouts=0`, `newObservations=0`, `individualObligationsSettled=0` both times. `payout show` reported empty payout and event arrays. No Stripe bank payout existed in the returned records; this is valid but **not** proof of completed bank settlement.
- No Stripe transfer, top-up, payout creation, or LIVE operation occurred. Individual payment-obligation statuses were not changed by the payout observer. **C5 committed and pushed as `3699855`; `development` clean, `main` unchanged at `28a79a4`.**

## Checkpoint C6 — TEST automatic-payout composition (VALIDATED, COMMITTED)

- `payout trace <obligation-uuid> <po_...>` is a GET-only probe for a named standard automatic bank payout's balance transactions; it verifies the original TEST transfer and destination payment, tests identity/amount matching, and never changes obligation settlement state.
- **Acceptance on Windows, 2026-11-17:** `npm run check` passed **51/51 unit tests**, ESLint, TypeScript build; `npm run test:integration` passed **11/11** PostgreSQL tests. No actual payout `po_...` existed for the synthetic recipient, and no provider transfer/payout was created merely to exercise trace.
- C6 accepted and pushed to `development` as **`e5c69c3`**, working tree clean; `main` remained `28a79a4`. `docs/AUTOMATIC_PAYOUT_TRACE_v0.1.md` records the limitations.

## Checkpoint C7 — public GitHub discovery (WINDOWS ACCEPTED; COMMITTED `836dc82`)

- **Starting Git baseline:** `development` at **`e5c69c3`**. The user's previous exported repository text reflected the older B main branch; C7 source is based on the accepted C6 code, not the stale export.
- New forward migration `sql/007_checkpoint_c7.sql` introduces immutable, project-scoped public GitHub source registrations and candidate evidence snapshots. `src/github/discovery.ts` is a read-only, bounded GitHub REST adapter; `src/storage/postgres/github.ts` persists evidence in transactions.
- CLI: `github source add`, `github source list`, `github sync`, `github candidates`. Scans discover merged PR authors and submitted human PR reviewers. Multiple reviews by the same user for the same PR are grouped to avoid quantity-based duplicate candidates.
- GitHub numeric repository/user/PR/review IDs provide durable source identity; usernames are display-only. A renamed/redirected/replaced repository is refused until explicitly reconfigured. Each source is bound to an OpenPayables project.
- Every successful scan completes all GitHub pages **before writing**; partial/rate-limited/malformed scans fail closed. Repeated scans do not duplicate candidates; changed evidence is reported without silently overwriting immutable observations.
- **No C7 automatic credit awards, GitHub identity-to-contributor links, payments, live Stripe capability, GitHub App installation or hosted service.** C8 will add operator-confirmed identity linking and approval of candidates into the existing credit allocation engine. A project can monetize its own software; **OpenPayables itself is intended as free, reusable open-source infrastructure**, not a required subscription SaaS.
- Tests cover read-only GitHub intake, pagination and incomplete-response refusal, repository identity, immutable candidates, repeat synchronization and no credit/payment side effects. See `docs/GITHUB_DISCOVERY_v0.1.md` for acceptance evidence.

### C7 acceptance evidence — 2026-11-18 (Windows/PostgreSQL 17; public GitHub API)

- Migration `sql/007_checkpoint_c7.sql` applied successfully to the dedicated OpenPayables development database.
- `npm run check` passed **61/61 unit tests**, ESLint, and TypeScript build. The **15 integration tests skipped** by this command were run separately: `npm run test:integration` passed **15/15** against `openpayables_test`.
- `git diff --check` and `git diff --cached --check` passed. Git's LF/CRLF warnings were informational. All **11 expected C7 files** were staged; **subsequently committed and pushed**.
- A separate local project `openpayables-c7-8dcd0ee2` registered the public `mightymetrika/openpayables` repository (stable GitHub repository ID `1460710596`); listing confirmed the source registration.
- `github sync openpayables-c7-8dcd0ee2 mightymetrika/openpayables 2026-11-01` completed with `discovered=0`, `newCandidates=0`, `unchangedCandidates=0`, `changedEvidence=0`, `creditsAwarded=0`, and `paymentObligationsCreated=0`.
- `github candidates` reported an empty queue, `hasMore=false`. An empty successful scan **does not demonstrate live positive candidate ingestion**; positive author/reviewer discovery and duplicate protection were tested with mocks and the database integration suite, but should also be exercised against an active public repo when convenient.
- GitHub discovery did not create credit awards or Stripe transfers/payouts. Stripe's operator-owned business-model eligibility review remains pending; no LIVE capability is enabled.

## Checkpoint C7 post-acceptance Git checkpoint — 2026-11-18

The user applied the C7 acceptance documentation, staged all 11 expected files, and passed `git diff --cached --check`. C7 was committed as **`836dc82`** (`feat: discover public GitHub contribution evidence`) and pushed successfully to `origin/development`. Local and remote `development` matched; `git status --short` was empty, and `main` remained at `28a79a4`. The user-uploaded GitHub text export still reflects older B code; use the committed C7 source or the full checkpoint patch history, **not** that export, for future changes.

## Checkpoint C8 — GitHub identity and operator-approved evidence (WINDOWS ACCEPTED; COMMITTED `cf57959`)

- Forward migration `sql/008_checkpoint_c8.sql`: two append-only, project-scoped tables for trusted-operator GitHub numeric-ID-to-contributor links and immutable candidate-to-credit approvals; foreign keys and unique constraints prevent silent reassignment and repeat credits.
- `github identity link <project> <github-user-id> <contributor>` requires discovered candidate evidence and existing project membership. Each GitHub ID maps to only one project contributor, and each contributor to only one GitHub ID **within that project**. A username alone is not an identifier.
- `github approve <project> <repo-id> <candidate-key> <small|medium|large> <reason>` locks the source candidate and atomically records the existing `credit_events` award (author = development; reviewer = review) and C8 approval evidence. Duplicate identical approvals return the original credit event; conflicting terms fail. No Stripe or payment code changed.
- Candidate listing now shows identity link, approval ID and approved rubric size for review. C8 links are **operator-attested**, not authenticated proof that a contributor owns the GitHub account; consent/verified account claim is deferred to the hosted GitHub App/onboarding stage.
- New unit and PostgreSQL integration tests exercise identity conflicts, transaction rollback, repeated/concurrent approvals, immutable audit, and a synthetic positive end-to-end `8:3` GitHub credits → `800/300` cents from an operator-attested **TEST** $11 pool, with held obligations and no actual payment.
- **Windows acceptance passed (2026-11-18):** Development migration `sql/008_checkpoint_c8.sql` succeeded; `npm run check` passed **64/64 unit tests**, ESLint, and TypeScript build; `npm run test:integration` passed **20/20 PostgreSQL tests** against `openpayables_test`. `git diff --check` and `git diff --cached --check` passed. All 11 intended C8 files were staged. Git LF/CRLF notices were informational. No LIVE payments, Stripe transfers, hosted app, or changes to BlindStats/RandomPlayables.
- Details and commands: `docs/GITHUB_APPROVAL_v0.1.md`.

C8 was subsequently committed and pushed successfully to `origin/development` as **`cf57959`** on 2026-11-18. Local and remote `development` match; working tree clean and `main` still `28a79a4`.

## C8 acceptance boundaries and next action

- The positive **GitHub evidence → explicit operator approval → immutable credits → 8:3 points → $8/$3 TEST allocation** is validated using synthetic evidence in the isolated integration test database. The actual public GitHub scan for `mightymetrika/openpayables` found no eligible merged PRs, so a real positive GitHub import remains untested. A new test PR solely for this checkpoint is not required.
- GitHub's contributor display of `mncube` reflects Git commit attribution in the repository; it is separate from OpenPayables' contributor identity links, payment identity, and the GitHub account used for authentication/pushing. Do not infer that credits or compensation have been assigned to it.
- **Historical note (C8):** Subsequent C9 GitHub App acceptance was completed and documented at `e8afaf3`. C10 contributor authorization is the next active implementation. Preserve `main` at `28a79a4`; no LIVE money movement.

## Checkpoint C9 — reusable GitHub App installation path (WINDOWS + REAL GITHUB ACCEPTED; COMMITTED `1fc009a`)

- A hosted deployment can operate one GitHub App while independent project operators install it only on repositories they choose. This is **GitHub access only**; every OpenPayables operator retains its own Stripe payment credentials, balances, contributor obligations and financial responsibility. Self-hosted installations can register their own App.
- `src/github/app.ts` uses the GitHub App's numeric ID and RSA private key from a configured file **outside Git** to create a short-lived RS256 JWT, verify a repository installation and its read permission, mint a short-lived token explicitly restricted to a **single GitHub repository ID** and `pull_requests:read`, and verify the token resolves to the expected immutable public repository ID. Secrets never enter DB or CLI JSON results.
- New migration `009_checkpoint_c9.sql` adds an immutable, project-scoped installation binding; `github app bind` verifies and binds a registered public source, while `github app show` reports safe metadata. Duplicate matching binds are idempotent; conflicting binds are refused.
- `github sync` keeps its existing public mode when unbound. **Once App-bound it always checks the installation and uses its scoped token; revocation, permission loss, wrong App or changed installation fails closed, never falls back to public access**. Candidate approval, points and Stripe payment paths remain unchanged.
- Unit and dedicated PostgreSQL integration tests added. The real App installation and authenticated public-repository sync have now also been exercised successfully. **Private repository discovery, GitHub App onboarding UX, authenticated contributor identity claims and GitHub webhooks are not in C9.** See `docs/GITHUB_APP_INSTALLATION_v0.1.md`.

### C9 Windows acceptance evidence — 2026-11-18

- Forward migration `sql/009_checkpoint_c9.sql` completed successfully in the dedicated `openpayables` development database.
- First `npm run check` run had **70 passing unit tests and 1 failing test assertion**: the malformed-key test expected lowercase `valid GitHub App RSA` but the implementation correctly emitted `Valid GitHub App RSA private key required`. This was an assertion-capitalization mismatch, not evidence of an authentication failure.
- Corrected only the case-sensitive assertion in `tests/github-app.test.ts`; no application or authentication logic changed. Repeated `npm run check`: **71/71 unit tests passed**, ESLint passed, and TypeScript build passed.
- `npm run test:integration`: **24/24 PostgreSQL integration tests passed** in the separate `openpayables_test` database. No rerun was needed after the test-only assertion correction.
- `git diff --cached --check` passed; the **12 intended C9 files** were staged. Git LF/CRLF warnings were informational. C9 was committed as `1fc009a` and pushed to `origin/development`; working tree verified clean; `main` stayed `28a79a4`.
- Mocked GitHub API and temporary RSA key tests support implementation acceptance. A **separate real GitHub App acceptance** was subsequently completed, documented below. No Stripe transfer or live-money movement occurred.

### C9 real GitHub App acceptance — 2026-11-18 US Pacific (2026-11-19 UTC)

- Registered the **Mightymetrika OpenPayables** GitHub App owned by `@mightymetrika`; numeric **App ID `5825297`**. The generated RSA `.pem` was moved from Downloads to a user-local secret directory outside the Git repository; no private key contents were shared or committed.
- Installed on **only the selected** public repository `mightymetrika/openpayables`, with **metadata and pull requests read-only**. GitHub reported **installation ID `183507524`**.
- Using the existing registered C7 local test project `openpayables-c7-8dcd0ee2`, `github app bind` returned `boundNow: true`, **GitHub repo ID `1460710596`**, expected App ID and installation ID. `github app show` independently returned matching persisted binding metadata.
- `github sync openpayables-c7-8dcd0ee2 mightymetrika/openpayables 2026-11-01` completed successfully via the real GitHub API, returning `authMode: github_app_installation` and `installationId: 183507524`. It reported **0 discovered candidates, 0 credit awards and 0 payment obligations**. The empty candidate scan is a valid authentication/integration result, **not** a positive real-PR discovery/approval test.
- No GitHub PR was manufactured, no funds or Stripe operations were initiated, and no LIVE payment path was enabled. The key and ephemeral installation tokens must remain private.

**C9 acceptance documentation committed:** `e8afaf3` on `development`, pushed and clean. Next active checkpoint: C10, contributor-controlled GitHub account verification, without reworking the C8 credit and allocation paths. Stripe's eligibility assessment remains separate and pending.


Local operator databases: `127.0.0.1:5432/openpayables` (development) and `127.0.0.1:5432/openpayables_test` (dedicated test). The CLI is a trusted single-operator tool; do not connect it to other apps' Production databases. Keep all secrets out of Git/chat.
