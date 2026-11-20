# OpenPayables application integration — BlindStats read-only pilot

**Status (2026-11-20):** OpenPayables `0.2.0-alpha.2` application-read candidate **Windows validated (135/135 distinct tests, 43/43 dedicated PostgreSQL tests, installed-tarball smoke PASS)**, but not yet committed or released. **No BlindStats source, database, migration, or deployment is changed by this OpenPayables patch.** The published `v0.2.0-alpha.1` tarball is CLI-only and **does not include** `openpayables/read`.

## Purpose and precise boundary

The new `openpayables/read` server-only module is one reusable application-facing boundary. The existing OpenPayables PostgreSQL database and business rules remain authoritative. It can provide:

| Reader method | Host-authorized audience | Data |
| --- | --- | --- |
| `projectOverview(projectId)` | Project manager | Project name, named contributor credit balances, total credits, unapproved evidence count |
| `pendingEvidence(projectId, offset)` | Project manager | Existing paginated GitHub evidence queue with identity-verification status |
| `contributorView(projectId, contributorId)` | The specifically mapped contributor | Their own credited/reversed events, frozen advisory vote weights and their ballot choices, their TEST-mode approved allocations |

These methods use parameterized PostgreSQL **SELECT** statements or delegate to the existing read-only C12 queue. No credit approvals, governance votes, funding entries, distribution approvals, Stripe calls, payment transfers, schema migrations, or GitHub API requests occur.

**This is not an authenticated API server.** The module trusts the host to enforce authorization before invoking it. Do **not** put the PostgreSQL connection string, returned manager data, the reader object, or privileged data in browser JavaScript or a public endpoint. A database role granted `SELECT` only on the needed OpenPayables relations is recommended for browser-facing host processes. Do not share BlindStats' Supabase database or keys with OpenPayables.

## BlindStats pilot contract (not yet wired)

BlindStats currently authenticates with Supabase (`auth.getClaims()`) and authorizes Study operations through `study_capabilities` with RLS. Those capabilities are defined for research workflows and **do not establish authorization over OpenPayables projects or compensation**. The v40 development source is simultaneously evolving in another chat, with Supabase development migrations pending. Do not modify the blinding or study workflow as part of this pilot.

A safe first Browser pilot can be an additive **read-only** page in BlindStats, deployed only when the two explicit server-side mappings below exist:

1. **Project authorization:** A server-controlled record/configuration associates a known BlindStats pilot Study or organization with an OpenPayables project **and** explicitly grants selected BlindStats users manager access to that OpenPayables project. A Study manager capability alone is not enough to grant financial management. Do not accept a project ID supplied by a browser as authorization.
2. **Contributor identity:** A server-controlled mapping associates an authenticated Supabase user UUID with the corresponding OpenPayables project/contributor pair. It must be explicitly established and verified, not inferred from a display name or email and not taken from a URL or a form field. A user without a mapping sees no contributor data.

For the first pilot, the manager can view balances and pending review evidence, while a contributor can view **only their own** credits, votes and TEST allocations. Any future manager approval action requires a separate explicit OpenPayables authorization rule and must invoke the existing audited approval method; no approval functionality ships in this read-only slice. Avoid using a generic service-role Supabase key as evidence of user permissions.

## Server-side usage after a tested `0.2.0-alpha.2` tarball exists

Install the versioned OpenPayables tarball as a dependency in the adopting server application (Node 24+). Do not depend on unreleased source checkouts. Set a **dedicated** operator-owned PostgreSQL DSN on the **server only** and create a long-lived reader instance in a server-only module, not inside a client component.

```typescript
// Example shape for an application server; NOT a BlindStats patch.
import { OpenPayablesReadOnly } from "openpayables/read";

const connectionString = process.env.OPENPAYABLES_DATABASE_URL;
if (!connectionString) throw new Error("OpenPayables server DSN is required");
export const openpayablesReader = new OpenPayablesReadOnly(connectionString);

// In a Next.js Server Component/route handler ONLY, after validating Supabase
// claims and checking a server-owned, explicit OpenPayables project permission:
// const project = authorizedOpenPayablesProjectForThisUser(...);
// const overview = await openpayablesReader.projectOverview(project);
// const pending = await openpayablesReader.pendingEvidence(project);
// For contributor views, resolve `contributorId` from a trusted server mapping:
// const mine = await openpayablesReader.contributorView(project, contributorId);
```

Close the reader on server shutdown if the hosting environment supports shutdown hooks; avoid creating one new pool per page request. Never ship `OPENPAYABLES_DATABASE_URL` in `NEXT_PUBLIC_*` variables. Follow least-privilege PostgreSQL permissions. Sensitive financial operations and production payouts remain out of scope.

## Release sequencing / stop condition

1. **Windows acceptance complete (2026-11-20):** 92 unit + 43 PostgreSQL test cases passed (135 distinct), lint/build passed, and an independent installed-tarball smoke test imported `openpayables/read` and read synthetic balances, votes and TEST distributions. Stage/commit/push the seven accepted files to `development` only; leave the published `v0.2.0-alpha.1` unchanged.
2. Publish a separate prerelease `v0.2.0-alpha.2` **only after** the accepted `development` Git commit/push, retaining `private: true` to prevent accidental npm registry publication.
3. Recheck the latest BlindStats `development` export and its Git state. Apply a separate, small additive read-only pilot page with server-controlled project/contributor authorization. Do not overlay a stale BlindStats export or touch current blinding files, migration queues, `main`, or Production.
4. Stop the integration slice once an authenticated manager and an explicitly mapped contributor can read only the intended project data. Do not build a new web framework, duplicate OpenPayables financial logic, or add live payment operations merely to continue the checkpoint.

**Accounting caveat:** an approved OpenPayables distribution is a TEST-only ledger allocation. `transferred` means a Stripe Connect transfer to a connected account, not confirmed bank settlement, and there is no guarantee of payment or legally accrued earnings.
