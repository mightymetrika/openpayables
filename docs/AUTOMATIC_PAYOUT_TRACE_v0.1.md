# OpenPayables — Automatic Bank-Payout Component Trace v0.1

**Date:** 2026-11-17 (US Pacific)
**Baseline:** accepted C5 at `3699855` on `development`
**Status:** C6 TEST-only implementation; locally validated on Windows/PostgreSQL 17, ready to commit

## What we can establish

For standard **automatic** payouts when `reconciliation_status=completed`, Stripe permits listing the payout's individual connected-account balance transactions with `GET /v1/balance_transactions?payout=po_...`. A platform transfer to a connected account identifies a destination payment (`py_...`), which should appear as the source of the corresponding connected-account credit. Matching this source against the payout's member transactions provides direct provider evidence that the credit was included in the **named** automatic payout.

An automatic payout's `paid` status is a current Stripe assertion about the bank payout. It can later become `failed`; it is not unchangeable proof of an individual's final bank receipt. Multiple unrelated balance transactions can be included in the same payout. OpenPayables therefore does **not** update the obligation to `paid_out` or settled.

**Manual and unsupported payouts:** Stripe explicitly does not provide the same component attribution for manual payouts. Stripe's payout `reconciliation_status=not_applicable` is not evidence that a transaction was included in a particular bank payout. `in_progress` requires waiting for reconciliation; neither is a positive match.

## Command

`payout trace <obligation-uuid> <stripe-po-id>` performs GET-only Stripe TEST calls and:

1. Checks the stored frozen obligation is already `transferred` (not reversed, in review or unknown), and compares the current Stripe key's `/v1/account` identity against the bound payer platform.
2. Retrieves that precise transfer; requires `livemode=false`, unchanged USD amount, recipient, project/period/obligation metadata, and no reversed cents. Reads the `destination_payment` reference.
3. Retrieves the named payout on the **connected account** using `Stripe-Account`. If the payout is not a completed automatic payout, returns an explicit non-attributable or pending result.
4. For a completed automatic payout, retrieves every page of payout-scoped connected-account balance transactions and matches the destination payment source and exact positive USD amount. Incomplete/duplicate/bad evidence is rejected, not interpreted as an absent match.
5. Reports the payout's currently observed status and a descriptive inclusion result without modifying any OpenPayables SQL record or any Stripe object.

The account’s historical payout list can be inspected via existing `payout sync` and `payout show` commands. The CLI intentionally requires a **specific** payout ID, avoiding unbounded scanning and misleading matches.

## Boundaries and acceptance

No SQL migration and no live money operation are required. This feature must be verified with mocked TEST payloads (matched/unmatched, manual, incomplete, bad identity, reversed transfer, account mismatch and later failure). Optional real Stripe TEST read-only validation requires an already-existing `po_...` in the connected recipient account. During C5, the synthetic Alice account returned **zero payouts**; therefore an external payout trace cannot be expected until a suitable payout exists. **Do not create a payout merely for acceptance.**

This is a point-in-time chain-of-funds evidence query, not a general bank statement verifier, not personal tax compliance and not release approval for live money. The awaited Stripe human eligibility review of operator-owned payment models remains a separate requirement.

## Acceptance evidence — 2026-11-17

- `npm run check`: **51/51 unit tests passed**, ESLint clean, TypeScript compiled.
- `npm run test:integration`: **11/11 PostgreSQL integration tests passed** on the dedicated `openpayables_test` database.
- Both Git whitespace checks passed; CRLF conversion warnings on Windows were informational.
- No real or simulated bank payout was created or traced through Stripe during C6 acceptance. The historical synthetic connected account had no payout ID after C5; the transfer/payout trace behavior was tested using mocked Stripe data. This is a **local code acceptance**, not an external bank settlement demonstration.
- C6 remains staged on `development` at base `3699855` awaiting a commit. Stripe live-model eligibility approval is pending, and live transfers are disabled.

## Sources

- https://docs.stripe.com/api/transfers/object — transfer `destination_payment`
- https://docs.stripe.com/api/payouts/object — `automatic`, `reconciliation_status`, payout status
- https://docs.stripe.com/api/balance_transactions/list — automatic payout member filter
- https://support.stripe.com/questions/payout-reporting-options — manual payouts lack this attribution
