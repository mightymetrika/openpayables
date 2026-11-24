# 2026-11-24 — Actual sandbox transfer and signed platform webhook accepted (NEXT: AUTOMATIC PAYOUT TRACE)

**Accepted source and documentation:** `091f799` contains the verified indexed Accounts v2 compatibility fix (181/181 tests, 27 files, lint/build passed). Documentation-only checkpoint `0e226db` was committed and pushed on clean synchronized `development`. No schema or hosted database changes, no BlindStats changes, no LIVE transfer authorization. Development version `0.2.0-alpha.4`; published alpha.3 unchanged.

**Actual TEST execution, 14:37 Pacific:** The existing 500 USD cent `pilot_test` approval `f51fe796-ab32-46bf-8ffa-bbe286aeaeec` was executed once through the corrected guarded lifecycle on local `openpayables_test`. Payer `acct_1Ucqb8PGvHvd36JR`, recipient `acct_1Ucr1LA9lZlrd52M`, top-up `tu_1UcuKEPGvHvd36JRmBSy8HJf`. Durable attempt recorded at `2026-11-24T14:37:38.262466-08:00`, idempotency key `openpayables-pilot-f51fe796-ab32-46bf-8ffa-bbe286aeaeec`, execution reference `SANDBOX_EXECUTION_ONLY`. Observed Stripe transfer `tr_1UfSLFPGvHvd36JRCLcxdThZ` at `2026-11-24T14:37:39.301495-08:00`, zero reversed cents. Ledger state `transfer_observed`. Signed platform `transfer.created` event `evt_1UfSLGPGvHvd36JRfP4HtrV8` forwarded by actual Stripe CLI at 14:37:39; HTTP 200 at 14:37:40; OpenPayables logged `SIGNED TEST platform evt_1UfSLGPGvHvd36JRfP4HtrV8: reconciled`. This demonstrates actual transfer execution, durable observation and signed platform delivery/processing; connected payout delivery remains unverified. No real money moved.

**Latest observed payout status:** `payout_not_traced`, empty traces, `bankPayoutVerified: false`. Do not reset or execute this approval again. Leave the existing sandbox webhook server and Stripe forwarding listener running during payout acceptance. Their setup is described in the prior checkpoint below (historical, not current execution instructions). From the original session inspect `node --import tsx src/cli/sandbox-pilot.ts status`; verify the exact transfer and sandbox identity. Use GET `/v1/transfers/tr_1UfSLFPGvHvd36JRCLcxdThZ` for its destination-payment ID; list connected-account payouts and, for completed automatic standard USD bank payouts, GET `/v1/balance_transactions?payout=po_ID&limit=100` under the exact recipient account. Match the exact destination-payment source, never amount alone. If a unique exact membership is found, run `node --import tsx src/cli/sandbox-pilot.ts payout po_ID` and inspect `status`; the runner independently validates and records the trace. No manual payout, new transfer, new approval or ledger reset. If the automatic payout is not yet available, preserve this checkpoint and resume read-only inspection later. Earlier $8 payout is separate evidence, not this transfer's payout. Record actual signed connected events and exact payout evidence before closing acceptance. Stripe paid status is not independent bank receipt.

**Remaining gates:** automatic payout membership and connected signed webhook acceptance, dedicated LIVE deployment/HTTPS and credentials, operator compliance/funding and recipient identity/consent, explicit release and execution authorization, independently confirmed actual bank receipt. LIVE execution stays locked. No secrets in handoff, logs or repository. Keep all changes inside OpenPayables.

---

# 2026-11-24 — Accounts v2 compatibility accepted (NEXT: EXECUTE EXISTING SANDBOX APPROVAL)

**Accepted source checkpoint:** `091f799` on `development`, pushed and synchronized with `origin/development`, clean working tree. Shared TEST/LIVE transfer provider now uses `include%5B0%5D=configuration.recipient`. Actual Stripe sandbox GET succeeded with recipient transfers capability `active`; Windows acceptance confirmed 181/181 tests in 27 files, ESLint, TypeScript build, exact five-file staged scope and Git whitespace checks. No schema change. Development version remains `0.2.0-alpha.4`; published alpha.3, hosted databases and BlindStats unchanged.

**Preserved approval:** `f51fe796-ab32-46bf-8ffa-bbe286aeaeec`, mode `pilot_test`, 500 USD cents, dedicated local loopback `openpayables_test`. Payer `acct_1Ucqb8PGvHvd36JR`, recipient `acct_1Ucr1LA9lZlrd52M`, existing TEST top-up `tu_1UcuKEPGvHvd36JRmBSy8HJf`. The first execution stopped before durable attempt creation on the malformed Accounts v2 GET (HTTP 400, `invalid_fields`); diagnostic confirmed `approved_not_attempted`, null attempt and observation, no payout trace. Corrected GET and full Windows checks passed; the post-check confirmed the same approval remained unattempted. No transfer has been demonstrated for this approval. Do not recreate approval, reset the ledger or retry an uncertain POST.

**Operational setup:** Stripe CLI v1.55.14 installed at `$HOME\Tools\stripe` via official GitHub release; TEST authentication verified through account and balance GETs. CLI uses process-scoped `STRIPE_API_KEY` from the TEST credential, not LIVE. `stripe listen --print-secret` obtained the signing secret, stored in process-scoped `OPENPAYABLES_SANDBOX_WEBHOOK_SECRET`; do not log either secret. Forwarding requires explicit `--events` (transfer.created, transfer.updated, transfer.reversed, payout.created, payout.updated, payout.paid, payout.failed, payout.canceled, payout.reconciliation_completed). In PowerShell 5.1 use `ErrorActionPreference = "Continue"` in the native CLI stderr-merging listener block and redact signing secrets. Stripe CLI reported Ready and signing-secret match; snapshot API version `2026-10-28.endive`, direct provider API `2026-11-18.endive`. Local OpenPayables server restarted successfully on corrected source at `127.0.0.1:8789`; routes `/stripe/sandbox/platform` and `/stripe/sandbox/connected`. Actual signed event processing still unverified. Keep forwarding and server running and recheck readiness before executing.

**Next action:** From original OpenPayables PowerShell session, verify source checkpoint (or documentation-only descendant), clean tree, local TEST database, TEST credential, listener readiness and exact frozen approval with null attempt. Run `node --import tsx src/cli/sandbox-pilot.ts execute f51fe796-ab32-46bf-8ffa-bbe286aeaeec YES_EXECUTE_ONE_TEST_TRANSFER` once. On any failure, inspect `status` first; do not resend if attempt exists or outcome is uncertain. Record actual transfer ID, signed event IDs/HTTP delivery and ledger observations. Reconcile exact automatic payout via connected signed events or `payout po_ID`; distinguish provider-reported paid status from independent bank receipt. Earlier $8 TEST payout established API compatibility, not this new $5 payment's lifecycle. LIVE execution remains locked; no real money movement, LIVE deployment, funding or recipient authorization yet. Keep all work in OpenPayables and update this handoff with observed outcomes before closing the milestone.

---

# 2026-11-24 — Operational sandbox pilot runner (WINDOWS ACCEPTED; COMMITTED 8f07d36)

**Accepted baseline:** `5579736` on clean synchronized `development`, 176/176 tests in 26 files; lint/build and exact staged scope passed. Actual Stripe sandbox automatic $8 transfer-to-payout membership verified; combined `payout` + `source` API filter incompatibility corrected. Published alpha.3 and BlindStats unchanged.

**Candidate:** Add explicit TEST-only provider entry points sharing the pilot HTTP evidence parsers and durable approval/attempt/payout ledgers; the known sandbox payer capability exception is accepted only in `pilot_test`. Sandbox runner requires local loopback `openpayables_test`, a TEST credential, explicit payer/recipient/receipt IDs, one synthetic contributor and fixed 500-cent approval. Separate exact UUID/confirmation required for one simulated transfer; read-only reconciliation only after an attempt. The loopback sandbox webhook listener uses the shared signature parser and reconciliation routing with a TEST-only mode check. LIVE key, account, eligibility and database requirements remain; LIVE execution CLI stays locked. No schema change or hosted deployment. Five new unit tests expected (181/181 in 27 files after Windows acceptance). See `docs/FIRST_PAYOUT_SANDBOX_ACCEPTANCE.md`.

**Next:** validate patch; prepare the frozen sandbox approval with existing $5 succeeded receipt; verify Stripe CLI sandbox listener and signing secret; execute once and inspect actual signed delivery, transfer and subsequent automatic payout trace. Do not retry an uncertain transfer, manufacture evidence or weaken LIVE guards. No real money moved. No code work in BlindStats.

---

# 2026-11-24 — Sandbox payout API compatibility correction (WINDOWS ACCEPTED; COMMITTED 5579736)

**Accepted baseline:** `68e67e1`, clean synchronized `development`; 175/175 tests in 26 files, lint/build and staged-scope checks passed. Version `0.2.0-alpha.4` remains unpublished; alpha.3 release unchanged.

**Actual sandbox evidence:** The exact OpenPayables Development TEST payer and prior 800-cent unreversed transfer were verified. Its recipient had a standard automatic USD bank payout marked paid with completed reconciliation. Stripe rejected the combined `payout` + `source` filter with HTTP 400. A payout-only balance-transaction query returned the negative payout debit and exactly one 800-cent destination-payment transaction (zero fee, available), no additional pages. Exact membership was established by ID, not amount. This is genuine sandbox API evidence, not a real bank payment or full acceptance of the new provider/ledger path.

**Candidate:** Correct `live-payout.ts` to query by payout only and filter exact source locally; test mixed transactions, same-amount unrelated sources, malformed matching rows, duplicate matches and incomplete pages. Retain strict LIVE credential/mode/account checks and the one-page fail-closed pilot limit. No schema change, no transfer execution unlock, no hosted migration or LIVE request. Expected 176 tests in 26 files. Next: accept and commit this focused fix, then run remaining end-to-end sandbox execution and signed webhook acceptance. Do not repeat the already verified manual GET inspection unnecessarily. Keep BlindStats out of scope.

**Windows acceptance:** 176/176 tests in 26 files, lint/build, 4-file scope and whitespace checks passed. Committed/pushed `5579736`; clean synchronized development.

---

# 2026-11-24 — First-payout signed webhook and payout trace (WINDOWS ACCEPTED; COMMITTED 68e67e1)

**Accepted baseline:** `06e4672` on clean synchronized `development`, 167/167 tests in 25 files, lint/build and staged-scope/whitespace checks passed. Version `0.2.0-alpha.4`; published alpha.3 TEST-only preview and BlindStats remain unchanged. Mightymetrika Connect approval and Payments-balance funding option established; actual top-up, recipient and payment not demonstrated.

**Candidate:** Migration 014 records immutable standard automatic bank-payout evidence, using the frozen payer/recipient, transfer destination payment and exact Stripe balance-transaction membership. Provider GET-only reads distinguish gross transfer, recipient net and aggregate payout total. Paid is provider-reported status, not independent proof of bank receipt. Failures and reversals are sticky; a second matched payout requires incident review. Separate signed LIVE platform/connected snapshot webhook endpoints route to authoritative GET-only reconciliation; bounded raw body, separate secrets, timestamp checks, exact account scope and idempotent append-only observations. Dedicated loopback listener; HTTPS ingress, permission configuration and actual webhook delivery are operational acceptance tasks. No LIVE CLI unlock, no hosted database migration, no Stripe requests or actual money movement. See `docs/FIRST_PAYOUT_PAYOUT_RECONCILIATION.md`.

**Windows acceptance:** 175/175 tests in 26 files, lint/build, exact 19-file scope and whitespace checks passed. Committed and pushed `68e67e1` on `development`, synchronized and clean. No real payments. Operational sandbox inspection subsequently identified the combined-filter incompatibility; see latest entry. Remaining requirements include signed event delivery/retries, full sandbox execution, and dedicated LIVE DB/login/HTTPS deployment. Confirm business/legal/tax approvals and recipient identity/consent; independently confirm bank receipt before closing the real pilot. Keep real transfer gate locked until the acceptance/release review. No extra dashboards or BlindStats changes.

---

# 2026-11-24 — First-payout transfer and reconciliation (WINDOWS ACCEPTED; COMMITTED 06e4672)

**Accepted baseline:** `fc646ef` on `development`, clean and synchronized. Package development version `0.2.0-alpha.4`; published `v0.2.0-alpha.3` remains unchanged. 157/157 tests (23 files), ESLint, TypeScript build, exact staged scope and whitespace passed on Windows. Mightymetrika LIVE Connect onboarding and Payments-balance top-up option established; actual funding and real recipient not yet verified. No LIVE money movement.

**Candidate:** Migration 013 adds a single immutable attempt per pilot approval, deterministic Stripe idempotency key, separately attested execution reference, and append-only transfer/reversal observations. The trusted internal execution path rechecks the frozen payer, recipient, USD amount, receipt and balance; requires current v2 recipient transfer capability and a fresh one-use preflight. It inserts and commits the attempt before the one POST. An ambiguous outcome, response mismatch or persistence failure never authorizes a resend. Read-only reconciliation requires exact transfer ID, payer, metadata, transfer group, amount/currency/destination and LIVE mode. Recorded reversals are not erased by stale observations. Provider-mode and DB guards separate synthetic TEST from LIVE. The CLI's LIVE execution release gate is hard-disabled; do not configure write keys or bypass the gate. See `docs/FIRST_PAYOUT_TRANSFER.md`.

**Windows acceptance:** 167/167 tests in 25 files, ESLint, TypeScript build, exact 15-file staged scope and Git whitespace checks passed. Committed and pushed `06e4672` on `development`, synchronized and clean. No real payment or hosted migration. See newest entry for next actions.

---

# 2026-11-24 — First-payout isolated funding and approval (WINDOWS ACCEPTED; COMMITTED fc646ef)

**Accepted baseline:** `18ddcff` on `development`, synchronized with origin and clean at the 2026-11-23 close. `0.2.0-alpha.4` development version; published prerelease remains `v0.2.0-alpha.3`. User-verified `npm run check`: **151/151 tests in 22 files**, ESLint and TypeScript build passed, staged scope and Git whitespace checks passed. The nine-file readiness patch was committed and pushed. No LIVE Stripe request or money movement was performed. Mightymetrika's Connect onboarding and Payments balance funding option were established in the Dashboard; actual funding remains unverified.

**Current candidate:** Add migration 012 and an isolated, append-only first-payout approval ledger with a separate CLI; use provider-read funding evidence, immutable receipt/recipient/amount/credit snapshot, authenticated dedicated DB login, one approval per payer and a conservative 2,500-cent cap. Exactly one positive-credit contributor is required; do not manufacture or suppress credits. Existing TEST tables and transfer code are unchanged. No LIVE DB provision, key creation, contributor account creation, top-up, transfer, or webhook work has been performed. See `docs/FIRST_PAYOUT_APPROVAL.md`.

**Windows acceptance:** User verified 157/157 tests in 23 files, ESLint, TypeScript build, exact 14-file staged scope and whitespace checks. Committed and pushed `fc646ef` on `development`; local HEAD equals origin/development and working tree clean. No LIVE money moved. This checkpoint is closed; see the newest entry for next steps.

---

# 2026-11-23 — First-payout LIVE readiness checkpoint (WINDOWS ACCEPTED; COMMITTED 18ddcff)

This checkpoint starts from the user-verified clean `development` commit `0e4b150` and published, **unchanged** `v0.2.0-alpha.3` GitHub prerelease. Mightymetrika LLC's LIVE Stripe account is active, Connect platform onboarding and identity verification have been completed, an email says it can create LIVE connected accounts and charges, and the Dashboard shows the Payments balance top-up option; **this is not proof that a real payout is authorized or funded**. We have not moved LIVE money or created a LIVE contributor. BlindStats has implemented the hosted READ-ONLY OpenPayables alpha.3 integration and is out of scope here.

**Candidate scope:** Add `StripeLiveReadiness`, a strictly GET-only Stripe LIVE inspector; a separate `openpayables-live-readiness` CLI and `npm run live:readiness`; a short operator procedure; unit tests for wrong key/platform, LIVE response, recipient and top-up evidence, and GET-only behavior. The candidate version is `0.2.0-alpha.4` **validated and committed; not published**. The TEST finance engine remains unchanged and rejects LIVE keys. No SQL migration, Stripe write endpoint, LIVE funding ledger, transfer, payment reconciliation, new connected account, or bank payout is introduced. This is a narrow prerequisite, **not** the First-Payout Pilot complete. See `docs/FIRST_PAYOUT_LIVE_READINESS.md`.

**Historical acceptance:** Windows validated all 151 tests, ESLint, build and staged scope, then committed/pushed `18ddcff`. No further acceptance of this previous patch is required. See the newest checkpoint above for the next action.

---

# OpenPayables — Project Handoff

## Optional Supabase PostgreSQL hosting (HOSTED TEST ACCEPTED 2026-11-22; NEXT: DEVELOPMENT GIT CHECKPOINT)

**Source:** Published `v0.2.0-alpha.2` / clean development baseline `6c8f864`. At the 2026-11-22 hosted acceptance checkpoint, the additive `0.2.0-alpha.3` candidate was applied locally but **not yet committed/pushed, tagged, or released**. Subsequent Git status must be checked from Git itself. Keep public alpha.2, `main`, BlindStats code/Supabase, and Stripe LIVE untouched. The owner controls this dedicated database; unrelated adopting operators must deploy their own PostgreSQL and Stripe accounts.

**Implemented scope:** Generic PostgreSQL package and unchanged 11 migration files; unchanged `openpayables/read`; optional `OPENPAYABLES_POOL_MAX` (1–20, default 5, serverless 1), four connection-config unit tests, corrected application-read integration-test skip guard, TLS/role deployment guide, `sql/deployment/supabase_roles.sql` and `scripts/supabase-hosted-smoke.mjs`. No new Supabase Auth, central API, financial business logic, Stripe calls or hosted multi-tenant layer.

**Windows LOCAL acceptance (user-verified):** `npm run check` with the dedicated local test database passed **139/139 tests in 21 files** (unit plus real PostgreSQL), ESLint and TypeScript build. `git diff --check` returned exit 0; CRLF notices are informational. Baseline remained `6c8f864` on `development` and candidate files were not committed.

**Supabase HOSTED acceptance (user-verified 2026-11-22):** User created dedicated `openpayables-mightymetrika-dev` Supabase development project (ref `aadqozgamybbksrvoivu`), separate from BlindStats. TLS `verify-full` session-pooler `psql` and Node preflight passed against hosted `postgres` database. Existing OpenPayables migrator successfully applied all **11** migrations (versions `001_checkpoint_a` to `011_checkpoint_c13`), confirmed through migration ledger. `sql/deployment/supabase_roles.sql` successfully committed; distinct passwords entered privately. `openpayables_operator` and `openpayables_app_ro` both authenticated through the pooler with SSL and passed operator-write/reader-only permissions; admin credentials are not used by the app.

**HOSTED synthetic TEST smoke ACCEPTED:** `node scripts/supabase-hosted-smoke.mjs` printed `SUPABASE HOSTED TEST ACCEPTANCE PASS (synthetic project=supabase-smoke-4496fd4f)` and the final acceptance marker. Operator used session pooler port 5432; reader used **transaction pooler port 6543**, confirming serverless-mode compatibility for this test. The synthetic test created two contributors (Alice 8, Bob 3 credits), a governance vote and $8/$3 **held** TEST allocations, then read them through the released reader. Project isolation/unknown-contributor rejection tested. Immutable synthetic TEST records remain in the hosted project; **do not rerun smoke gratuitously**. No Stripe API call, payout, LIVE payment, or BlindStats source/database change.

**CLOSEOUT path recorded at hosted acceptance:** (1) Apply the documentation-only hosted acceptance closeout, stage **exactly ten** intended OpenPayables paths, verify staged paths/whitespace, then commit and push `development` only; confirm clean synchronized branch. (2) Check `npm pack` output and installable package behavior before a separately approved `v0.2.0-alpha.3` GitHub TEST prerelease. (3) Hand BlindStats chat the pinned release, **reader-only** transaction-pooler/TLS configuration, `OPENPAYABLES_POOL_MAX=1`, and synthetic project/contributor mapping. BlindStats alone may change its env/Preview; retain `VERCEL_ENV=production` denial until explicitly reviewed. No `main`, Vercel Production, unrelated operators, or LIVE Stripe activation.

## Read-only host application integration (WINDOWS ACCEPTED — GIT COMMIT PENDING)

**Baseline:** Published GitHub prerelease `v0.2.0-alpha.1` points to `development` commit `95da1eb`, with `main` unchanged at `28a79a4`. This accepted **local** candidate targets package version `0.2.0-alpha.2` and adds the `openpayables/read` server-side package export, three PostgreSQL tests, an independent installed-package smoke check, and an application integration contract. No migrations, payment logic, Stripe/GitHub App behavior, web service, or BlindStats files were changed.

**Windows acceptance (2026-11-20, Pacific):** With `OPENPAYABLES_TEST_DATABASE_URL` set, `npm run check` passed **135/135 tests** (92 unit plus 43 PostgreSQL integration), ESLint and TypeScript build. The separately invoked `npm run test:integration` passed **43/43 PostgreSQL tests**, which are included in the combined 135 and must not be double-counted. `scripts/technical-preview-smoke.ps1` built and installed the package in an independent directory and printed `Installed read-only app integration PASS` and `Technical preview package smoke PASS`, including synthetic 8:3 governance and a 2,000-cent TEST revenue-pool basis with 1,455/545-cent allocation. `git diff --check` passed; LF-to-CRLF warnings were informational. No external GitHub, Stripe, bank-payout, LIVE-money, or BlindStats operations occurred. The working directory contains precisely the seven intended modified/new application-integration files, pending staging and commit; no git push was performed as of this report.

**Security and scope:** A host application must authenticate the user, explicitly authorize their OpenPayables project, and resolve any contributor identity server-side. BlindStats Study membership and Supabase capabilities are **not** OpenPayables compensation permissions. The reader exposes project overview and pending GitHub queue to authorized managers and credits/voting/TEST distributions only to mapped contributors. It performs SELECT-only reads and cannot approve, vote, move funds, call GitHub/Stripe, or access LIVE credentials. Keep PostgreSQL credentials server-only and isolate each operator's database and Stripe account.

**Next limited actions:** Stage and commit exactly seven OpenPayables files on `development`; push only after staged-file validation. Then prepare a separately versioned `v0.2.0-alpha.2` TEST-only GitHub prerelease. The existing public `v0.2.0-alpha.1` and `main` must remain unchanged. **BlindStats integration belongs exclusively to its separate development chat**: provide the integration contract and fresh BlindStats `development` source when its active multivariable work is ready; no BlindStats file modifications in this chat. Continue Stripe eligibility in parallel, but do not add payment or accounting work merely for another checkpoint.

## Self-hosted technical preview packaging (WINDOWS ACCEPTED)

**Source baseline:** `development` at `bfe29e4` (C13 accepted/pushed; `main` unchanged at `28a79a4`). This packaging increment adds `openpayables` and `openpayables-migrate` npm tarball binaries, allowlisted compiled JS/SQL packaging, documentation, and a PowerShell smoke test that installs into an independent temporary consumer directory using **only** the dedicated `openpayables_test` database. The smoke creates synthetic contribution, vote and TEST-funding records; it does not create GitHub PRs, contact Stripe, pay anyone, or enable LIVE keys.

**Windows acceptance, 2026-11-19 (US Pacific):** `npm run check` passed **92/92 unit tests**, ESLint and TypeScript build; `npm run test:integration` passed **40/40 PostgreSQL tests** (132/132 combined). The independent installed-tarball smoke test passed: the compiled CLI and migrator ran outside the source checkout, applied migrations to the test database, verified an 8:3 voting flow, and checked a 2,000-cent operator-attested revenue-pool allocation of **1,455/545 cents**. `git diff --check` passed; LF-to-CRLF warnings were informational. No external GitHub, Stripe, bank-payout or LIVE operations occurred. The technical preview is **validated for local packaging**, not yet published as a GitHub prerelease or npm package.

**Release boundary:** This packaging increment is accepted for commit on `development`; check Git history for its eventual commit ID. A separate deliberate GitHub prerelease can attach the versioned tarball with clear TEST-only limitations. Do not merge `main` or publish to npm by default. See `docs/TECHNICAL_PREVIEW_RELEASE.md`. The smoke is not an external real merged-PR end-to-end test or proof of LIVE payment eligibility.

**Fixed release path:** (1) ship self-hosted TEST technical preview; (2) observe genuine operator usability friction and adopt minimal interfaces if warranted; (3) pursue separately approved Stripe LIVE pilot with operator-owned money and clear legal/tax obligations. No more accounting checkpoints without evidence of a correctness blocker.

## Checkpoint C13 — operator revenue-pool basis (WINDOWS VALIDATED)

**Scope:** One immutable, operator-attested revenue-pool calculation feeding the existing draft/approval workflow. `distribution create-revenue` records gross receipts, fees, costs, reserves, the contributor share in basis points, a policy reference and a receipt-ledger reference. Integer-cent arithmetic uses floor rounding. `distribution show` exposes the basis. Existing prefunded `distribution create`, verified/attested TEST funding separation, approval locks, Stripe guards, and governance remain unchanged. No revenue import, real-money payments, web UI, or GitHub changes. See `docs/REVENUE_POOL_BASIS_v0.1.md`.

**Windows acceptance, 2026-11-19 (US Pacific):** `npm run db:migrate` succeeded against the dedicated OpenPayables development database. `npm run check` passed **92/92 unit tests**, ESLint, and TypeScript build. `npm run test:integration` passed **40/40 dedicated PostgreSQL tests** (132/132 combined). `git diff --check` passed. The two new C13 PostgreSQL tests exercise a fresh isolated project, draft creation and readback, insufficient-funding rejection, TEST-attested funding and approval, immutable basis, duplicate-label rejection, and project isolation. No real Stripe transfer, live payment, bank payout, or manual positive GitHub PR approval was performed. A separate real-project CLI smoke test for `create-revenue` was not performed; the command path and finance behavior were covered by the automated checks.

**Git baseline:** C13 patch applied to `development` at `e7dcd7f208402e8d3ef8c984dc060d082f11bf29` (GitHub v0.1 documentation closeout). Earlier C12 implementation was committed as `5a94518`; `main` remains intentionally unchanged at `28a79a4`. Refer to Git history for the final C13 commit ID. The C7–C12 GitHub integration milestone remains closed, with positive real merged-PR acceptance still outstanding.

**Current focus toward MVP release:** Treat C13's revenue basis as sufficient for the current TEST-mode release; no speculative C14 accounting subsystem. Return to Stripe operator-owned eligibility and the practical installation/management experience for independent operators and contributors. Prioritize the minimum usable operator/contributor interface or API integration surface, deployment instructions, and a release acceptance pass. Keep LIVE payments disabled until separately authorized and compliant. Do not change BlindStats or RandomPlayables, and do not make OpenPayables a pooled payment intermediary. A real merged-PR acceptance test may be done when legitimate evidence is available, but must not block unrelated MVP progress or be manufactured merely for test coverage.

## Historical checkpoints

## Checkpoint C12 — contributor enrollment, review queue and read-only dollar preview (WINDOWS ACCEPTED; COMMITTED `5a94518`)

- `github enroll PROJECT GITHUB_USER_ID CONTRIBUTOR_ID DISPLAY_NAME`: a trusted operator creates or reuses an existing contributor, joins the project and links an immutable GitHub numeric ID **in one PostgreSQL transaction**. Requires existing discovered evidence for that project/user. Identical repeats succeed without duplicate records; conflicting display names or identity reassignments roll back all writes. This is **operator attestation**, NOT authenticated GitHub account ownership.
- `github review pending PROJECT [OFFSET]`: read-only, project-scoped, paginated (50 items/page) queue of **unapproved** PR-author/reviewer candidates, including source URL, stable GitHub user ID, contributor link and C10 verification status. Approved candidates disappear from the pending queue; original evidence and approval audit records are retained.
- `distribution preview PROJECT USD_CENTS`: read-only hypothetical allocation of a specified cents amount using existing lifetime credits and the validated largest-remainder method. Returns integer-cent conservation and readable USD amounts; **does not** assert verified funds, reserve money, consume credits, create obligations, or initiate Stripe activity. An approved distribution uses its own locked snapshot, which may differ from the preview if credits change.
- Existing `github identity verify` and `github approve` remain the actual user-control and human-approval steps. **Current C8 approval accepts operator-attested links without requiring C10 verification**; the queue makes this distinction visible, but C12 does not silently change the accepted approval policy.
- No new migration, GitHub API permissions, GitHub App change, Stripe calls, web UI, or live payment path. Eight complete changed files include focused unit/integration tests and `docs/CONTRIBUTOR_REVIEW_WORKFLOW_v0.1.md`.

### C12 acceptance evidence — 2026-11-19 (US Pacific)

- **Windows database:** `npm run db:migrate` succeeded against the dedicated local `openpayables` development database; C12 required no new migration.
- **Unit checks:** `npm run check` passed **88/88 unit tests**, ESLint, and the TypeScript build. The 38 database tests skipped by this command were run separately.
- **PostgreSQL integration:** `npm run test:integration` passed **38/38 tests** in the dedicated `openpayables_test` database. Total: **126 passing tests** across both suites. These include positive synthetic-evidence enrollment, immutable identity-link/conflict protection, queue filtering, project isolation, and read-only dollar-preview behavior.
- **Git validation:** `git diff --check` and `git diff --cached --check` passed; exactly **eight C12 files** were staged. LF-to-CRLF messages are informational on this Windows Git configuration.
- **Real local-project check:** `github review pending openpayables-c11-0ecc34cd` returned `pending: []`, `hasMore: false`, `nextOffset: null`, exit code 0. This validates the real empty-queue read, **not** a positive real-world merged-PR candidate or approval. No fake pull request was created.
- **Financial boundary:** The real review check did not enroll or verify a contributor, award credits, attest funds, create obligations, call Stripe, or enable live payments. The hypothetical 8:3 credits → $8/$3 preview is covered by test fixtures, not a funded real-project distribution.

**C12 Git checkpoint:** All eight accepted C12 files committed as `5a94518` (`feat: simplify contributor enrollment and review workflow`) and pushed to `origin/development`. Local/remote matched; working tree clean. `main` remains at `28a79a4`. **GitHub v0.1 closeout:** See `docs/GITHUB_INTEGRATION_CLOSEOUT_v0.1.md` for the complete acceptance boundary, real-evidence follow-up, and next-chat workflow. No further infrastructure build is needed solely to close C12. Stripe eligibility review remains separate; LIVE payments remain disabled.

## Checkpoint C11 — simpler project operator onboarding (WINDOWS + REAL GITHUB ACCEPTED; COMMITTED `239962f`)

- New CLI commands `project setup PROJECT_ID NAME owner/repo` and `project setup-status PROJECT_ID` connect existing C7–C10 functions in a practical local operator workflow.
- **Before DB writes**, verify that the requested public repository exists and that the configured GitHub App has the correct scoped installation and pull-request read access. No public fallback after binding.
- **One PostgreSQL transaction** creates the project, four default contribution categories, immutable GitHub source registration and immutable per-project App installation binding; a failure rolls all steps back. Identical repeated setup is idempotent, but conflicts or attempts to adopt a different/partial project fail closed.
- Read-only status displays project GitHub-source/binding metadata and counts for project contributors, candidates, candidate approvals, linked identities and verified identities; it reports **local persisted configuration only**, not currently verified GitHub access or financial readiness.
- New `src/operator/setup.ts`, unit + PostgreSQL integration tests, and `docs/OPERATOR_SETUP_v0.1.md`. No SQL migration or changes to credits, votes, Stripe transfers, LIVE payments or other project databases.
### C11 acceptance evidence — 2026-11-19 (US Pacific)

- **Windows validation:** `npm run db:migrate` succeeded on the dedicated OpenPayables development database; `npm run check` passed **84/84 unit tests**, ESLint, and TypeScript build; `npm run test:integration` passed **33/33 PostgreSQL integration tests** in the separate `openpayables_test` database. Total: **117 passing tests** across the two suites.
- **Git validation:** `git diff --check` and `git diff --cached --check` succeeded, and the **eight intended C11 files** were staged. LF-to-CRLF messages were informational.
- **Real new-project setup:** `project setup openpayables-c11-0ecc34cd "C11 operator setup acceptance" mightymetrika/openpayables` created an isolated local project (`createdNow: true`) with **GitHub repository ID `1460710596`**, App ID `5825297`, and installation ID `183507524`.
- **Idempotency:** Repeating the identical setup returned `createdNow: false` with the same IDs. `project setup-status` confirmed the registered repository/installation and reported **zero contributors, candidates, approvals, linked identities and verified identities**.
- **Real GitHub synchronization:** `github sync` for the new project, since `2026-11-01`, returned `authMode: github_app_installation`, expected installation ID, and **zero discovered/new candidates, zero awarded credits, and zero created payment obligations**. This validates authenticated empty-case discovery, not a positive real-world PR import.
- **Boundaries:** No dummy PR, simulated funding entry, Stripe API call, transfer, bank payout or LIVE payment was needed for C11 acceptance. Existing C7/C9 projects were left alone. The CLI remains a trusted local operator workflow, **not** a hosted multi-tenant onboarding service.

**C11 Git checkpoint:** The eight accepted C11 files were committed as `239962f` (`feat: simplify GitHub App operator project setup`) and pushed to `origin/development`; branch and remote matched, the working tree was clean, and `main` remained at `28a79a4`. C12 builds on this baseline.

## Checkpoint C10 — contributor-controlled GitHub identity verification (WINDOWS + REAL DEVICE AUTH ACCEPTED; COMMITTED `b481ed4`)

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

**C10 Git checkpoint:** All 14 C10 files were committed as `b481ed4` (`feat: verify contributor GitHub identity through Device Flow`) and pushed to `origin/development`. Local/remote matched, working tree clean and `main` stayed `28a79a4`. The next active slice is C11 operator setup.

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
