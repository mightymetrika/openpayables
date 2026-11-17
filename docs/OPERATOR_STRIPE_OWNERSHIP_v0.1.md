# OpenPayables — Operator-Owned Stripe Architecture v0.1

**Date:** 2026-11-17. **Status:** target architecture; TEST-mode implementation in Checkpoint C4; shared hosted SaaS and LIVE transfers **not** enabled.

## Non-negotiable ownership boundary

OpenPayables is reusable software. Each independent **paying project operator** (individual or legal entity as applicable) must control its **own eligible Stripe account**, source funds, connected contributor recipients, payment obligations, and Stripe approvals. Mightymetrika LLC provides the software and operates only its own projects/pilots; it must **not** pool customers' balances in Mightymetrika's Stripe account, impersonate customers as the payer, or serve as a central funds intermediary. A contributor receiving payment may complete Stripe-hosted onboarding **under the paying operator's Connect setup**; that does not necessarily mean the contributor needs an unrelated, full Stripe merchant account.

Examples:
- Mightymetrika project → Mightymetrika's own Stripe account → its connected recipients.
- Company X project → Company X's independently controlled Stripe account → its connected recipients.
- Project owner Y → owner's independently controlled **eligible** Stripe account → its connected recipients.

OpenPayables' own future subscription fees are a separate transaction between the operator and OpenPayables' software vendor, never a receipt in the operator's contributor pool. Cross-border eligibility, business purpose, payments capability and permitted recipient account type are subject to Stripe and applicable law; a customer owning an account alone does not grant approval to pay contributors.

## Current execution model: one trusted operator per deployment

Checkpoint C4 adds an **immutable project-to-Stripe TEST platform binding** (account ID, not secrets). `stripe platform bind <project-id>` reads `/v1/account` with the operator's local `sk_test_` key and binds that project. Existing C2/C3 projects with verified top-up receipts are backfilled using their previously authenticated platform IDs. `fund import-topup` binds a new verified project automatically, checking an existing binding. An operator cannot silently rebind a project to a different Stripe platform. `payment prepare`, `payment send`, and `payment reconcile` refuse unmatched or unbound credentials before payment-side actions. `stripe account create` refuses to create a recipient account for an unbound project.

- TEST-only. No credentials are stored in PostgreSQL, documents, or Git. Live keys remain forbidden by the Stripe adapter.
- Legacy **attested-only** projects require an explicit binding before *new* payment preparation/sending. Legacy unbound projects with earlier payment attempts are deliberately not rebound by a blind CLI command; reconcile their historical source platform under manual review first.
- A binding is **not** authentication or authorization: `OPENPAYABLES_OPERATOR_ID` is a self-reported operator label, not proof of identity. The CLI and its single webhook signing secret assume a dedicated, trusted operator environment. Do **not** expose this database, CLI or webhook endpoint as a multi-tenant service.
- C3 global reservation accounting spans projects *within the same authenticated Stripe platform*. A different operator's platform must not share the same funds/commitment pool. Cross-account funds aggregation is forbidden.
- `fund add` remains a TEST operator attestation, not bank money. All proof-of-funds restrictions remain; a matched key does not prove ownership of a project-specific pool.

## Hosted SaaS extension — not yet built

To support multiple independent operators on one hosted OpenPayables service, implement: (1) real tenant/project authentication and authorization, including approvals, (2) per-tenant Stripe connection and secure credentials using an **approved OAuth/Stripe App or suitably restricted-key mechanism** instead of collecting customers' unrestricted secret keys, (3) tenant-scoped database queries/RLS and encryption/secret rotation, (4) account-specific signed webhooks, payout event routing, and audit trails, and (5) per-operator funding, liquidity and liability controls. Never choose the current global `OPENPAYABLES_STRIPE_TEST_SECRET_KEY` dynamically for unrelated operators in a public service. Do not call a single developer Stripe Connect platform the payer for all customers.

Stripe has published special security requirements for third-party integrations including open-source plugins. The precise approved authorization method and Connect operating model should be confirmed with Stripe before hosted deployment. Read: https://support.stripe.com/questions/plugin-user-migration-guide and https://support.stripe.com/questions/security-permissions-and-access-levels-when-connecting-your-stripe-account-to-a-third-party-platform .

## Stripe provider clarification to seek (operator-owned design)

OpenPayables is reusable contribution-credit, allocation and payables software. Each independent customer is the payer, owns its own eligible Stripe account, and will pay its own developers/reviewers from its own approved funds. OpenPayables does not pool or custody their money and will charge any software subscriptions separately. We currently run a local TEST-mode operator CLI and use Stripe-hosted onboarding for contributor recipients. **Is this per-customer Connect payments model supported and how should a hosted software provider securely authorize access to each customer's account?** Should each paying customer establish its own Connect platform profile? Which account/service agreement, jurisdiction/eligibility, top-up or sales-revenue funds path, restricted-key/OAuth/Stripe App permissions, and obligations apply? We are **not** requesting live fund movement yet. Get the answer in writing for the real pilot operator's jurisdiction.

## MVP release condition

Do not enable live transfers until the paying operator's *own* Stripe setup and recipient eligibility are confirmed; applicable tax/classification/contributor agreement and funds sourcing are approved; securely isolated live credentials, funding controls, webhooks, recovery and bank-payout reconciliation are implemented; and a small real payout is successfully reconciled. See `LIVE_PAYMENT_READINESS_v0.1.md`.
