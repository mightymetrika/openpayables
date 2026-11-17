# OpenPayables — Initial LIVE payment readiness gate v0.1

**Date:** 2026-11-17 (Pacific)  
**Source checkpoint:** `development` at `f263f46` before C4; C4 operator-owned TEST bindings accepted locally on 2026-11-17, pending commit.  
**Status:** OPEN / NOT APPROVED. This document does not enable live money movement.  
**Goal:** One controlled payment for genuine contribution work by an eligible recipient, followed by reconciliation of the connected-account transfer **and bank payout**. Keep the first pilot CLI-operated; no frontend, subscriptions or automated third-party collections required.

## 1. Decide and record the initial funds flow (blocking)

- **Operating/paying legal entity:** ____________________ (verify the live Stripe account belongs to this entity).
- **Owner of source funds and customer revenue:** ____________________.
- **Recipient arrangement and country:** ____________________ (start with one approved, eligible payee; verify jurisdiction).
- **Payment characterization:** compensation for accepted development/documentation/review work, licensing/royalty, or other; **legal/tax classification pending**. Non-transferable contribution credits are an *allocation formula*, not a monetary deposit, security, freely transferable stored value, or profit/equity entitlement.
- **First-pilot source:** prefunded budget or net receipts owned by the **particular project operator**, only if approved by Stripe. Every different operator/customer controls its *own* Stripe account and payments. Mightymetrika is one test operator only; it will not pool or custody customer funds.
- **Operating business controls:** who approves contributions, distribution, transfer release, and corrections; who owns the payment obligations.

Record these decisions before development of a LIVE payment adapter. The source of funds and the payer cannot be inferred from the `project_id` field or from a Stripe balance.

## 2. Stripe provider checks (blocking)

1. Open the **LIVE** Stripe Dashboard for the correct legal entity. Verify its legal business profile, business country, bank account and Connect platform approval; Stripe says top-ups require a KYC-approved platform profile. Do not infer approval from the successful sandbox transfer.
2. Confirm with Stripe Support that the exact initial contributor-payment/revenue-sharing model is supported with **Stripe Connect Express** (or ask for the correct alternative). Specifically ask about company-owned prefunding vs allocating proceeds from the operating entity's Stripe sales; whether platform approval or extra diligence is needed; the permitted transfer/service agreement configuration, account-country limitations, and fees/negative-balance responsibility.
3. Confirm that any real-money top-up is permitted for the approved purpose; only use an owned, verified bank account and the payments balance. A verified TEST receipt does not satisfy LIVE funding requirements.
4. Verify the live recipient has passed Stripe-hosted onboarding, any transfers capability/verification requirements, and enabled payouts. Never store their bank or tax identifiers in OpenPayables source or Git.
5. Obtain a documented Stripe response/ticket reference and record the permitted funds flow and conditions before authorizing any LIVE transfer.

### Stripe Support inquiry (verify the operator-owned model first)

**Subject:** Connect approval for compensating open-source software contributors from operating-business funds

We are developing OpenPayables, a software component that records reviewed contributions to open-source software projects and uses non-transferable contribution credits to calculate periodic cash payments to the developers, testers, documentation authors, and reviewers who performed the work. The credits are not purchasable or transferable and do not represent equity or an investment product. An authorized operator approves each pool and payout; recipients use Stripe-hosted Connect onboarding.

OpenPayables is reusable software: **each paying project operator/customer owns its own Stripe account, source funds and contributor obligations**. Mightymetrika LLC only provides software and may be one independent pilot operator. We do not pool customer funds or use Mightymetrika's account to pay other operators' contributors. The initial pilot would be one operator paying its own contributors from its own approved budget or its own eligible software receipts.

Can Stripe confirm whether this **per-operator-owned account** model is eligible for LIVE Connect contributor payments? Does each independent paying customer need its own Connect platform configuration, and are Express recipient accounts and (a) approved payments-balance top-ups or (b) separate charges and transfers suitable? For an eventual hosted OpenPayables SaaS, what Stripe-approved OAuth/Stripe App or restricted-key authorization should connect each operator's account without sharing full secret keys? Please identify country/recipient restrictions, negative-balance responsibility, tax-reporting scope and any additional approval. We are not requesting live transfers before review.

## 3. Legal and tax decisions (blocking, independent of Stripe approval)

- Confirm that the entity paying contributors is legally entitled to make the distributions, owns/controls the source funds, and is not operating an unlicensed third-party funds-transfer/escrow service.
- Have counsel review a simple contributor agreement: what qualifies as approved work; allocation/period policy; exclusions, reversals and disputes; prospective changes; ownership/licensing of contributions; payout holds; termination; no fixed share of profits or equity unless separately structured and reviewed.
- Have a tax professional determine contractor compensation vs royalties/other treatment, needed US or foreign payee documentation, withholding, applicable forms and who files them. Do **not** assume Stripe files the necessary forms automatically. Stripe's US Connect tax reporting docs distinguish platform and Stripe responsibilities.
- For the MVP, prefer one geographically supported payee and no cross-border complexity unless expressly cleared.

## 4. Technical live gate (blocking)

- Each paying operator must have their **own** approved Stripe account. Separate LIVE credentials, isolated operator data, webhook signing secrets and runbook from TEST. Keep `StripeTestClient` rejecting `sk_live_`; there must be **no** fallback or auto-switch to LIVE. The current local CLI does not constitute hosted multi-tenant authorization.
- Secure operator identity/authorization; use restricted access and audit approvals. `OPENPAYABLES_OPERATOR_ID` alone is an attribution label, **not authentication**.
- Reconcile **net** attributable revenue/funds, platform fees, refunds, disputes, reversals, reserves, existing obligations, and funds paid out by other operations before approving a LIVE pool. Use ledger-level checks plus Stripe available funds; Stripe balance alone does not establish project entitlement or reserve money at Stripe.
- For live transfers: explicit operator confirmation of payer, recipient, amount, project, period, source, and idempotency key; conservative caps and separate dry run; ambiguous failures stop and reconcile, never blindly retry.
- Persist signed webhooks and provider IDs; reconcile transfers, transfer reversals and **connected-account bank payout statuses** (`pending`, `in_transit`, `paid`, `failed`). Verify that a `transferred` record does not mean a bank payout succeeded.
- Confirm HTTPS webhook endpoint with signature validation, restricted deployment, encrypted secrets, persistent DB, backups, restore test, alerting and a documented manual recovery path. First live payout should have an operator present.

## 5. First LIVE acceptance (after all gates are cleared)

Use a very small, explicitly approved and fully funded pilot payment (size TBD by responsible operator), to a consenting/eligible real payee. Record provider approval case, signed internal approval, verified payer/source funds, recipient onboarding, unique obligation, exactly one transfer, Stripe reconciliation and confirmed bank `paid` status or documented `failed`/pending exception. Verify no duplicate payment after repeated commands/events and no impact to blindstats or other existing apps. Only then promote a deliberately tested release to `main`.

## Reference documentation (reviewed 2026-11-17)

- Stripe: add funds to platform balance — https://docs.stripe.com/connect/top-ups
- Stripe: separate charges and transfers — https://docs.stripe.com/connect/separate-charges-and-transfers
- Stripe: connected-account payout states/events — https://docs.stripe.com/connect/manage-connected-account-payouts
- Stripe: Connect tax reporting — https://docs.stripe.com/connect/tax-reporting
- Stripe: service agreements — https://docs.stripe.com/connect/service-agreement-types
- Stripe: prohibited/restricted businesses, updated 2026-09-22 — https://stripe.com/legal/restricted-businesses

**Do not record personal tax details, credentials, bank information or sensitive Stripe account access in this document.** See `OPERATOR_STRIPE_OWNERSHIP_v0.1.md` for the binding and future SaaS authorization boundaries.
