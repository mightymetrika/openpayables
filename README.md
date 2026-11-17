# OpenPayables

A reusable TypeScript/PostgreSQL package for verified open-source contribution credits, contributor voting, and deterministic revenue-sharing **with actual monetary payment capability as the project goal**.

**Status:** Checkpoint A and Checkpoint B v0.2 validated locally on Windows/PostgreSQL. The first end-to-end Stripe Connect **TEST-mode** transfer was independently verified on 2026-11-17. No live payment capability is enabled. No blindstats or randomplayables databases or applications are modified.

## Delivered
- Contribution credits: project-scoped contributors, configurable categories, manually approved 1/3/8 point events, append-only reversals, deduplication.
- Governance: immutable weighted ballots with voting weights frozen when a proposal opens.
- Deterministic distribution: integer-cent allocation with largest-remainder rounding, locked point snapshots, no credit consumption.
- TEST funding: operator-attested, project-specific funding events; reservation checks prevent two periods from spending the same attested pool.
- Monetary obligations: paid or held per recipient, independently of other contributors; duplicate sends blocked.
- Stripe Connect TEST adapter: Express onboarding, account readiness, transfers, status reconciliation, transfer-reversal detection, verified webhook receipt, no live keys.

**Financial limits:** TEST funding is an **operator attestation**, not verified money in a real bank/Stripe account. Test Stripe transfers separately require available simulated funds in the Stripe platform balance. Stripe Connect `transferred` means funds moved to a connected Stripe account, **not** a confirmed bank payout. No unrestricted live payout path exists; live settlement and compliance require further work.

## Checkpoint B sandbox acceptance — passed 2026-11-17
- An isolated OpenPayables Development Stripe sandbox was used; `livemode` was `false`.
- A test Express connected account was onboarded successfully (`details_submitted`, `payouts_enabled` and `charges_enabled` all `true`).
- A $20.00 test top-up succeeded and became available in the platform's simulated Stripe balance. This was separate from OpenPayables' $11.00 operator-attested TEST funding entry.
- From an existing 8:3 credit allocation of $11.00, the CLI prepared and sent Alice's **800-cent** obligation. Stripe independently returned the same 800-cent USD transfer to the intended connected account, with `reversed = false`.
- Local reconciliation retained the same Stripe transfer ID; the obligation was `transferred` with **one** recorded payment attempt. Bob's **300-cent** obligation remained `held` with zero attempts.
- A dedicated test PostgreSQL database passed **6/6 integration tests**. `npm run check` passed **15/15 unit tests**, ESLint and the TypeScript build. The six integration cases skipped in `npm run check` were run and passed separately. The `development` working tree was clean.

This is an end-to-end **simulated-money Stripe transfer**, not proof of a bank payout, production readiness, or legal/compliance approval for live revenue sharing.

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
# Money entries are operator attestations for LOCAL TEST only:
npm run cli -- fund add my-project 1100 "pilot-test-001"
npm run cli -- fund status my-project
npm run cli -- distribution create my-project "pilot-week-1" 1100
# Use returned period UUID:
npm run cli -- distribution approve PERIOD_UUID
npm run cli -- distribution show PERIOD_UUID
```

## Optional Stripe Connect TEST acceptance

Use only a test secret beginning `sk_test_`. Keep the key private (PowerShell session or ignored local environment). Do not put it into Git, a handoff, or this chat.

```powershell
# Supply the Stripe TEST key privately in the local environment before running the CLI.
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

## Checkpoint C1 — TEST-mode available-balance preflight (development patch)

The next vertical slice adds a read-only `npm run cli -- stripe balance` command and checks Stripe's available USD **test** balance before `payment send` reserves an immutable attempt. If funds are insufficient or Stripe's balance response cannot be verified as test-mode, the `ready` obligation is left unchanged with no send attempt. Do not rerun a transfer with uncertain outcome: `unknown` still requires reconciliation.

This balance preflight does **not** reserve funds at Stripe, prove project-specific receipts, or substitute for project cash accounting, taxes, compliance, or provider approval. The local operator-attested test ledger remains separate. Live keys remain forbidden. Validate this patch on `development` before treating C1 as accepted.

## Boundaries and continuity

The CLI is a trusted **local operator tool**, not an authenticated public API. No Stripe test transfer can be attempted without a Stripe TEST credential, an enabled connected account, an approved and funded distribution period, and explicit operator execution. Financial data is stored in the `openpayables` PostgreSQL schema; no Supabase, Prisma, Clerk or Next.js coupling.

Use `PROJECT_HANDOFF.md` for the current checkpoint. See `docs/MVP_SPEC_v0.1.md` for the MVP policy. The first reconciled Stripe TEST transfer has now been demonstrated. The next implementation milestone is to make real-money settlement safe and compliant before enabling live payments; this does not justify prematurely adding a frontend, tax service, GitHub scraper, or blindstats integration.
