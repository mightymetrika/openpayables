import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/postgres/migrate.js";
import { OpenPayablesStore } from "../src/storage/postgres/repository.js";
import { LivePilotLedger } from "../src/storage/postgres/live-pilot.js";
import type { LivePilotEvidence } from "../src/payments/stripe/live-readiness.js";

const url = process.env.OPENPAYABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("Isolated first-payout approval (synthetic evidence only)", () => {
  const pool = new Pool({ connectionString: url });
  const credits = new OpenPayablesStore(pool);
  const ledger = new LivePilotLedger(pool, "pilot_test");
  const suffix = randomUUID().replace(/-/g, "");
  const projectId = `pilot-${suffix}`;
  const contributorId = `contributor-${suffix}`;
  const recipientId = `acct_recipient${suffix}`;
  const topupId = `tu_${suffix}`;
  const platformAccountId = `acct_platform${suffix}`;
  const input = { projectId, contributorId, recipientId, topupId, amountCents: 500, authorizationReference: "synthetic-approval" };
  const evidence: LivePilotEvidence = {
    platformAccountId, country: "US", transfersCapability: "active", usdAvailableCents: 1000,
    receiptNetCents: 900, safeToExecuteTransfer: false, note: "synthetic only",
    recipient: { accountId: recipientId, country: "US", transfersCapability: "active", payoutsEnabled: true, transfersAndPayoutsAppearEnabled: true },
    topup: { id: topupId, currency: "usd", amountCents: 1000, balanceTransactionId: `txn_${suffix}`, status: "succeeded" },
  };
  const provider = { inspectPilot: vi.fn(async () => evidence) };
  beforeAll(async () => {
    // Do not migrate or write to any database except the dedicated local test database.
    const result = await pool.query("SELECT current_database() AS db");
    if (result.rows[0].db !== "openpayables_test") throw new Error("Dedicated openpayables_test required");
    await migrate(pool);
    await credits.createProject(projectId, "Synthetic pilot", "operator");
    await credits.createContributor(contributorId, "Synthetic contributor");
    await credits.joinProject(projectId, contributorId);
    await credits.award({projectId, contributorId, category:"development", size:"large", source:"github", sourceId:suffix, role:"author", reason:"Synthetic fixture", approvedBy:"operator"});
  });
  afterAll(async () => { await pool.end(); });

  it("refuses LIVE mode against TEST DB before inspecting Stripe", async () => {
    const unused = { inspectPilot: vi.fn(async () => evidence) };
    await expect(new LivePilotLedger(pool).approve(input, unused)).rejects.toThrow(/dedicated non-admin/);
    expect(unused.inspectPilot).not.toHaveBeenCalled();
  });
  it("rejects cap violations, insufficient or mismatched evidence, and wrong contributor", async () => {
    await expect(ledger.approve({...input, amountCents:2501}, provider)).rejects.toThrow(/maximum 2500/);
    for (const observed of [{...evidence, receiptNetCents:499}, {...evidence, usdAvailableCents:499}, {...evidence, platformAccountId:recipientId}]) {
      await expect(ledger.approve(input, {inspectPilot: async () => observed})).rejects.toThrow(/insufficient or mismatched/);
    }
    await expect(ledger.approve({...input, contributorId:"wrong"}, provider)).rejects.toThrow(/exactly one positive-credit/);
    expect(await ledger.show(projectId)).toBeNull();
  });
  it("atomically freezes one approval under concurrent requests without TEST funding records", async () => {
    const results = await Promise.allSettled([ledger.approve(input, provider), ledger.approve(input, provider)]);
    expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
    const row = await ledger.show(projectId);
    expect(row).toMatchObject({ mode:"pilot_test", project_id:projectId, contributor_id:contributorId, points:"8", amount_cents:500, platform_account_id:platformAccountId, recipient_account_id:recipientId, topup_id:topupId });
    const check = await pool.query("SELECT count(*)::int AS count FROM openpayables.funding_events WHERE project_id=$1", [projectId]);
    expect(check.rows[0].count).toBe(0);
    await expect(pool.query(`INSERT INTO openpayables.live_pilot_approvals
      (id,mode,project_id,contributor_id,points,amount_cents,platform_account_id,recipient_account_id,
       topup_id,balance_transaction_id,receipt_net_cents,observed_available_cents,authorization_reference)
      VALUES($1,'live',$2,$3,8,500,$4,$5,$6,$7,900,1000,'synthetic guard')`,
    [randomUUID(), projectId, contributorId, platformAccountId, recipientId, topupId, `txn_${suffix}`])).rejects.toThrow(/dedicated LIVE database/);
    await expect(pool.query("UPDATE openpayables.live_pilot_approvals SET amount_cents=1 WHERE id=$1", [row.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("DELETE FROM openpayables.live_pilot_approvals WHERE id=$1", [row.id])).rejects.toThrow(/immutable/);
  });
  it("rejects a second positive-credit contributor rather than arbitrarily selecting a payee", async () => {
    const second = `second-${suffix}`;
    await credits.createContributor(second, "Synthetic second contributor");
    await credits.joinProject(projectId, second);
    await credits.award({projectId, contributorId:second, category:"review", size:"medium", source:"github", sourceId:suffix, role:"reviewer", reason:"Synthetic fixture", approvedBy:"operator"});
    await expect(ledger.approve(input, provider)).rejects.toThrow(/exactly one positive-credit/);
  });
});
