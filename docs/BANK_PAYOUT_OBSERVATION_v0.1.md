# OpenPayables — Connected-Account Bank Payout Observation v0.1

**Date:** 2026-11-17 (Pacific)
**Source:** Checkpoint C4 at `d03c455` on `development`
**Status:** C5 Windows and Stripe TEST sandbox acceptance passed on 2026-11-17; pending commit/push; TEST only, read-only Stripe calls

## What a transfer proves—and what a payout proves

- An OpenPayables `transferred` obligation means Stripe accepted a **platform-to-connected-account transfer**, not that an external bank received money.
- A Stripe `payout` is an **account-level** transaction from a connected account to its bank/debit card. The account's payout can contain balances arising from **multiple transfers or unrelated activity**. Do **not** claim that any particular OpenPayables obligation is bank-settled just because a recipient has a payout marked `paid`.
- Stripe's payout states include `pending`, `in_transit`, `paid`, `failed`, and `canceled`. A payout reported `paid` may still be followed by failure information. Check and retain later status observations rather than treating first success as irreversible.
- A future, separately reviewed transfer-to-payout attribution mechanism is needed before claiming per-obligation bank settlement. Current money/obligation statuses remain unchanged.

## C5 implementation

`payout sync <project-id> <contributor-id>`:
1. Verifies the current operator-owned TEST Stripe platform (`/v1/account`) against the project's C4 binding.
2. Selects the recipient's **stored destination**, never an arbitrary account supplied in the command.
3. Reads `/v1/payouts` with the `Stripe-Account: acct_...` header, using the connected account's scope. Pagination scans at most 1,000 payout records; incomplete results are rejected without local writes.
4. Rejects live-mode, malformed, duplicated, or inconsistent payout evidence. Records first sightings and material status/arrival/failure changes as append-only local observations, preserving the latest snapshot.
5. Does not create transfers, bank payouts, receipts, funding entries or payment attempts. It does **not** update any `distribution_obligations` status.

`payout show <project-id> <contributor-id>` displays the locally recorded payout snapshots and audit history. Neither command uses LIVE credentials.

The records are **scoped to a project-contributor observation**, not an attribution of every bank payout to that project's funds. A recipient using the same connected Stripe account for several projects may have overlapping payout observations. The operator still owns the responsibility to reconcile money and recipients.

## Acceptance and limits

**Local acceptance — 2026-11-17:** `006_checkpoint_c5.sql` migrated successfully in dedicated development PostgreSQL. The isolated test database passed **10/10 integration tests**; `npm run check` passed **40/40 unit tests**, ESLint, and TypeScript build. `git diff --cached --check` passed before the acceptance-documentation update. Tests cover account scoping, invalid evidence, pagination, idempotent repeated sync, status changes including delayed failure, account mismatch, and unchanged individual obligations.

**Real Stripe TEST sandbox API check:** a new observation-only project `openpayables-c5-observation-879152d9` was bound to existing TEST platform `acct_1Ucqb8PGvHvd36JR` and synthetic connected account `acct_1Ucr1LA9lZlrd52M`. Two successive `payout sync` calls both returned `observedPayouts=0`, `newPayouts=0`, `newObservations=0`, and `individualObligationsSettled=0`; `payout show` returned no payouts or audit events. The sync neither requested nor created a payout or transfer.

The earlier Alice sandbox transfer has **not** established a corresponding bank payout; zero returned payout records is valid, but **does not** establish real bank settlement. C5 is not live approval, not a manual-payout feature, and not proof that a real contributor received money.

## Stripe documentation

- Connected account API scope: https://docs.stripe.com/connect/authentication
- List payouts: https://docs.stripe.com/api/payouts/list
- Connected payout states and webhooks: https://docs.stripe.com/connect/manage-connected-account-payouts

## Pending live gate

On 2026-11-17, Stripe Support acknowledged receipt of an email asking for a human review of the **independent operator-owned Stripe account** compensation model. No approval or case number has been received. Continue TEST-only work; do not activate live transfers or present the current local CLI as authenticated multi-tenant SaaS.
