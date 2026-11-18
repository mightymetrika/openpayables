# OpenPayables

A reusable TypeScript/PostgreSQL package for verified open-source contribution credits, contributor voting, and deterministic revenue-sharing **with actual monetary payment capability as the project goal**.

**Status:** Checkpoints A through C5 validated locally. C4 documentation was finalized on `development` as `d03c455`; C5 passed Windows tests and Stripe TEST read-only acceptance on 2026-11-17, **pending Git commit/push**. The first Stripe Connect TEST transfer was independently verified on 2026-11-17. No live payment capability is enabled. No blindstats or randomplayables databases or applications are modified.

## Operator-owned Stripe model (C4 — validated and committed)

**OpenPayables is software, not a shared payments intermediary.** Each independent paying business/project operator uses its **own Stripe account and own funds** for its contributors. Mightymetrika's Stripe account is for Mightymetrika's own projects/testing, not for paying other operators' contributors. Recipient onboarding occurs under that operator's Stripe Connect configuration; future OpenPayables SaaS subscription income is entirely separate from customer project funds.

C4 records an immutable, TEST-mode project-to-Stripe account binding (Stripe `acct_...` ID only) and prevents preparation, sending or reconciliation with another account's credentials. Imported verified-test funding automatically binds its authenticated account; attested-only projects require `stripe platform bind <project-id>`. Existing unbound attested projects with historical attempts require manual review, not silent rebinding. **This is still a dedicated local single-operator CLI.** It has no tenant authentication, secure hosted Stripe OAuth/restricted-key workflow or multi-tenant webhook routing; do not run it for unrelated clients from one shared service.

See `docs/OPERATOR_STRIPE_OWNERSHIP_v0.1.md` and `docs/LIVE_PAYMENT_READINESS_v0.1.md` for deployment, approval and real-money requirements. **C4 acceptance (2026-11-17):** migration passed, **9/9 PostgreSQL integration tests**, **29/29 unit tests**, lint and TypeScript build passed; existing verified-funding project backfill showed its expected Stripe TEST account ID. A fake-provider test verified that wrong-platform credentials are rejected before a transfer attempt. C4 was committed and pushed as `15cb19c`; no live payment capability was added.

## Checkpoint C5 — Stripe TEST bank payout observation (locally accepted)

C5 introduces `payout sync <project-id> <contributor-id>` and `payout show <project-id> <contributor-id>`. The sync makes **GET-only** calls to Stripe's TEST payout list, scoped via `Stripe-Account` to that project's configured contributor destination. Snapshots and immutable observation events record payout status changes, including later `failed` reports. A project/account mismatch, LIVE-mode response, malformed evidence or unsafe status regression stops synchronization.

**These are connected-account-level records.** A Stripe bank payout may combine several transfers or other funds. Even if Stripe reports an account's payout as `paid`, OpenPayables **does not mark any individual payment obligation bank-settled**. No payout creation, new top-up, transfer or LIVE key is involved. See `docs/BANK_PAYOUT_OBSERVATION_v0.1.md`.

**C5 acceptance (2026-11-17):** development migration passed; **10/10 PostgreSQL integration tests**, **40/40 unit tests**, ESLint, TypeScript build, and staged whitespace check passed. Using a separate local project `openpayables-c5-observation-879152d9`, two successful read-only Stripe sandbox payout syncs for the already-onboarded synthetic Alice account each returned **zero payouts and zero bank-settled obligations**; the local audit remained empty and no duplicate observations were created. C5 is validated but pending Git commit. Stripe has acknowledged the operator-owned eligibility inquiry by email; approval is **not** received.

## Delivered
- Contribution credits: project-scoped contributors, configurable categories, manually approved 1/3/8 point events, append-only reversals, deduplication.
- Governance: immutable weighted ballots with voting weights frozen when a proposal opens.
- Deterministic distribution: integer-cent allocation with largest-remainder rounding, locked point snapshots, no credit consumption.
- TEST funding: project-specific operator attestations (legacy) or separately verified Stripe TEST top-up receipts; never mixed within a project. Provider evidence is uniquely assigned to one project; C3 adds sticky reversal holds and shared-platform commitment checks.
- Monetary obligations: paid or held per recipient, independently of other contributors; duplicate sends blocked.
- Stripe Connect TEST adapter: Express onboarding, transfers/reversals, signed test webhooks and C5 connected-account **read-only payout observations**; no live keys.

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

Use `PROJECT_HANDOFF.md` for the current checkpoint. See `docs/MVP_SPEC_v0.1.md` for the MVP policy. The first reconciled Stripe TEST transfer has now been demonstrated. The next implementation milestone is to make real-money settlement safe and compliant before enabling live payments; this does not justify prematurely adding a frontend, tax service, GitHub scraper, or blindstats integration.
