# OpenPayables — Project Handoff

**Date:** 2026-11-17 (US Pacific)
**Current version:** Checkpoint B ACCEPTED on `main`; Checkpoint C1 COMMITTED at `23a24ce` on `development`; Checkpoint C2 Stripe TEST funding receipt import LOCALLY VALIDATED and sandbox acceptance PASSED (not yet committed).
**Git baseline:** `28a79a4` on `main` (Checkpoint B accepted); `23a24ce` on `development` (Checkpoint C1 verified, pushed 2026-11-17).
**Remote:** https://github.com/mightymetrika/openpayables
**Working branch:** `development` at `23a24ce`, with uncommitted C2 changes ready for final documentation update and Git checkpoint. Do not change blindstats.

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

## Checkpoint C2 — Stripe TEST top-up source attribution (VALIDATED, NOT YET COMMITTED)

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

## Immediate next action — preserve momentum

1. Apply the path-preserving **C2 acceptance documentation-only** patch (this file and `README.md`) on `development` at `23a24ce`, preserving the already validated C2 source/migration/test changes.
2. Stage the ten C2 files (`PROJECT_HANDOFF.md`, `README.md`, `sql/003_checkpoint_c2.sql`, and seven TypeScript source/test files); `git diff --cached --check`; commit and push **`development` only**. Keep `main` on Checkpoint B `28a79a4`.
3. Proceed to the next narrow Checkpoint C slice: test receipt reversals/changes and reconcile project-level reservations against funds already committed across the Stripe platform. Do **not** assume a verified top-up is unspent or enable live payments without provider/legal/tax clearance.

Local operator databases: `127.0.0.1:5432/openpayables` (development) and `127.0.0.1:5432/openpayables_test` (dedicated test). Configure secrets via PowerShell environment variables or ignored local files. Never commit Stripe secrets, actual DB passwords or onboarding links. The CLI is a trusted local operator tool, not an authenticated public API. Do not modify blindstats or randomplayables apps or databases.
