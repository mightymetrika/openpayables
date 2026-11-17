# OpenPayables — Project Handoff

**Date:** 2026-11-16 (US Pacific)
**Current version:** Checkpoint B v0.2 candidate — NOT YET USER-VALIDATED
**Git baseline:** `38a28a0` on `main` and `development`, verified by user.
**Remote:** https://github.com/mightymetrika/openpayables
**Working branch:** `development`. Do not change blindstats.

## Established checkpoint

Checkpoint A validated on Windows 11, Node 24.19.0, PostgreSQL 17.12 using PowerShell 5.1:
- `npm test`: 9/9 core tests passed; original database tests skipped without URL.
- `npm run lint` and `npm run build`: passed.
- `npm run db:migrate`: passed.
- `npm run test:integration` with dedicated `openpayables_test` URL: 3/3 PostgreSQL tests passed.
- `checkpoint-a-demo.ps1`: 8:3 credits and 8:3 weighted vote, PASS.
- Local commit `38a28a0` on main pushed; `development` branch created and pushed at same commit, clean tree.

## Checkpoint B candidate — supplied path-preserving full-file ZIP

- `src/core/allocation.ts`: deterministic integer-cent largest-remainder allocation.
- `sql/002_checkpoint_b.sql`: operator-attested TEST funding, approved periods, frozen credit/amount snapshots, held obligations, immutable payment history, attempts and provider events.
- `src/storage/postgres/finance.ts`: reserved-pool controls, preparation, single attempt, reconciliation, Stripe event deduplication.
- `src/payments/provider.ts`: provider interface; `src/payments/stripe/test-client.ts`: TEST-only Stripe Connect REST adapter and Express onboarding.
- `src/server/webhook.ts`: locally bound signed Stripe TEST webhook listener.
- `src/cli/index.ts`: adds funding, distribution, payment and test Stripe commands, preserves A commands.
- `scripts/checkpoint-b-demo.ps1`: no-Stripe 8:3 -> $8/$3 TEST money-ledger demo.
- Unit/integration tests for distribution, fund reservation, unknown payments, reconciliation and duplicate webhooks.

**Safety boundary:** No live keys accepted. `fund add` represents operator-attested *test funding*, NOT validated external cash. `transferred` confirms a Connect transfer into the connected Stripe account, NOT a bank payout. Unknown outcomes MUST NOT be automatically retried. Live settlement, verified cash sourcing, tax and Stripe/provider review belong to Checkpoint C.

## Next action (do not over-plan)

1. Extract B patch on clean `development`, inspect `git status` (only expected files), `npm install` not required (uses Node built-in fetch, no added dependencies).
2. Validate `npm run db:migrate`, `npm test`, `npm run lint`, `npm run build`.
3. Set `OPENPAYABLES_TEST_DATABASE_URL` to the separate `openpayables_test` DB, run `npm run test:integration` (now includes A+B DB tests).
4. Run `scripts/checkpoint-b-demo.ps1` against development DB. Nothing calls Stripe in this demo.
5. Fix actual failures, then commit/push to development; when stable, test Stripe Connect using a real **test-mode** platform key and **test-mode** connected Express account; do not use bank/real cash.
6. Update this same tracked handoff at validated checkpoint. Do not alter existing blindstats applications, schemas, or deployments.

Operator local DB: `127.0.0.1:5432/openpayables`; test DB `127.0.0.1:5432/openpayables_test`. Configure secrets via PowerShell env or ignored local env file. Do NOT store credentials in Git or handoffs. Local CLI is a trusted operator tool, not authenticated multi-user API.
