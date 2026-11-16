# OpenPayables

Reusable TypeScript infrastructure for **verified open-source contribution credits, cumulative recognition, contributor governance, and eventual real monetary distributions**. This is **Checkpoint A**, not yet a payments product.

OpenPayables is a standalone project. It does not modify or connect to the blindstats or randomplayables production applications or databases.

## Delivered in Checkpoint A

- Project-scoped contributors and configurable contribution categories (four broad defaults).
- Human-approved **small/medium/large** credit events (1/3/8 points) with evidence references and deduplication.
- Append-only awards and reversal events; lifetime cumulative balances.
- Proposals with **frozen contribution-weight snapshots**, immutable yes/no/abstain ballots, and reproducible tallies.
- Generic PostgreSQL using `pg`, standard SQL migrations and a small Windows-friendly operator CLI.
- Pure computational tests and opt-in integration tests against a **dedicated test PostgreSQL database**.

**Not in Checkpoint A:** funding, allocation of money, Stripe Connect, automatic GitHub ingestion, contributor onboarding, web UI, or production deployment. They are later specified checkpoints, not hidden features.

## Requirements

- Windows PowerShell and Node.js **24** (the environment targeted by blindstats).
- PostgreSQL 16+ (Docker Desktop is one option).
- An empty, dedicated development database. Never point this package at a blindstats Supabase project.

## Local start (PowerShell)

Download the ZIP, extract the contents into `C:\Users\<you>\Documents\openpayables` and run:

```powershell
Set-Location "$HOME\Documents\openpayables"
node --version
npm install

# If Docker Desktop is installed and running:
.\scripts\start-local-postgres.ps1

# Or supply a connection string for YOUR dedicated local PostgreSQL database:
# $env:OPENPAYABLES_DATABASE_URL = 'postgresql://...'
# $env:OPENPAYABLES_OPERATOR_ID = 'local-operator'

npm run db:migrate
npm test
npm run lint
npm run build
.\scripts\checkpoint-a-demo.ps1
```

The scripts choose the local container name `openpayables-pg` and bind its port to **127.0.0.1:55432**, so they do not use the default PostgreSQL port. The Docker password is **only a known local development credential**; never expose that database publicly or reuse it in a deployed environment.

To run the actual database integration suite, set an explicit test connection string (ideally a separate isolated test database) and run `npm run test:integration`. The basic `npm test` skips these tests without that variable:

```powershell
$env:OPENPAYABLES_TEST_DATABASE_URL = $env:OPENPAYABLES_DATABASE_URL
npm run test:integration
Remove-Item Env:OPENPAYABLES_TEST_DATABASE_URL
```

The integration tests create uniquely named test records and do not delete immutable credit records; only run them against a disposable development/test database.

## CLI examples

```powershell
npm run cli -- project create blindstats-dev "blindstats development"
npm run cli -- contributor create alice "Alice"
npm run cli -- project join blindstats-dev alice
npm run cli -- credit award blindstats-dev alice development large github "org/repo#123" author "Accepted change"
npm run cli -- credit balances blindstats-dev
npm run cli -- credit history blindstats-dev
npm run cli -- proposal open blindstats-dev "Prioritize documentation?" "Advisory vote"
# Copy the returned proposal UUID:
npm run cli -- proposal vote "PASTE-PROPOSAL-UUID" alice yes
npm run cli -- proposal tally "PASTE-PROPOSAL-UUID"
```

**Operator safety:** The CLI requires `OPENPAYABLES_OPERATOR_ID` for write operations and records that ID. This provides audit attribution, not secure multi-user authentication. The CLI must remain a trusted, local operator tool; do **not** expose it as a public API. Authentication and role checks are integration concerns for a later stage.

## Accounting and governance limitations

- Credits are **not money, equity, or a promise of future payouts**. A financial allocation and settlement subsystem is required before actual compensation.
- Votes are **advisory** and are not treasury authorizations. One current, immutable ballot is permitted per voter per proposal in v0.1; vote amendments are deferred.
- No blanket historical backfill: operators award only documented, accepted work. Awards use immutable evidence references and stable contributor IDs, not usernames.
- Database constraints and the CLI must be the only trusted write paths. Database superusers can bypass triggers; preserve DB access control and backups in production.

## Repository and next step

Track `PROJECT_HANDOFF.md` in Git. This ZIP contains complete files, not diffs. Initialize and validate locally before creating an empty public GitHub repository. Next checkpoint: a funded deterministic allocation ledger and Stripe Connect **test-mode** payments, with reconciliation and idempotent retries. No blindstats changes until the standalone system is proven.

See [`docs/MVP_SPEC_v0.1.md`](docs/MVP_SPEC_v0.1.md) for the accepted MVP plan.
