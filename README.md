# OpenPayables

A reusable TypeScript/PostgreSQL package for verified open-source contribution credits, contributor voting, and deterministic revenue-sharing **with actual monetary payment capability as the project goal**.

**Status:** GitHub integration C7–C12 is locally validated on `development` at **`5a94518`** (C12 committed and pushed). C12 passed 88 unit tests, 38 PostgreSQL integration tests, ESLint, TypeScript build and a real-project empty-queue lookup on 2026-11-19. C9 installation authentication and C10 Device Flow were separately verified against GitHub. The first Stripe Connect TEST transfer was independently verified on 2026-11-17. No live payments are enabled; BlindStats and RandomPlayables remain unchanged.

## C11 operator quick start — Windows and real GitHub accepted; committed `239962f`

The new local `project setup <project-id> <name> <owner/repo>` command checks a public repository and its installed GitHub App **before writing**. It atomically creates the project, four default contribution categories, source registration and installation binding. `project setup-status <project-id>` summarizes local connection and contribution counts. Re-running matching setup is safe; conflicting records fail closed. Neither command moves money or assigns credits. See `docs/OPERATOR_SETUP_v0.1.md` for requirements and the follow-on discovery/approval commands. This is still a trusted single-operator CLI, not a hosted onboarding service. **C11 acceptance (2026-11-19):** 84/84 unit tests, 33/33 PostgreSQL integration tests, lint and TypeScript build passed. A new local project `openpayables-c11-0ecc34cd` was created against the real `mightymetrika/openpayables` installation; repeated identical setup returned `createdNow: false`. Authenticated GitHub sync succeeded (`authMode: github_app_installation`) with zero candidates, credit awards or payment obligations. This does not demonstrate positive real-world PR discovery.

## Operator-owned Stripe model (C4 — validated and committed)

**OpenPayables is software, not a shared payments intermediary.** Each independent paying business/project operator uses its **own Stripe account and own funds** for its contributors. Mightymetrika's Stripe account is for Mightymetrika's own projects/testing, not for paying other operators' contributors. Recipient onboarding occurs under that operator's Stripe Connect configuration; OpenPayables itself is intended as free, reusable open-source infrastructure; any subscription income belongs to separately monetized adopting projects, and operators remain responsible for their own funds.

C4 records an immutable, TEST-mode project-to-Stripe account binding (Stripe `acct_...` ID only) and prevents preparation, sending or reconciliation with another account's credentials. Imported verified-test funding automatically binds its authenticated account; attested-only projects require `stripe platform bind <project-id>`. Existing unbound attested projects with historical attempts require manual review, not silent rebinding. **This is still a dedicated local single-operator CLI.** It has no tenant authentication, secure hosted Stripe OAuth/restricted-key workflow or multi-tenant webhook routing; do not run it for unrelated clients from one shared service.

See `docs/OPERATOR_STRIPE_OWNERSHIP_v0.1.md` and `docs/LIVE_PAYMENT_READINESS_v0.1.md` for deployment, approval and real-money requirements. **C4 acceptance (2026-11-17):** migration passed, **9/9 PostgreSQL integration tests**, **29/29 unit tests**, lint and TypeScript build passed; existing verified-funding project backfill showed its expected Stripe TEST account ID. A fake-provider test verified that wrong-platform credentials are rejected before a transfer attempt. C4 was committed and pushed as `15cb19c`; no live payment capability was added.

## Checkpoint C5 — Stripe TEST bank payout observation (locally accepted)

C5 introduces `payout sync <project-id> <contributor-id>` and `payout show <project-id> <contributor-id>`. The sync makes **GET-only** calls to Stripe's TEST payout list, scoped via `Stripe-Account` to that project's configured contributor destination. Snapshots and immutable observation events record payout status changes, including later `failed` reports. A project/account mismatch, LIVE-mode response, malformed evidence or unsafe status regression stops synchronization.

**These are connected-account-level records.** A Stripe bank payout may combine several transfers or other funds. Even if Stripe reports an account's payout as `paid`, OpenPayables **does not mark any individual payment obligation bank-settled**. No payout creation, new top-up, transfer or LIVE key is involved. See `docs/BANK_PAYOUT_OBSERVATION_v0.1.md`.

**C5 acceptance (2026-11-17):** development migration passed; **10/10 PostgreSQL integration tests**, **40/40 unit tests**, ESLint, TypeScript build, and staged whitespace check passed. Using a separate local project `openpayables-c5-observation-879152d9`, two successful read-only Stripe sandbox payout syncs for the already-onboarded synthetic Alice account each returned **zero payouts and zero bank-settled obligations**; the local audit remained empty and no duplicate observations were created. C5 is committed at `3699855`. Stripe has acknowledged the operator-owned eligibility inquiry by email; approval is **not** received.

## Checkpoint C6 — automatic bank-payout composition (VALIDATED; TEST ONLY)

C6 adds `payout trace <obligation-uuid> <stripe-po-id>`. It verifies the stored **transferred** obligation, the bound Stripe TEST platform, and the provider's transfer destination payment (`py_...`). It then queries a **specified** connected-account payout. For **completed, standard automatic payouts**, Stripe's payout-scoped Balance Transactions API can confirm that this destination payment appears among the payout's components. The command reports `included_in_automatic_payout`, `not_in_this_payout`, `reconciliation_pending`, or `not_attributable_manual_or_unsupported`, with explicit evidence and payout status.

**No money moves, and no obligations are marked bank-settled.** A `paid` payout may later fail; a manual or instant payout may not expose component attribution. A zero-payout sandbox history means there is no existing `po_...` to trace, so **do not create a new payout merely to run this check**. The method is GET-only and refuses incomplete/malformed provider data. See `docs/AUTOMATIC_PAYOUT_TRACE_v0.1.md`.

**C6 acceptance (2026-11-17):** 51 unit tests, 11 dedicated PostgreSQL integration tests, ESLint, TypeScript build, and staged whitespace validation all passed. The existing synthetic Stripe TEST recipient has no known `po_...` bank payouts, so the new trace command was tested with mocks; no provider payout was created, no obligation was marked bank-settled, and no LIVE path was enabled.

**C7 (Windows accepted, committed `836dc82`): GitHub contribution discovery.** OpenPayables already manually approves credits and converts credit balances into dollar obligations using a separately approved project pool. C7 adds **read-only public GitHub source registration**, merged-PR author/reviewer candidate collection and a **local, immutable review queue**. C7 does not approve or score candidates, link identities, or initiate money movement. See `docs/GITHUB_DISCOVERY_v0.1.md` and `docs/GITHUB_EVIDENCE_MVP_PLAN_v0.1.md`.

## Checkpoint C8 — GitHub evidence to approved credits (WINDOWS ACCEPTED; COMMITTED `cf57959`)

C8 adds `github identity link <project-id> <github-user-id> <contributor-id>` and `github approve <project-id> <github-repo-id> <candidate-key> <small|medium|large> <reason>`. An operator must first create and join the named OpenPayables contributor to the project, then link the candidate's stable numeric GitHub user ID. The `github candidates` view displays the link and approval state.

Approval uses the existing `development` (PR author) or `review` (PR reviewer) categories and the existing 1/3/8 rubric. It inserts the immutable credit event and candidate approval atomically; repeat approvals return the same award, while conflicting edits or reassignments are rejected. Other GitHub review counts do not automatically multiply compensation. A reversal remains a separate credit event. A distribution still requires independent operator-attested or provider-verified TEST funding and explicit period approval.

**C8 does not verify that a contributor controls the named GitHub account.** Identity links are trusted-operator attestations only; future hosted onboarding needs contributor authentication/consent and separate legal/payout identity checks. No Stripe code or live payment capability is changed. **Windows acceptance (2026-11-18):** 64 unit tests, 20 dedicated PostgreSQL integration tests, ESLint, TypeScript build, migration, and staged whitespace check all passed. Positive evidence-to-dollar behavior was tested with synthetic candidate evidence; the real GitHub API scan returned no merged PR candidates, so no actual GitHub award was issued. See `docs/GITHUB_APPROVAL_v0.1.md` for exact commands, limits and tests.

## Checkpoint C9 — GitHub App access (WINDOWS + REAL GITHUB ACCEPTED; COMMITTED)

C9 adds an optional, reusable GitHub App installation path. A trusted operator runs `github app bind PROJECT_ID owner/repo` after the repository has been registered and the GitHub App has been installed on that public repository. This verifies the App's installation and creates a read-only **single-repository** installation token, retaining only project-specific App/installation IDs in PostgreSQL. `github app show` displays metadata. Later `github sync` commands with a binding must re-authenticate; revoked or changed installations fail closed rather than falling back to public access.

C9 does not yet automate GitHub App creation/installation, import private repositories, prove contributor ownership of a GitHub identity, or implement hosted onboarding. GitHub App keys are held by the deployment operator and read from a file outside the repository. A hosted service could share one GitHub App across independent projects without sharing Stripe accounts. See `docs/GITHUB_APP_INSTALLATION_v0.1.md` for precise setup, commands, limits and tests.

**C9 Windows acceptance (2026-11-18):** The development migration passed; 71/71 unit tests passed after a one-line test assertion capitalization fix (no production-code change); 24/24 PostgreSQL integration tests, ESLint, and TypeScript build passed. C9 was committed and pushed at `1fc009a`.

**C9 real GitHub acceptance (2026-11-18 Pacific):** GitHub App `Mightymetrika OpenPayables` (App ID `5825297`) was installed only on `mightymetrika/openpayables` (installation ID `183507524`), granting read-only metadata and pull-request access. Using project `openpayables-c7-8dcd0ee2`, `github app bind` persisted the expected repository/App/installation IDs and `github app show` confirmed them. A real `github sync` returned `authMode: github_app_installation`, no API error, **0 discovered candidates**, **0 awarded credits**, and **0 payment obligations**. This validates real App authentication and empty discovery, not ingestion of an actual merged PR. The RSA private key remains outside Git; no Stripe or LIVE payments were made.

## Checkpoint C10 — GitHub user identity verification (VALIDATED; COMMITTED `b481ed4`)

C10 adds `github identity whoami`, `github identity verify PROJECT CONTRIBUTOR`, and `github identity show PROJECT CONTRIBUTOR` to the trusted local operator CLI. The device flow lets the **contributor** authorize the GitHub App in their browser; the authenticated numeric GitHub ID must match the existing C8 project identity link before an immutable verification is recorded. Tokens and refresh tokens are never stored. This is evidence of GitHub account control **at verification time**, not legal identity, payment eligibility, or authorization for live funds. See `docs/GITHUB_IDENTITY_VERIFICATION_v0.1.md` for setup, limitations, and Windows commands. **C10 acceptance (2026-11-19):** All 80 unit and 28 PostgreSQL integration tests passed, along with lint, build, migration and whitespace checks. The real GitHub Device Flow `whoami` authorized `mightymetrika` (numeric GitHub ID `134214097`) with `stored=false`. This does **not** itself create a verified project-contributor link; persisted linking was exercised with synthetic integration data. No credit awards, payment obligations or transfers were created. C10 was committed and pushed as `b481ed4` on `development`.

## Checkpoint C12 — trusted operator contributor review (Windows accepted; committed `5a94518`)

C12 consolidates enrollment, review and compensation preview into three practical CLI commands, while preserving explicit credit approval and TEST-only payments:

```powershell
# After project setup and a successful GitHub sync with real candidates:
npm run cli -- github review pending PROJECT_ID
npm run cli -- github enroll PROJECT_ID NUMERIC_GITHUB_USER_ID CONTRIBUTOR_ID "Contributor Name"
# Contributor should separately authenticate control of the linked GitHub account:
npm run cli -- github identity verify PROJECT_ID CONTRIBUTOR_ID
# Operator uses the already-validated immutable approval command:
npm run cli -- github approve PROJECT_ID NUMERIC_REPO_ID CANDIDATE_KEY large "Accepted work"
# Preview a hypothetical $11.00 pool; NO funding entry or obligation is created:
npm run cli -- distribution preview PROJECT_ID 1100
```

`github enroll` makes a trusted **operator-attested** link, not an authenticated identity claim. The pending queue marks unlinked, operator-linked, and GitHub-verified accounts separately. C8 approvals currently require an operator link but do not require C10 verification; operators should check verification evidence as appropriate before awarding credits. The preview is **not** a funded allocation or payment promise. See `docs/CONTRIBUTOR_REVIEW_WORKFLOW_v0.1.md` for limitations and workflow details.

**C12 acceptance (2026-11-19):** All **88 unit tests** and **38 separate PostgreSQL integration tests** passed (126 total), along with database migration check, ESLint, TypeScript build and Git staged-whitespace checks. The existing local project `openpayables-c11-0ecc34cd` returned a successful empty `github review pending` queue (`pending: []`, `hasMore: false`). Positive enrollment, approval and read-only preview pathways used synthetic evidence in the test database; no real merged-PR candidate was available. No credits, payment obligations or transfers were created during the real queue check. C12 was committed and pushed to `origin/development` as `5a94518`; `main` was not changed.

## Delivered
- GitHub evidence intake (C7 committed): public repository registration, read-only bounded PR/review discovery, immutable candidates; no automatic credits or payments.
- GitHub approval (C8 WINDOWS ACCEPTED): append-only operator-attested numeric GitHub ID links, explicit reviewer/author scoring, transactional exactly-once credit awards. **64 unit tests and 20 integration tests passed**, along with ESLint, TypeScript build, and database migration on Windows. No automatic payments or identity ownership verification.
- Contribution credits: project-scoped contributors, configurable categories, manually approved 1/3/8 point events, append-only reversals, deduplication.
- Governance: immutable weighted ballots with voting weights frozen when a proposal opens.
- Deterministic distribution: integer-cent allocation with largest-remainder rounding, locked point snapshots, no credit consumption.
- TEST funding: project-specific operator attestations (legacy) or separately verified Stripe TEST top-up receipts; never mixed within a project. Provider evidence is uniquely assigned to one project; C3 adds sticky reversal holds and shared-platform commitment checks.
- Monetary obligations: paid or held per recipient, independently of other contributors; duplicate sends blocked.
- Stripe Connect TEST adapter: Express onboarding, transfers/reversals, signed test webhooks, C5 payout observations and C6 automatic-payout composition checks; no live keys.

**Financial limits:** `fund add` is **operator-attested TEST funding** and never verifies external money. `fund import-topup` instead reads a **succeeded, USD, TEST-mode top-up with a Stripe balance transaction**, and uniquely attributes that gross test receipt to one project by an operator decision. This does **not** prove subscription revenue, project ownership of funds, or funds currently free from spending/reserves; receipt reversal may occur later. `payment send` still requires an available Stripe TEST balance at send time. Stripe Connect `transferred` means funds moved to a connected Stripe account, **not** a bank payout. No unrestricted live payment path exists.

## Checkpoint B sandbox acceptance — passed 2026-11-17
- An isolated OpenPayables Development Stripe sandbox was used; `livemode` was `false`.
- A test Express connected account was onboarded successfully (`details_submitted`, `payouts_enabled` and `charges_enabled` all `true`).
- A $20.00 test top-up succeeded and became available in the platform's simulated Stripe balance. This was separate from OpenPayables' $11.00 operator-attested TEST funding entry.
- From an existing 8:3 credit allocation of $11.00, the CLI prepared and sent Alice's **800-cent** obligation. Stripe independently returned the same 800-cent USD transfer to the intended connected account, with `reversed = false`.
- Local reconciliation retained the same Stripe transfer ID; the obligation was `transferred` with **one** recorded payment attempt. Bob's **300-cent** obligation remained `held` with zero attempts.
- A dedicated test PostgreSQL database passed **6/6 integration tests**. `npm run check` passed **15/15 unit tests**, ESLint and the TypeScript build. The six integration cases skipped in `npm run check` were run and passed separately. The `development` working tree was clean.

This is an end-to-end **simulated-money Stripe transfer**, not proof of a bank payout, production readiness, or legal/compliance approval for live revenue sharing.

## Checkpoint C1 / C2 — TEST funding verification

- C1 (validated at `23a24ce`): `stripe balance` reads available USD from the authenticated sandbox; `payment send` checks this before recording an attempt. The preflight is not an atomic balance reservation.
- C2 (validated 2026-11-17): `fund import-topup <project-id> <tu_...>` reads a **previously created** Stripe TEST top-up; it never creates a top-up. Only succeeded USD TEST receipts with a balance transaction are accepted. The operator attributes the receipt to a single OpenPayables project.
- Migration `003_checkpoint_c2` extends `funding_events` with evidence type, Stripe platform ID, top-up ID and balance transaction ID. A unique index prevents importing the same provider receipt for multiple projects. Projects cannot mix `fund add` attestations and imported receipts, or receipts from different platforms.
- `fund status` now separately reports `attestedCents` and `verifiedTestCents` alongside reserved/remaining cents. Approved distributions cannot exceed the project's recorded funding. When sending an obligation from an imported-receipt project, the payment adapter verifies that the key belongs to that same Stripe test platform.
- Existing Checkpoint B demo projects retain their attested funding; they cannot convert it into verified funding by importing the platform's old test top-up. Use a **new project** with a distinct test receipt to exercise C2.

**C2 acceptance (2026-11-17):** A distinct succeeded **$5.00 Stripe TEST top-up** with a balance transaction was imported into `openpayables-c2-verified-0c89cbaf`; funding status showed 500 verified TEST cents and 0 attested/reserved. Importing that same receipt into `openpayables-c2-duplicate-a525d7ae` was rejected explicitly, and neither project's balances changed incorrectly. The C2 migration, **7 integration tests**, **27 unit tests**, ESLint and TypeScript build passed on Windows/PostgreSQL 17. No new transfers or live payments were made during C2 acceptance.

**C2 is not a live settlement system.** Stripe top-ups are gross provider receipts and not proof of an app's subscription revenues, beneficial ownership, net distributable revenue, or unspent cash. Later work must handle changes/reversals, reconciliation against liabilities and reserves across projects, provider approval and applicable tax/compliance obligations before any live money is enabled.

## Install and validate — Windows PowerShell 5.1

Requires Node.js 24, npm, PostgreSQL 16+, and two **dedicated** local OpenPayables databases. The supplied test environment below matches a native PostgreSQL 17 installation on port 5432. Do not use the blindstats Supabase databases.

```powershell
Set-Location "$HOME\Documents\openpayables"
$env:OPENPAYABLES_DATABASE_URL = 'postgresql://openpayables:openpayables_local_only@127.0.0.1:5432/openpayables'
$env:OPENPAYABLES_OPERATOR_ID = 'local-operator'
npm install
npm run db:migrate
npm test
npm run lint
npm run build
$env:OPENPAYABLES_TEST_DATABASE_URL = 'postgresql://openpayables:openpayables_local_only@127.0.0.1:5432/openpayables_test'
npm run test:integration
Remove-Item Env:OPENPAYABLES_TEST_DATABASE_URL -ErrorAction SilentlyContinue
.\scripts\checkpoint-b-demo.ps1
```

The B demo creates an independent project, credits two contributors 8:3, attests $11 of **TEST** funding, approves/reserves $11, and checks for $8 and $3 held obligations without a Stripe call. Integration tests use a **separate test database** and retain immutable test records there.

If using Docker Desktop rather than native PostgreSQL, `scripts/start-local-postgres.ps1` creates the existing local test container on 127.0.0.1:55432. The Docker script is optional.

## Operator CLI — examples

```powershell
npm run cli -- project create my-project "My open-source project"
npm run cli -- contributor create alice "Alice"
npm run cli -- project join my-project alice
npm run cli -- credit award my-project alice development large github "org/repo#1" author "Accepted PR"
npm run cli -- credit balances my-project
npm run cli -- proposal open my-project "Next priority?" "Advisory governance vote"
# Use returned proposal UUID:
npm run cli -- proposal vote PROPOSAL_UUID alice yes
npm run cli -- proposal tally PROPOSAL_UUID
# Existing TEST-attested funding path (do not mix with verified receipts in one project):
npm run cli -- fund add my-project 1100 "pilot-test-001"
npm run cli -- fund status my-project
npm run cli -- distribution create my-project "pilot-week-1" 1100
# Use returned period UUID:
npm run cli -- distribution approve PERIOD_UUID
npm run cli -- distribution show PERIOD_UUID
```

## C7 public GitHub discovery (read-only; Windows accepted)

After applying migration `007_checkpoint_c7`, with the operator environment configured, use an isolated local project and a public GitHub repository:

```powershell
npm run cli -- project create c7-discovery 'C7 public GitHub intake'
npm run cli -- github source add c7-discovery mightymetrika/openpayables
npm run cli -- github source list c7-discovery
npm run cli -- github sync c7-discovery mightymetrika/openpayables 2026-11-01
npm run cli -- github candidates c7-discovery
```

**C7 acceptance (2026-11-18):** The development migration, **61 unit tests**, **15 dedicated PostgreSQL integration tests**, lint, build, and staged whitespace checks passed. A read-only scan of public `mightymetrika/openpayables` in isolated project `openpayables-c7-8dcd0ee2` succeeded and returned **zero qualifying candidates** for the period beginning 2026-11-01. The empty queue was confirmed; this is a successful empty scan, not a live demonstration of positive PR ingestion. No credit awards, payment obligations or Stripe operations were created. C7 was subsequently committed and pushed as `836dc82`.

`since` is a UTC **merge-date** lower bound, not a review-date bound. The scan is bounded and rejects incomplete pagination rather than claiming completeness. Public GitHub activity requires no token; `OPENPAYABLES_GITHUB_TOKEN` is optional for higher limits and must not be committed. New evidence is stored without changing credit balances or any Stripe data. C8 will implement explicit approval and contributor identity mapping. See `docs/GITHUB_DISCOVERY_v0.1.md`.

## Read-only connected-bank-payout inspection (C5 TEST)

After `npm run db:migrate`, with a project bound to the current Stripe TEST platform and a contributor assigned an existing connected-account destination:

```powershell
npm run cli -- payout sync my-project my-contributor
npm run cli -- payout show my-project my-contributor
```

The sync requires `OPENPAYABLES_OPERATOR_ID` and an operator-owned `sk_test_` key supplied **privately** in the local environment. The show command reads the local audit only. Zero payouts is valid. These commands never create bank payouts or change individual obligation statuses.

## Optional Stripe Connect TEST acceptance

Use only a test secret beginning `sk_test_`. Keep the key private (PowerShell session or ignored local environment). Do not put it into Git, a handoff, or this chat.

```powershell
# Supply the Stripe TEST key privately in the local environment before running the CLI.
# Bind this particular project to the authenticated operator's Stripe TEST account first:
npm run cli -- stripe platform bind my-project
npm run cli -- stripe platform show my-project
# Create a test Express account and assign it to a project contributor:
npm run cli -- stripe account create my-project alice recipient@example.test
# Use returned acct_... identifier:
npm run cli -- stripe onboarding link acct_TEST_ACCOUNT https://example.com/refresh https://example.com/return
# Finish Stripe-hosted TEST onboarding in browser. Provide host URLs you control.
# Use the obligation UUID returned by `distribution show`:
npm run cli -- payment prepare OBLIGATION_UUID
npm run cli -- payment send OBLIGATION_UUID
npm run cli -- payment reconcile OBLIGATION_UUID
npm run cli -- payment history OBLIGATION_UUID
# Read-only balance preflight for the authenticated Stripe TEST platform:
npm run cli -- stripe balance
# Alternative funding path for a NEW project with no attested funding:
# Reuse a previously created, succeeded Stripe TEST top-up ID (tu_...).
# This only imports/attributes evidence; it DOES NOT create new funds.
npm run cli -- fund import-topup new-project tu_EXISTING_TEST_TOPUP
# C3: read-only recheck of all imported top-ups on the same Stripe TEST platform.
npm run cli -- fund recheck new-project
npm run cli -- fund status new-project
```

Stripe test-mode funds/balance and fully enabled Connect test accounts are needed for a real test transfer. The account's `payouts_enabled` flag must be true. An absent/disabled destination remains **held** and is not redistributed. Any error after starting a Stripe transfer is treated as **unknown** until reconciled, never automatically re-sent. Payment obligations are immutable in amount and beneficiary.

Optional signed local TEST webhook server:

```powershell
$env:OPENPAYABLES_STRIPE_TEST_WEBHOOK_SECRET = 'whsec_YOUR_TEST_LISTENER_SECRET'
npm run webhook:dev
# Listens only on http://127.0.0.1:8787/stripe.
# Forward Stripe TEST webhooks there using a separately installed Stripe CLI.
```

Webhook signatures are validated against the original bytes with a five-minute timestamp tolerance. Only TEST-mode transfer events are recorded; duplicate provider event IDs are ignored.

## Checkpoint C3 — funding-reversal audit and shared-platform liquidity (locally accepted)

C3 adds a read-only `fund recheck <project-id>` command and an **immutable** audit alert when a previously imported Stripe TEST top-up is no longer the same succeeded funding receipt. Alerted cents are subtracted from `remainingCents`, but frozen obligations are retained for investigation. Once flagged, a receipt is not automatically restored to usable funding merely because a later API call reports success. A network failure blocks preflight instead of being recorded as a confirmed reversal.

For projects funded by verified TEST receipts, approval and send automatically check provider receipts. New allocations must fit both project funding and total verified funds **not already committed across the same Stripe platform**. Before sending, OpenPayables checks that the platform can cover all outstanding verified-project obligations and serializes its own concurrent sends. Legacy operator-attested projects remain outside this attribution. External Stripe activity can still change available funds, and this is not proof of unspent app revenue or bank settlement.

**C3 local acceptance (2026-11-17):** Following fixes for integration-test fixture isolation and lock-cleanup lint, the development migration succeeded; **8 PostgreSQL integration tests**, **29 unit tests**, ESLint and TypeScript build passed. The existing Stripe TEST project `openpayables-c2-verified-0c89cbaf` was rechecked against platform `acct_1Ucqb8PGvHvd36JR`: one receipt checked, zero new problems and zero blocked receipts. Its funding remained 500 verified TEST cents, 0 blocked, 0 reserved, 500 remaining. No additional Stripe top-up or transfer was made. The receipt-reversal scenarios were exercised with test doubles, not a deliberately reversed live Stripe sandbox receipt. C3 was committed to `development` as `f263f46`; **live keys remain prohibited**.

## Boundaries and continuity

The CLI is a trusted **single-operator local tool**, not an authenticated public API or a multi-tenant hosted service. No Stripe test transfer can be attempted without a Stripe TEST credential, an enabled connected account, an approved and funded distribution period, and explicit operator execution. Financial data is stored in the `openpayables` PostgreSQL schema; no Supabase, Prisma, Clerk or Next.js coupling.

Use `PROJECT_HANDOFF.md` and `docs/GITHUB_INTEGRATION_CLOSEOUT_v0.1.md` for the accepted GitHub milestone and new-chat handoff. See `docs/MVP_SPEC_v0.1.md` for the MVP policy. The first reconciled Stripe TEST transfer has now been demonstrated. With the C11 GitHub App setup and C12 contributor enrollment, review queue and dollar preview accepted in Windows testing, the next practical step is to exercise the complete operator workflow when suitable real GitHub evidence becomes available. A real merged-PR end-to-end acceptance remains to be observed; do not manufacture a pull request merely to satisfy a checkpoint. Stripe eligibility review continues independently. This does not justify a frontend, tax service, automated per-line compensation, or blindstats integration.
