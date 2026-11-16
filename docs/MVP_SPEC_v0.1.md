# OpenPayables — MVP Design Specification v0.1

**Date:** November 16, 2026  
**Status:** Proposed implementation baseline  
**Primary objective:** Deliver a working, reusable contribution-credit, deterministic revenue-sharing, and voting system **with real monetary payout capability**. Do not expand the scope without a demonstrated need.

## 1. Definition of done

OpenPayables v0.1 is working when an operator can:

1. Register a project and verified contributors using application-independent IDs.
2. Approve a contribution (including a GitHub-linked software change or review), record the evidence, and grant auditable points.
3. Enter and approve a **funded** project-specific distribution pool; calculate and lock each contributor's deterministic allocation.
4. Connect a recipient through Stripe Connect; create an idempotent transfer in **test mode**; reconcile transfer status and failures, and prove retries do not duplicate payment.
5. Record a proposal, take contribution-weighted votes, and reproduce the tally.
6. After separate legal/provider and operational clearance, execute and reconcile a small controlled **live** payout without modifying blindstats Production.

A simulation, points leaderboard, or Stripe API call without reconciled payment state is **not sufficient**.

## 2. Scope boundaries

**In:** reusable TypeScript core; project-specific contribution policies; approvals; cumulative credits; deterministic allocation; minimal audited money records; PostgreSQL persistence; Stripe Connect adapter; basic vote recording/tallying; operator CLI and minimal webhook endpoint; automated tests and a tracked handoff.

**Out:** probabilistic rewards, games or research-study incentives as mandatory categories, transferable/tradable points, contribution decay, quadratic voting, complex DAO/cooperative legal structure, automated subscription billing, automatic GitHub scoring by lines/commits, mobile/frontend dashboards, tax-filing software, generalized ERP, and any changes to the live blindstats application.

## 3. Core rules

### 3.1 Project and identity

- Credits, governance, and payout pools are **project-scoped**; no automatic cross-project sharing.
- Each contributor has an internal stable ID; host applications map Clerk, Supabase Auth, or GitHub identities to that ID.
- Never use a mutable username as the accounting identity.

### 3.2 Contributions

- Default broad categories: accepted development, documentation, testing/quality, and substantive review. Every project may define additional categories and evidence rules.
- Initial simple award rubric: **small = 1, medium = 3, large = 8** points, set by a human approver with a recorded reason and evidence reference. These are provisional project-policy values, not universal measurements of labor or value.
- A merged pull request is **evidence**, not automatic entitlement. Do not pay by commit count or lines changed.
- Author and reviewer may receive distinct awards for distinct work on the same pull request. Each award must have a unique project/source/event/type/beneficiary identity to prevent duplicates.
- Corrections and reversals use new immutable events; finalized periods are not silently edited.
- Points are **not** transferable in v0.1. Collaborators can receive separate attribution when a contribution is approved.

### 3.3 Accumulated credits

- Initial rule: **lifetime cumulative, non-decaying** approved project points.
- A monetary distribution does **not** consume points. An inactive contributor retains their accumulated share, subject to later verified additions/corrections and the rules published for future periods.
- Revisit decay/maintenance only if actual experience reveals a problem. Credits are an allocation measure, **not** equity, a guaranteed dollar claim, or a fixed percentage of future revenue.

### 3.4 Deterministic allocation

For approved distribution pool `P` in integer cents and eligible contributors' accumulated points `A_i`:

`share_i = A_i / sum(A_j)` and `allocation_i = P * share_i`.

- Lock the project, eligible contributor set, point snapshot, policy version, pool inputs and allocation result for each period.
- Use integer cents; allocate residual pennies by largest remainder with a documented stable tie-breaker.
- If total points are zero, **do not distribute**; hold the pool for a later decision.
- If a contributor cannot currently receive a payment, preserve their allocated obligation as **on hold**; do not redistribute it by default or automatically erase it after six days.

### 3.5 Funding and revenue sharing

- The initial operator enters *verified* project revenue receipts, applicable transaction fees, approved attributable costs, reserves, and the project's published contributor-sharing rate. These entries generate the proposed distributable pool. No automated subscription-provider integration is required yet.
- An operator may instead authorize a separately **prefunded pilot pool**; label it clearly as prefunded compensation rather than earned subscription revenue.
- A pool cannot be approved or reserved above verified available funds after obligations/reserves. No unfunded transfer instructions.
- Policy terms must define what expenses are deductible; once a period is approved, the allocation and underlying policy version cannot be changed retroactively.
- The application/provider that owns the funds remains responsible for its accounting, payment authorization, and legal/tax obligations.

### 3.6 Governance

- Use the **same accumulated project points** as the raw voting weights.
- Initial mechanism: **one point = one vote of weight**; one current ballot per verified contributor per proposal; snapshot weights at proposal opening; record yes/no/abstain and an auditable tally.
- v0.1 votes are **advisory** and recorded; they cannot directly authorize a payout, alter finalized accounts, bypass legal requirements, or override an administrator's financial controls.
- Proposals may address project priorities or prospective contribution-policy changes. No delegation, quadratic transformation, binding treasury votes, or formal cooperative ownership in v0.1.
- When governance becomes binding, introduce a separate explicit rules review; do not let that delay the working MVP.

## 4. Architecture

Create **one independent `openpayables` repository**, not a collection of prematurely separated packages.

- `src/core/`: pure contribution, credit, allocation, and voting calculations (no database, auth, Next.js, or Stripe imports).
- `src/storage/postgres/`: SQL migrations and PostgreSQL repositories using `pg`; no Prisma/Supabase dependency.
- `src/payments/stripe/`: Stripe Connect adapter, payout eligibility, transfer commands, status lookup and signed webhook handling.
- `src/cli/`: minimal authenticated-by-operator-environment commands to exercise the system; no public admin console initially.
- `src/server/`: minimal endpoint for required provider webhooks, protected by provider signature validation.
- `tests/`: focused unit, integration and payment-adapter tests.
- `PROJECT_HANDOFF.md`: tracked living handoff inside this repository.

**Technology:** Node.js 24, TypeScript, Vitest, PostgreSQL, Stripe Connect. Host applications supply user identity/authentication and integration permissions. The core must not depend on any host database or identity platform. Database objects use a dedicated schema/role rather than research-workflow tables.

**Minimum durable data:** project, contributor identity mapping, policy versions, contribution events, credit adjustments, verified pool inputs, allocation periods, payout obligations, payment attempts/provider events, proposals, and ballots. Use unique constraints and immutable or append-only event histories where money/credit correctness requires them; do not build a general-purpose accounting product.

## 5. Payment-safety rules (non-negotiable)

1. Only approved, funded, and reserved obligations may be sent for payment.
2. Each payment obligation has a stable idempotency key; duplicate requests and repeated webhooks cannot pay twice.
3. Record `pending`, `held`, `submitted`, `transferred`, `paid_out`/settled where verifiable, `failed`, and `reversed` distinctly. **Stripe transfer success is not proof of bank settlement.**
4. Provider calls and database commits are not one transaction: recovery must query/reconcile provider state instead of blindly retrying.
5. Keep credentials and personal/tax/bank details out of public contribution records; use provider-hosted onboarding when possible.
6. Log approvals, allocation snapshots, status changes, reversals and admin actions. External provider identifiers are preserved for audit.
7. **Live-payments gate:** review contributor terms/classification, tax obligations, jurisdiction eligibility, funds ownership and Stripe's approval/requirements before first live disbursement. This gate does **not** block development or test-mode payment integration.

## 6. Build sequence: three checkpoints, then integration

**Checkpoint A — usable credit and governance engine:** repository, pure core, PostgreSQL migrations, manually approved contribution records, cumulative points, voting proposals/ballots/tally, automated tests, CLI. Demonstrate two contributors and independent audit of totals.

**Checkpoint B — funded allocation and Stripe test payments:** project pool inputs, preview/approve/reserve allocation, integer-cent payout obligations, Connect onboarding interface, idempotent Stripe test transfers, webhook/status reconciliation and simulated failed/repeated requests. Demonstrate exact conservation of the pool and no duplicate payment.

**Checkpoint C — controlled live payout:** confirm live-payments gate, connect eligible real payees, run a small fully funded approved payout, reconcile provider and internal records, document operational recovery. This is the mandatory monetary finish line.

**Later, not part of the MVP:** integrate a scoped adapter into blindstats **Development** after the standalone system works and has tests. No modification to the current blinding module, researcher-testing flows, or Production database before a separate reviewed integration plan.

## 7. Acceptance tests

- Two contributors have 8 and 3 accepted points. A funded $11.00 distribution produces exactly **$8.00** and **$3.00** obligations, with zero missing/extra cents.
- An inactive contributor with earlier approved points continues to receive their calculated share.
- Duplicate GitHub events, duplicate payment requests, and duplicate webhooks leave credits and transfers unchanged.
- An ineligible recipient's obligation is held rather than redirected.
- A failed/unknown provider response triggers reconciliation, not an automatic second payment.
- A proposal opened with 8:3 point weights retains those voting weights even if new credits are approved during voting.
- Every approved allocation can be reproduced from stored inputs and policy version.
- No code, schema, permissions, or deployment changes occur in blindstats during standalone development.

## 8. Operating rule for development

**Default to shipping the next working vertical slice.** Once a decision is adequately safe for an MVP, document the default and code it. Raise new design questions only when they block correctness, actual payment, security, or legal compliance. Do not add features merely because they might eventually be useful. Improvements belong in post-MVP issues and can benefit from community contributions.

**Next action:** create the standalone repository and implement Checkpoint A. This document is sufficient to start; no additional architectural-review round is required.
