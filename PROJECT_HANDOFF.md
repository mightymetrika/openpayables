# OpenPayables — Project Handoff

**Date:** 2026-11-17 (US Pacific)
**Current version:** Checkpoint B v0.2 ACCEPTED AND PROMOTED; Checkpoint C1 test-mode liquidity preflight patch prepared (not yet applied/validated).
**Git baseline:** `28a79a4` on both `main` and `development` (Checkpoint B acceptance, pushed 2026-11-17).
**Remote:** https://github.com/mightymetrika/openpayables
**Working branch:** `development`, clean after acceptance checks. Do not change blindstats.

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

## Checkpoint C1 — TEST-mode liquidity preflight (patch awaiting local validation)

- The `payment send` path first queries the authenticated Stripe TEST platform's **available USD balance**, before creating an immutable payment attempt. Insufficient funds or a failed balance query leave an already `ready` obligation untouched and create zero attempts.
- `stripe balance` is an explicit read-only operator CLI command, returning USD available cents (no key output).
- The Stripe TEST adapter rejects any balance payload that does not positively report `livemode=false`, and checks balance amounts are safe integers.
- The `payment send` preflight is deliberately **not an atomic provider balance reservation**. Concurrent transfers and external Stripe activity may still change availability; a subsequent ambiguous transfer error remains `unknown` and cannot be blindly retried.
- **Crucial financial boundary:** The Stripe platform balance aggregates funds; its availability does not prove that a given project received or owns revenue, nor that funds are free from other commitments. `fund add` remains operator-attested TEST funding. This step does not enable live payments or bank-payout tracking.
- New unit tests exercise available-versus-pending balances, test-mode rejection and malformed balances. An expanded PostgreSQL finance integration test asserts zero payment attempts when balance is insufficient.

## Immediate next action — preserve momentum

1. On clean `development` at `28a79a4`, apply the Checkpoint C1 path-preserving patch, then run `npm run test:integration` against the *separate* `openpayables_test` database and `npm run check`.
2. Run `npm run cli -- stripe balance` with the sandbox test key; confirm a read-only available balance without creating any payment attempt. Leave the already-transferred Alice obligation alone.
3. If validated, commit/push on `development`. Keep `main` at the accepted Checkpoint B baseline until the Checkpoint C gate is tested and ready for promotion.
4. Later Checkpoint C work must establish project-specific receipt/reconciliation, risk reserves, clear authorization, provider approval and contributor classification/tax/jurisdiction checks before a controlled live-money transfer. No live provider is implemented yet.

Local operator databases: `127.0.0.1:5432/openpayables` (development) and `127.0.0.1:5432/openpayables_test` (dedicated test). Configure all secrets only via PowerShell environment variables or ignored local configuration. Never commit Stripe secrets, real database credentials or onboarding links. The CLI remains a trusted local operator tool, not an authenticated multi-user API.
