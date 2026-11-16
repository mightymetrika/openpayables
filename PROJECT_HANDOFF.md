# OpenPayables — Project Handoff

**Checkpoint:** A — initial local implementation (2026-11-16)  
**Working name:** OpenPayables  
**Project owner:** Mightymetrika  
**Repository:** local-first; GitHub repository not yet created.  
**Primary reference:** `docs/MVP_SPEC_v0.1.md`

## Objective and decisions

Ship a working reusable contributor-credit, deterministic revenue-share and advisory governance system with actual monetary payouts as a mandatory end goal. Do not extend the plan unnecessarily. Probabilistic payouts are **out**. Project-specific categories are supported; generic open-source contributions are the default. The same cumulative points support future revenue allocations and current advisory votes.

Keep this standalone project isolated from blindstats research workflows and existing Production/Development Supabase projects. No blindstats changes and no credentials copied from the applications.

## Checkpoint A files and behavior

- `src/core/credits.ts`: 1/3/8 scoring and cumulative immutable-event calculations.
- `src/core/voting.ts`: frozen voting snapshots and weighted tally.
- `sql/001_checkpoint_a.sql`: project, contributor, category, credit, proposal, ballot schema and immutability triggers.
- `src/storage/postgres/`: migration runner and PostgreSQL adapter.
- `src/cli/index.ts`: local operator commands; requires `OPENPAYABLES_OPERATOR_ID` for writes.
- `tests/`: unit tests plus PostgreSQL integration tests (explicit opt-in).
- `scripts/`: local Docker PostgreSQL startup and repeatable 8:3 credit/vote demo.

**No money APIs or Stripe integration yet.** Payment execution is Checkpoint B, followed by controlled live payout Checkpoint C after legal/provider review.

## First user-run acceptance (Windows PowerShell)

1. Extract ZIP into `$HOME\Documents\openpayables` and enter that directory.
2. `npm install`
3. `.\scripts\start-local-postgres.ps1` (requires Docker Desktop) or set a dedicated PostgreSQL URL.
4. `npm run db:migrate`
5. `npm test`; `npm run lint`; `npm run build`.
6. `.\scripts\checkpoint-a-demo.ps1` — must report Alice=8, Bob=3 and vote yes=8, no=3.
7. Run optional real PostgreSQL integration test on a dedicated test DB.
8. Inspect Git state, then initialize and commit locally. Create/push GitHub only after this checkpoint passes.

## Acceptance boundaries

No claims of production readiness or real payouts until Checkpoint B/C. Local operator CLI is trusted by environment and not multi-user authenticated. Money accounting, eligibility and payment provider checks are not yet implemented.

## Next action after user validation

Implement Checkpoint B only: funded pools, integer-cent deterministic obligations, Stripe Connect test transfers, idempotent execution, and reconciliation. Maintain this handoff at each validated checkpoint; avoid speculative features and premature UI/integration.
