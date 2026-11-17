# OpenPayables

A reusable TypeScript/PostgreSQL package for verified open-source contribution credits, contributor voting, and deterministic revenue-sharing **with actual monetary payment capability as the project goal**.

**Status:** Checkpoint A validated on Windows/PostgreSQL; Checkpoint B v0.2 supplied for local validation. Stripe integration is **TEST-MODE ONLY**. No blindstats or randomplayables databases or applications are modified.

## Delivered

- Contribution credits: project-scoped contributors, configurable categories, manually approved 1/3/8 point events, append-only reversals, deduplication.
- Governance: immutable weighted ballots with voting weights frozen when a proposal opens.
- Deterministic distribution: integer-cent allocation with largest-remainder rounding, locked point snapshots, no credit consumption.
- TEST funding: operator-attested, project-specific funding events; reservation checks prevent two periods from spending the same attested pool.
- Monetary obligations: paid or held per recipient, independently of other contributors; duplicate sends blocked.
- Stripe Connect TEST adapter: Express onboarding, account readiness, transfers, status reconciliation, transfer-reversal detection, verified webhook receipt, no live keys.

**Financial limits:** TEST funding is an **operator attestation**, not verified money in a real bank/Stripe account. Stripe Connect `transferred` means money moved to a connected Stripe account, **not** a confirmed bank payout. No unrestricted live payout path exists; live settlement and compliance are the next checkpoint.

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
$env:OPENPAYABLES_STRIPE_TEST_SECRET_KEY = 'sk_test_YOUR_OWN_SECRET'
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

## Boundaries and continuity

The CLI is a trusted **local operator tool**, not an authenticated public API. No actual money transfer can be attempted without a Stripe TEST credential, a connected account, a funded and approved period, and explicit operator execution. Financial data is stored in the `openpayables` PostgreSQL schema; no Supabase, Prisma, Clerk or Next.js coupling.

Use `PROJECT_HANDOFF.md` for the current checkpoint. See `docs/MVP_SPEC_v0.1.md` for the MVP policy. Do not build a frontend, tax service, automatic GitHub scraper, or blindstats integration until a working, reconciled Stripe test transfer is validated.
