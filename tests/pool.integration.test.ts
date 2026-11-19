import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/postgres/migrate.js";
import { OpenPayablesStore } from "../src/storage/postgres/repository.js";
import { OpenPayablesFinance } from "../src/storage/postgres/finance.js";

const url = process.env.OPENPAYABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("C13 operator revenue-pool basis (DEDICATED PostgreSQL test DB)", () => {
  const pool = new Pool({ connectionString: url });
  const store = new OpenPayablesStore(pool);
  const finance = new OpenPayablesFinance(pool);
  const suffix = randomUUID().slice(0, 8);
  const project = `c13-${suffix}`;
  const other = `c13-other-${suffix}`;
  const alice = `c13-alice-${suffix}`;
  const bob = `c13-bob-${suffix}`;
  const inputs = { grossReceiptsCents: 10000, feeCents: 300,
    costCents: 1200, reserveCents: 500, contributorShareBasisPoints: 2500 };

  beforeAll(async () => {
    await migrate(pool);
    await store.createProject(project, "C13 revenue calculation", "operator");
    await store.createProject(other, "C13 independent project", "operator");
    await store.createContributor(alice, "C13 Alice");
    await store.createContributor(bob, "C13 Bob");
    await store.joinProject(project, alice);
    await store.joinProject(project, bob);
    await store.award({ projectId: project, contributorId: alice, category: "development",
      size: "large", source: "manual", sourceId: suffix, role: "author",
      reason: "Accepted", approvedBy: "operator" });
    await store.award({ projectId: project, contributorId: bob, category: "review",
      size: "medium", source: "manual", sourceId: suffix, role: "reviewer",
      reason: "Accepted", approvedBy: "operator" });
  });
  afterAll(async () => { await pool.end(); });

  it("creates a draft with immutable basis; existing TEST funding gate still controls approval", async () => {
    const draft = await finance.createRevenuePeriod(project, `revenue-${suffix}`, inputs,
      "policy-2026-v1", `receipt-ledger-${suffix}`, "operator");
    expect(draft.amount_cents).toBe("2000");
    expect(draft.basis).toMatchObject({ netCents: 8000, poolCents: 2000,
      policyReference: "policy-2026-v1" });
    const show = await finance.showPeriod(draft.id);
    expect(show.revenueBasis).toMatchObject({ netCents: 8000, poolCents: 2000,
      contributorShareBasisPoints: 2500, receiptReference: `receipt-ledger-${suffix}` });
    expect(show.obligations).toEqual([]);
    await expect(finance.approvePeriod(draft.id, "operator"))
      .rejects.toThrow(/Insufficient unreserved project funding/);
    await finance.addFunding(project, 2000, `test-funding-${suffix}`, "operator");
    const approved = await finance.approvePeriod(draft.id, "operator");
    expect(approved.allocations.map((x) => x.amountCents)).toEqual([1455, 545]);
    expect((await finance.showPeriod(draft.id)).revenueBasis?.policyReference).toBe("policy-2026-v1");
    await expect(finance.approvePeriod(draft.id, "operator")).rejects.toThrow(/already approved/);
    await expect(pool.query("UPDATE openpayables.distribution_pool_bases SET pool_cents=1 WHERE period_id=$1", [draft.id]))
      .rejects.toThrow(/immutable/);
  });

  it("rolls back invalid creation, prevents duplicate period labels, and isolates other projects", async () => {
    const name = `duplicate-${suffix}`;
    await expect(finance.createRevenuePeriod(project, name, { ...inputs, costCents: 20000 },
      "policy", "receipts", "operator")).rejects.toThrow();
    const fresh = await finance.createRevenuePeriod(project, name, inputs,
      "policy-v2", "receipt-2", "operator");
    await expect(finance.createRevenuePeriod(project, name, inputs,
      "policy-v3", "receipt-3", "operator")).rejects.toThrow();
    expect((await finance.showPeriod(fresh.id)).revenueBasis?.policyReference).toBe("policy-v2");
    const independent = await finance.createRevenuePeriod(other, name, inputs,
      "other-policy", "other-receipts", "operator");
    expect((await finance.showPeriod(independent.id)).revenueBasis?.policyReference).toBe("other-policy");
    await expect(finance.approvePeriod(independent.id, "operator"))
      .rejects.toThrow(/Insufficient unreserved project funding/);
  });
});
