# First-payout approval — development candidate

This is an isolated approval record, not a payable transfer or bank payout. The published TEST technical preview is unchanged. The normal TEST CLI, financial ledger and hosted development database cannot authorize LIVE payments. No money movement API is introduced.

## Scope and deliberate pilot limits

- Migration 012 creates a separate append-only table with mode, project, contributor, frozen positive credit points, integer USD cents, exact payer and recipient IDs, verified top-up ID and matching available net balance transaction, observed available balance, external approval reference, and authenticated PostgreSQL login/time. One approval per payer and project within this operator-owned database; do not duplicate the LIVE database or use another installation to repeat the pilot; duplicate receipts refused. No TEST funds, distributions, or attempts can become LIVE obligations.
- A single US contributor with **all positive credits in the selected genuine project**, maximum 2,500 cents ($25), one payer, one receipt. This is a deliberately restricted pilot, not a general distribution implementation. Never remove other contributors' credits to satisfy the constraint. Do not manufacture contribution history. The approved amount is the entire pilot allocation, not a claim to all project revenue. External spending or reversal of a top-up can invalidate readiness after approval; funds are reserved only in this isolated ledger, not locked in Stripe.
- Application calls are restricted to the operator's trusted local runtime. An authenticated dedicated database login is the trust boundary, not an end-user authorization system. The external reference identifies the operator's recorded business approval, recipient consent, eligibility and tax review; it is not proof of those things. Never include sensitive personal data in the reference. Database owners/administrators and operators with direct DB access are trusted; this is not cryptographic protection against them. Do not expose this CLI to contributors or a public web endpoint.
- The actual LIVE CLI requires a separate local PostgreSQL database named `openpayables_live` and a non-admin login named `openpayables_live_operator`, no fallback to existing database URL. It checks database identity before provider read. SQL refuses LIVE inserts elsewhere; synthetic integration records explicitly use `pilot_test` in `openpayables_test`. Do not provision the LIVE DB yet. Future deployment will grant the dedicated role only required SELECT and INSERT privileges, and seed only real authorized project/contribution records. Existing TEST operator and app-reader roles do not receive approval-table grants. Do not migrate hosted development for this local candidate.

## Future operator CLI (not an instruction to execute now)

`npm run live:pilot -- approve PROJECT CONTRIBUTOR acct_RECIPIENT tu_TOPUP CENTS APPROVAL_REFERENCE`

`npm run live:pilot -- show PROJECT`

Requires `OPENPAYABLES_LIVE_DATABASE_URL` and explicit `OPENPAYABLES_LIVE_PILOT_CONFIRM=YES_APPROVE_PILOT_NO_TRANSFER`. Approval additionally uses the read-only credentials and expected payer from `docs/FIRST_PAYOUT_LIVE_READINESS.md`, with permission to retrieve balance transactions. Use a secrets vault where available, never Git, chat, source, or command history. The existing GET-only inspector validates the LIVE platform and available balance, named recipient, succeeded USD top-up and matching available net balance transaction. This is preliminary eligibility evidence only; it does not reserve funds at Stripe or guarantee receipt validity later. The returned `safeToExecuteTransfer` is always false.

## Acceptance

Use the existing dedicated local `openpayables_test` URL, `npm run check` (includes integration tests when the URL is set). New synthetic tests exercise DB isolation, cap and evidence mismatches, concurrent single approval, immutable records and refusal of multiple positive-credit contributors. GET requests in provider unit tests are mocked. No LIVE credentials or real Stripe calls are required.

## Remaining release gate

Implement the single durable transfer attempt and unknown-outcome reconciliation with separate restricted write credentials, current v2 recipient capability check, fresh payer/balance/receipt validation, immutable amount and idempotency, authenticated webhook processing and bank-payout evidence. Test in a sandbox and dedicated DB; then provision and validate the real operator environment. Obtain explicit business/legal/tax/provider/recipient approvals and genuine funds before one separately authorized LIVE transfer. This candidate does not authorize or initiate one.
