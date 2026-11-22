// Opt-in TEST-only hosted PostgreSQL acceptance; no provider or LIVE-money calls.
// Requires two credential-bearing environment URLs; never print or commit them.
import { randomUUID } from "node:crypto";
import { accessSync, constants } from "node:fs";
import console from "node:console";
import process from "node:process";
import { URL } from "node:url";
import { Pool } from "pg";
import { createPool } from "../dist/storage/postgres/connection.js";
import { OpenPayablesStore } from "../dist/storage/postgres/repository.js";
import { OpenPayablesFinance } from "../dist/storage/postgres/finance.js";
import { OpenPayablesReadOnly } from "../dist/integration/read.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function secureSupabaseUrl(raw, label) {
  assert(typeof raw === "string" && raw.length > 0, `Missing ${label}`);
  const url = new URL(raw);
  assert(["postgres:", "postgresql:"].includes(url.protocol), `Invalid ${label} protocol`);
  assert(url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".pooler.supabase.com"),
    `${label} must use a Supabase database host`);
  assert(url.pathname === "/postgres", `${label} must target a dedicated Supabase postgres database`);
  assert(url.searchParams.get("sslmode") === "verify-full", `${label} requires sslmode=verify-full`);
  const ca = url.searchParams.get("sslrootcert");
  assert(ca && ca.length > 0, `${label} requires a local sslrootcert file`);
  accessSync(ca, constants.R_OK);
  return raw;
}

async function probe(pool, expectedRole, readOnly) {
  const result = await pool.query(`SELECT current_user AS role,
    current_database() AS database,
    current_setting('default_transaction_read_only') AS default_read_only,
    (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS encrypted`);
  const r = result.rows[0];
  assert(r?.role === expectedRole && r?.database === "postgres", `Unexpected ${expectedRole} login/database`);
  assert(r.encrypted === true, `${expectedRole} has no database-side SSL`);
  if (readOnly) assert(r.default_read_only === "on", "Reader must default to read-only transactions");
}

if (process.env.OPENPAYABLES_SUPABASE_TEST_CONFIRM !== "YES_SYNTHETIC_TEST") {
  throw new Error("Set OPENPAYABLES_SUPABASE_TEST_CONFIRM=YES_SYNTHETIC_TEST before creating TEST-only records");
}

const operatorUrl = secureSupabaseUrl(process.env.OPENPAYABLES_SUPABASE_OPERATOR_URL, "operator URL");
const readerUrl = secureSupabaseUrl(process.env.OPENPAYABLES_SUPABASE_READER_URL, "reader URL");
process.env.OPENPAYABLES_POOL_MAX = "1";
const writerPool = createPool(operatorUrl);
const readerProbe = new Pool({ connectionString: readerUrl, max: 1 });
const reader = new OpenPayablesReadOnly(readerUrl);

try {
  await probe(writerPool, "openpayables_operator", false);
  await probe(readerProbe, "openpayables_app_ro", true);
  const permitted = (await readerProbe.query(`SELECT
    has_column_privilege(current_user,'openpayables.projects','id','SELECT') AS can_read,
    has_table_privilege(current_user,'openpayables.projects','INSERT') AS can_insert,
    has_table_privilege(current_user,'openpayables.credit_events','UPDATE') AS can_update,
    has_table_privilege(current_user,'openpayables.funding_events','SELECT') AS can_read_funding,
    has_schema_privilege(current_user,'openpayables','CREATE') AS can_create`)).rows[0];
  assert(permitted.can_read === true && permitted.can_insert === false &&
    permitted.can_update === false && permitted.can_read_funding === false &&
    permitted.can_create === false, "Reader permissions exceed the approved read-only contract");
  const writerAccess = (await writerPool.query(`SELECT
    has_table_privilege(current_user,'openpayables.projects','INSERT') AS can_insert,
    has_table_privilege(current_user,'openpayables.schema_migrations','INSERT') AS can_migrate,
    has_schema_privilege(current_user,'openpayables','CREATE') AS can_create`)).rows[0];
  assert(writerAccess.can_insert === true && writerAccess.can_migrate === false &&
    writerAccess.can_create === false, "Operator role permissions are incorrect");

  const suffix = randomUUID().slice(0, 8);
  const project = `supabase-smoke-${suffix}`;
  const alice = `smoke-alice-${suffix}`;
  const bob = `smoke-bob-${suffix}`;
  const operator = "hosted-test-only";
  const store = new OpenPayablesStore(writerPool);
  const finance = new OpenPayablesFinance(writerPool);
  await store.createProject(project, "Supabase synthetic TEST acceptance", operator);
  await store.createContributor(alice, "Synthetic Alice");
  await store.createContributor(bob, "Synthetic Bob");
  await store.joinProject(project, alice);
  await store.joinProject(project, bob);
  await store.award({ projectId: project, contributorId: alice, category: "development", size: "large",
    source: "supabase_test", sourceId: `test-${suffix}`, role: "author", reason: "Synthetic work", approvedBy: operator });
  await store.award({ projectId: project, contributorId: bob, category: "review", size: "medium",
    source: "supabase_test", sourceId: `test-${suffix}`, role: "reviewer", reason: "Synthetic review", approvedBy: operator });
  const vote = await store.openProposal(project, "Synthetic advisory question", "TEST only", operator);
  await store.castVote(vote.id, alice, "yes", operator);
  await store.castVote(vote.id, bob, "no", operator);
  const period = await finance.createPeriod(project, `test-${suffix}`, 1100, operator);
  await finance.addFunding(project, 1100, `synthetic-test-${suffix}`, operator);
  await finance.approvePeriod(period.id, operator);

  const summary = await reader.projectOverview(project);
  const pending = await reader.pendingEvidence(project);
  const a = await reader.contributorView(project, alice);
  const b = await reader.contributorView(project, bob);
  assert(summary.totalPoints === 11 && summary.contributorCount === 2 &&
    pending.pending.length === 0 && summary.readOnly, "Incorrect manager read model");
  assert(a.points === 8 && b.points === 3 && a.voting[0]?.choice === "yes" &&
    b.voting[0]?.choice === "no" && a.testDistributions[0]?.amountCents === 800 &&
    b.testDistributions[0]?.amountCents === 300 &&
    a.testDistributions[0]?.status === "held", "Incorrect contributor TEST read model");
  let scoped = false;
  try { await reader.contributorView(project, "unknown-contributor"); }
  catch (err) { scoped = /Contributor not found/.test(String(err)); }
  assert(scoped, "Expected project membership denial");
  console.log(`SUPABASE HOSTED TEST ACCEPTANCE PASS (synthetic project=${project})`);
  console.log("TLS confirmed, restricted operator/reader roles, 8:3 credits/vote, $8/$3 held TEST allocation.");
  console.log("No Stripe API call, bank payment, LIVE key, BlindStats change, or cleanup of immutable TEST records.");
} finally {
  await reader.close();
  await readerProbe.end();
  await writerPool.end();
}
