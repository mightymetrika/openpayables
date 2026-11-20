# OpenPayables — self-hosted technical preview (TEST only)

**Baseline:** `development` at `bfe29e4`, plus the release-readiness patch. This is a locally installable preview, **not** a published npm package, hosted SaaS, bank-settled payment product, or LIVE-enabled release. Do not enable LIVE Stripe credentials.

**Packaging validation (Windows PowerShell 5.1, November 19, 2026):** 92 unit tests, 40 dedicated PostgreSQL integration tests, ESLint, TypeScript build, and staged-independent packaging smoke all passed. The smoke installed the tarball outside the repository, invoked both installed binaries, confirmed the migration path, and exercised synthetic 8:3 votes and a 2,000-cent revenue basis yielding 1,455/545 cents. It used only `openpayables_test` and performed no external GitHub/Stripe calls. GitHub prerelease publication is **a separate, not-yet-completed step**.

## What ships

A Node.js 24+ tarball (`openpayables-0.2.0-alpha.1.tgz`) built with `npm pack`. It contains compiled JavaScript + declarations, 11 versioned PostgreSQL migrations, the README and MIT license. Installed entry points are:

- `openpayables` — the existing trusted, single-operator CLI, including credits, votes, GitHub evidence review, `distribution create-revenue`, and TEST Stripe operations.
- `openpayables-migrate` — applies versioned migrations to a **dedicated** OpenPayables PostgreSQL database using `OPENPAYABLES_DATABASE_URL`.

The `package.json` stays `private: true` to prevent accidental npm registry publication. `npm pack` produces a portable tarball without publishing it; don't change this flag for the initial preview. The release tarball must not contain source-control metadata, `.env` files, credentials, or key files. The smoke script checks expected package entries and forbids unexpected source/secrets.

## Requirements and installation (Windows PowerShell 5.1)

1. Node.js **24+** and npm; PostgreSQL **16+** in an operator-owned environment. Create a separate database (and ideally a restricted database user) exclusively for OpenPayables. Do **not** use BlindStats, RandomPlayables or any other app's database.
2. A trusted terminal under the operator's control. `OPENPAYABLES_OPERATOR_ID` is a recorded operator label, **not** a password or authenticated login. Do not expose these binaries or database credentials as an unauthenticated remote service.
3. Create the distribution archive **from a verified clean source checkout** on `development`:

   ```powershell
   npm install
   npm run check
   npm pack
   ```

   `npm pack` automatically runs `npm run build` and emits `openpayables-0.2.0-alpha.1.tgz`. No npm registry publication occurs.

4. Copy that tarball to the independent operator's chosen folder or computer. In a new empty folder (not the source checkout):

   ```powershell
   npm init -y
   npm install --no-audit --no-fund "C:\path\to\openpayables-0.2.0-alpha.1.tgz"
   $env:OPENPAYABLES_DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:5432/DEDICATED_OPENPAYABLES_DATABASE'
   $env:OPENPAYABLES_OPERATOR_ID = 'trusted-operator'
   .\node_modules\.bin\openpayables-migrate.cmd
   .\node_modules\.bin\openpayables.cmd --help
   ```

   Use your **own real** database credentials, not values from sample test files. Supply secrets only in the trusted environment or an appropriately managed secret store, never in Git or chats. Set TEST Stripe/GitHub App variables only when required by the chosen workflow, using the repo's existing documentation. The GitHub App private key remains outside the installation and is never packaged.

## Operator workflows

For a basic standalone workflow (does not access GitHub/Stripe):

```powershell
.\node_modules\.bin\openpayables.cmd project create my-project "My project"
.\node_modules\.bin\openpayables.cmd contributor create alice "Alice"
.\node_modules\.bin\openpayables.cmd project join my-project alice
.\node_modules\.bin\openpayables.cmd credit award my-project alice development large manual issue-123 author "Accepted work"
.\node_modules\.bin\openpayables.cmd credit balances my-project
.\node_modules\.bin\openpayables.cmd distribution preview my-project 2000
```

For a real repository-backed workflow, see `docs/OPERATOR_SETUP_v0.1.md` and `docs/CONTRIBUTOR_REVIEW_WORKFLOW_v0.1.md`. Repository setup requires the operator's own configured GitHub App and permitted installation; the existing shared Mightymetrika App is **not** generally available for other operators. GitHub candidates require explicit human approval before credits. For periodic pool accounting, see `docs/REVENUE_POOL_BASIS_v0.1.md`: operator attestation is not verified business income or provider funding. All distributions still need separately recorded TEST funding and approval; no LIVE settlement is supported.

## Acceptance on the development workstation

With `OPENPAYABLES_TEST_DATABASE_URL` set to the **dedicated** `openpayables_test` database, and `OPENPAYABLES_DATABASE_URL` pointing at the distinct development DB, run:

```powershell
npm run check
npm run test:integration
.\scripts\technical-preview-smoke.ps1
```

The final command compiles the project, packs its allowlisted files, installs the `.tgz` into a throwaway **external consumer folder**, launches installed `openpayables-migrate` and `openpayables` binaries, and checks a synthetic 8:3 contribution/governance flow plus a 2000-cent operator-attested revenue-pool approval. It tests packaging and standalone CLI behavior rather than replaying `tsx` from the repository. It writes **only synthetic, immutable test records** to `openpayables_test`, makes **no** GitHub or Stripe requests, and deletes its temporary local install afterward. Existing source/install files remain unchanged. No dummy PRs, recipient payouts or LIVE payments are created.

**Preview acceptance:** all unit/integration checks pass; installed tarball smoke passes; `git diff --check` passes; commit/push to `development` after reviewing output. A versioned GitHub prerelease can then be cut deliberately, attaching the generated `.tgz` and documenting that it is TEST-only. Do **not** merge to `main` or publish to npm without explicit authorization.

## Explicit stop line

The technical preview deliberately excludes: hosted operator registration, multi-tenant identity, browser dashboards, webhook routing for unrelated businesses, tax software, automated GitHub scoring, private-repo support, arbitrary project payments, and any LIVE Stripe key path. Completion of this packaging acceptance is sufficient for a **technical preview**. The separate production financial release still depends on Stripe eligibility, applicable legal/tax/operations approval, and genuine live transfer plus payout reconciliation, as specified in `docs/LIVE_PAYMENT_READINESS_v0.1.md`.
