# OpenPayables — GitHub Evidence MVP Plan v0.1

**Date:** 2026-11-17 (US Pacific)
**Baseline:** locally accepted C6, starting from `development` commit `3699855`
**Status:** C7 proposal; NOT YET IMPLEMENTED

## Why GitHub is next

The MVP already has audited **manual** credit awards with GitHub evidence references, lifetime cumulative 1/3/8 credit weights, deterministic largest-remainder integer-cent allocations from an approved funded pool, and Stripe TEST payout safeguards. The missing workflow is **discovering real project contributions on GitHub, retaining reviewable evidence, and approving awards from those candidates.** This belongs in the MVP rather than waiting for Stripe's independent live-money eligibility response.

**Distinct responsibilities:** GitHub reports activity; the project operator approves whether it constitutes a valuable contribution and selects the award category, size, reason, and beneficiary; the existing allocation engine decides relative monetary shares only when the operator separately authorizes a funded pool. No fixed dollars per commit, per line, per PR, or per review. Credit balances are cumulative, not consumed by a distribution.

## C7 vertical slice (public repositories; read-only intake)

1. **Configure source:** map one or more GitHub `owner/repo` values to an OpenPayables project. Use an operator-selected public repository for the first end-to-end test; do not modify that GitHub repository.
2. **Discover candidates:** fetch merged PRs and submitted PR reviews via GitHub REST APIs, with pagination and explicit time/range bounds. PR author and review author are distinct candidate roles. Do not double-count the commits belonging to an accepted PR.
3. **Identity:** preserve stable numeric GitHub user ID and repository/PR/review IDs; map the GitHub account to the existing internal contributor ID through a deliberate operator-confirmed link. GitHub login is display metadata, not an accounting identifier. Never infer or pay a contributor on a username match alone.
4. **Review queue:** persist the original source URL, PR/review identity, author ID, accepted/merged timestamps and relevant metadata as a pending candidate. Untrusted source text is evidence, not instructions. Re-scanning must be idempotent; API errors must not turn into false evidence or awards. Changes to a source object are reported without rewriting immutable awards.
5. **Explicit approval:** operator reviews the candidate, selects category and `small`/`medium`/`large` award (1/3/8 default points), and supplies a reason. Reuse the existing immutable credit-award and reversal machinery and its uniqueness controls. Different contributors can receive distinct awards for genuinely separate author/review work.
6. **Acceptance:** on a public test repository, show candidate import, identity mapping, explicit approval, duplicate-scan protection, no double award, 8:3 credit totals, and an 1100-cent **TEST-only** approved pool producing 800/300 cents. No Stripe call is required to prove the GitHub-to-dollar path.

## Not in the initial slice

Automatic awarding on merge, per-commit or per-line payout formulas, user-controlled arbitrary points, generic scraper, scheduled production job, private repositories, GitHub App installation, live webhooks, and auto-paying a PR. Later extensions can use a GitHub App with repository-scoped installation permissions and signed/deduplicated events, and additional evidence types such as issue triage and releases. Keep repo source IDs and installation permissions scoped to the operator/project.

## Background from earlier RandomPlayables implementation

Earlier RandomPlayables GitHub ingestion used `fetchUserRepoActivity` to calculate `metrics.githubRepoPoints` using commit and changed-line metrics. The reusable lesson is reading and identifying GitHub activity. OpenPayables should **not** adopt quantity-based metrics as automatic monetary entitlements; it needs independently auditable, project-approved contribution credits before allocating money.

## Relevant GitHub documentation

- https://docs.github.com/en/rest/pulls/pulls
- https://docs.github.com/en/webhooks/webhook-events-and-payloads
- https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks

The local CLI is still single-operator and not a secure hosted multi-tenant service. The Stripe Connect live-money eligibility inquiry remains open. No other repository or production system should be modified for C7.
