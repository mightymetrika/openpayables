# Supabase PostgreSQL deployment — optional OpenPayables host

**Status (2026-11-22):** Hosted development/TEST compatibility **accepted** on one Mightymetrika-owned dedicated Supabase project: local 139/139 tests, all 11 existing migrations, TLS `verify-full`, restricted operator and application-reader roles, session/transaction pooler connectivity and one synthetic TEST smoke passed. At the hosted acceptance checkpoint, `0.2.0-alpha.3` was **uncommitted/unpublished**; Git history records any subsequent development commit and a separate release review is required. Published `v0.2.0-alpha.2` was unchanged. This guide describes an **optional deployment method** for each operator's dedicated PostgreSQL project, not a centralized Mightymetrika database for unrelated operators. The acceptance does not establish production hardening or LIVE payment eligibility.

## Deployment decision

OpenPayables remains ordinary PostgreSQL software. A project operator may choose Supabase, local Postgres, or another managed PostgreSQL service. Create a **separate Supabase project** for the operator's OpenPayables instance; for Mightymetrika this must be distinct from the existing BlindStats Supabase Development/Production projects. The Supabase database is named `postgres` and the OpenPayables tables live in its own `openpayables` schema. Do **not** copy schema objects into BlindStats' existing Supabase database or run BlindStats migrations here.

Only trusted server applications use `openpayables/read` through the dedicated read-only PostgreSQL login. The host must independently authenticate users and authorize OpenPayables project/contributor access. The read-only login can access the approved columns across the operator's project records; it does not provide per-user RLS. Keep `openpayables` **out of Supabase Data API exposed schemas**; do not grant its privileges to `anon`, `authenticated` or `service_role`, or expose database credentials as `NEXT_PUBLIC_*`. No Supabase Auth / JS integration is required.

## Step 1 — create and secure the hosted database

1. In the operator's Supabase organization create a **new, dedicated project** (for example `openpayables-mightymetrika-dev`). Do not reuse the BlindStats project. Use a non-production project for the first validation. Keep billing/compute choice under the operator's control.
2. In Database settings enable **SSL enforcement** and download the project's CA certificate to a private path outside Git. Prefer certificate + hostname verification (`sslmode=verify-full&sslrootcert=...`). Do not disable TLS verification (`rejectUnauthorized: false`) to make a failed test pass.
3. Under Database network restrictions, allow only required client egress addresses if stable and feasible. Supabase applies restrictions to direct and pooled database connections. For dynamic serverless egress, credentials, TLS, role privileges and host authentication remain essential; do not publish OpenPayables as an unrestricted service.
4. In the Supabase Dashboard **Connect** panel copy the **actual** connection string; do not guess the pooler host. Direct connections use IPv6 unless an IPv4 add-on is available. For Windows clients on IPv4-only networks, select **Session pooler** (`:5432`). For Vercel serverless read-only access, use **Transaction pooler** (`:6543`), with `OPENPAYABLES_POOL_MAX=1`. Direct or session mode is preferred for migration/admin and long-lived operator workloads. Validate the selected transaction mode against the actual deployed reader.
5. URL-encode any reserved characters in passwords and certificate paths in your PostgreSQL URL. The role name in a pooled URL is typically `ROLE.PROJECT_REF`, unlike a direct connection. Use your exact Supabase Connect instructions rather than assuming a host, project ref, or username. Never paste a full connection string into a chat, shell transcript, or Git-tracked file.

References: https://supabase.com/docs/guides/database/connecting-to-postgres ; https://supabase.com/docs/guides/platform/ssl-enforcement ; https://supabase.com/docs/guides/platform/network-restrictions ; https://node-postgres.com/features/ssl

## Step 2 — apply the **existing** OpenPayables migrations

Use the **existing OpenPayables migrator**, not the Supabase CLI and not the BlindStats migrations. It creates the `openpayables` schema and tracks the exact eleven existing migration versions in `openpayables.schema_migrations`. A separate local PostgreSQL database named `openpayables` continues to work without changes.

In a private PowerShell 5.1 session, set `OPENPAYABLES_DATABASE_URL` to the copied **Supabase admin** connection string (TLS verified, target database `/postgres`). Avoid recording credentials in command history; source them from a local ignored secrets file or a password-manager-backed session. Confirm host/project and credential role **before** executing migrations. This step changes the dedicated Supabase project, not any local or BlindStats database.

```powershell
Set-Location "$HOME\Documents\openpayables"
# Confirm OPENPAYABLES_DATABASE_URL privately points to the NEW Supabase project.
# Its role is the project administrator, not the read-only/operational role.
npm run build
npm run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'Supabase OpenPayables migration failed.' }
```

Use `psql` with the same admin connection string to check:

```sql
SELECT version FROM openpayables.schema_migrations ORDER BY version;
-- Exactly 11 version rows through 011_checkpoint_c13.
```

The migrations create normal tables, triggers, constraints, and a PL/pgSQL function; they do not request PostgreSQL superuser powers, install extensions, invoke Stripe, or alter Supabase Auth objects. Supabase restricts superuser access, which should not be needed for these statements.

## Step 3 — provision two restricted SQL logins

Run the tracked `sql/deployment/supabase_roles.sql` using `psql -X -f` as **the Supabase database administrator**, in the same dedicated project. This is a separate *deployment setup script*, **not** a numbered OpenPayables schema migration. The script fails if either role already exists or the current 12 migrations are absent; inspect rather than rerun it on partial success.

- `openpayables_operator`: trusted operator runtime with SELECT, INSERT and UPDATE on OpenPayables tables, but no DELETE, schema CREATE, role management, or schema migration ledger edits. Keep these credentials out of BlindStats.
- `openpayables_app_ro`: project-operator's application read-only login with only the 15 explicitly required relations/columns, a default read-only transaction, and no funding table access or schema CREATE. This is the **only** database login BlindStats should receive.
- The Supabase `postgres` admin connection runs migrations and role provisioning but must **never** be placed in an application or Vercel environment.

```powershell
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
# Point -d at a PRIVATE Supabase administrator URL (never print/share it).
& $psql -X -v ON_ERROR_STOP=1 -d $env:OPENPAYABLES_DATABASE_URL `
  -f '.\sql\deployment\supabase_roles.sql'
if ($LASTEXITCODE -ne 0) { throw 'Supabase role provisioning failed.' }
```

`psql` prompts for two new distinct role passwords twice each using `\password`. Keep these secrets locally or in a password manager. Do not use the existing local Windows role passwords. Supabase connection pooler endpoints may require `ROLE.PROJECT_REF` as the connection username. Obtain the precise endpoint from the Connect panel and verify login.

After every future **new** OpenPayables migration, review any new objects and update the explicit permissions. The deployment script intentionally does not auto-grant privileges on future tables.

## Step 4 — run synthetic TEST-only acceptance

Install npm dependencies from the OpenPayables repository as usual and build the source. Supply **two private** TLS-verified PostgreSQL URLs in the PowerShell session:

- `OPENPAYABLES_SUPABASE_OPERATOR_URL`: trusted operator role URL (`openpayables_operator`), direct/session connection.
- `OPENPAYABLES_SUPABASE_READER_URL`: read-only role URL (`openpayables_app_ro`), preferably the exact serverless transaction-pooler endpoint intended for the app.

Both URLs must point to the new Supabase project and `/postgres`, include `sslmode=verify-full` and an accessible `sslrootcert` CA path. The smoke code does **not** log credentials; do not display the environment variables. Validate the chosen URL independently with `psql \conninfo` if connectivity fails.

```powershell
Set-Location "$HOME\Documents\openpayables"
# Privately set the two *_URL variables above; do not copy secrets into chat.
$env:OPENPAYABLES_SUPABASE_TEST_CONFIRM = 'YES_SYNTHETIC_TEST'
$env:OPENPAYABLES_POOL_MAX = '1'
npm run check
if ($LASTEXITCODE -ne 0) { throw 'Local validation failed.' }
node '.\scripts\supabase-hosted-smoke.mjs'
if ($LASTEXITCODE -ne 0) { throw 'Supabase hosted TEST acceptance failed.' }
Remove-Item Env:OPENPAYABLES_SUPABASE_TEST_CONFIRM -ErrorAction SilentlyContinue
```

This smoke verifies reader and operator credentials, TLS, privileges, a synthetic operator-created project, two contributors with 8:3 points, a frozen governance vote and an **operator-attested TEST** distribution of $8/$3, read through `openpayables/read`. It attempts no Stripe action. The synthetic project and immutable audit records are deliberately retained, so run the smoke once for the initial acceptance rather than repeatedly.

Do not run the existing `scripts/technical-preview-smoke.ps1` against Supabase: that script intentionally requires a local dedicated database named `openpayables_test`.

## Step 5 — handoff to the BlindStats owner chat

**Only after the hosted smoke passes**, provide the other chat with: the fixed OpenPayables release/version to install, that the Supabase database host has been validated, the desired **read-only** pooled connection method, the `OPENPAYABLES_POOL_MAX=1` configuration for a released version that supports it, and the explicitly authorized synthetic project/contributor IDs. No passwords or secret URLs in chat. The BlindStats chat alone may set its ignored `.env.local`/Preview environment and test the protected `/openpayables` route. Retain the `VERCEL_ENV=production` denial until separately reviewed; no Production deployment is implied.

A hosted Supabase database does **not** by itself authenticate end users, authorize contributors, make subscriber funds available, or activate Stripe LIVE. Any future non-test rollout requires separate application authorization review, secrets management, operational backup/restore, and payment/compliance approvals.

## Recorded hosted TEST acceptance (2026-11-22)

- Supabase project: dedicated `openpayables-mightymetrika-dev` development project; its `postgres` database contains a separate `openpayables` schema. BlindStats Supabase was not modified.
- Administrative connectivity: session pooler port 5432, `sslmode=verify-full`, project CA certificate, server-side SSL confirmed.
- Migrations: all existing 11 versions, from `001_checkpoint_a` through `011_checkpoint_c13`, applied and verified through the existing OpenPayables migration runner. No migration rewrites or Supabase Auth changes.
- Roles: `openpayables_operator` (restricted application write) and `openpayables_app_ro` (column-scoped read-only) authenticated with private passwords through the session pooler; explicit privilege checks passed.
- Hosted synthetic smoke: operator through the session pooler; app reader through the **transaction pooler port 6543**. Role/TLS checks and the published `openpayables/read` interface passed. Acceptance project `supabase-smoke-4496fd4f`, synthetic Alice/Bob 8:3 credits, votes, and $8/$3 **held** TEST allocations. No payment provider API calls and no bank payments. Immutable TEST records were retained, not cleaned up.
- Local validation preceding acceptance: 139/139 unit and PostgreSQL integration tests, ESLint and TypeScript build all passed.
- The smoke was run once successfully. Do **not** rerun it merely to reproduce the log: it creates another permanent synthetic project.

## Compatibility / acceptance boundary

This is **not** a new Supabase-specific financial product or OpenPayables user database. Operators who prefer generic PostgreSQL can continue using the same package and migrations. The hosted acceptance validates this **development/TEST configuration**, not a public multi-tenant application, production security controls, backups, disaster recovery, real contributor onboarding, or LIVE Stripe payment eligibility. Deployers remain responsible for their own credentials and security controls. Do not provide a pooled admin or operator URL to BlindStats; only its protected server may use the reader role, and it must enforce project/contributor authorization.
