import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/postgres/migrate.js";
import { OpenPayablesStore } from "../src/storage/postgres/repository.js";
import { OpenPayablesFinance } from "../src/storage/postgres/finance.js";
import { OpenPayablesReadOnly } from "../src/integration/read.js";

const url = process.env.OPENPAYABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("read-only host application integration (dedicated TEST database)", () => {
  const pool = new Pool({ connectionString: url });
  const store = new OpenPayablesStore(pool);
  const finance = new OpenPayablesFinance(pool);
  const reader = new OpenPayablesReadOnly(url!);
  const suffix = randomUUID().slice(0, 8);
  const projectId = `read-${suffix}`;
  const otherProject = `read-other-${suffix}`;
  const alice = `read-alice-${suffix}`;
  const bob = `read-bob-${suffix}`;

  beforeAll(async () => {
    await migrate(pool);
    await store.createProject(projectId, "Read-only pilot", "pilot-operator");
    await store.createProject(otherProject, "Unrelated project", "other-operator");
    await store.createContributor(alice, "Alice");
    await store.createContributor(bob, "Bob");
    await store.joinProject(projectId, alice);
    await store.joinProject(projectId, bob);
    await store.joinProject(otherProject, alice);
    await store.award({ projectId, contributorId: alice, category: "development", size: "large",
      source: "manual", sourceId: `pilot-${suffix}`, role: "author", reason: "Accepted implementation", approvedBy: "pilot-operator" });
    await store.award({ projectId, contributorId: bob, category: "review", size: "medium",
      source: "manual", sourceId: `pilot-${suffix}`, role: "reviewer", reason: "Accepted review", approvedBy: "pilot-operator" });
    await store.award({ projectId: otherProject, contributorId: alice, category: "documentation", size: "small",
      source: "manual", sourceId: `elsewhere-${suffix}`, role: "author", reason: "Other project's work", approvedBy: "other-operator" });
    const proposal = await store.openProposal(projectId, "Scope review", "Advisory", "pilot-operator");
    await store.castVote(String(proposal.id), alice, "yes", "pilot-operator");
    const period = await finance.createPeriod(projectId, `pilot-period-${suffix}`, 1100, "pilot-operator");
    await finance.addFunding(projectId, 1100, `pilot-test-funds-${suffix}`, "pilot-operator");
    await finance.approvePeriod(String(period.id), "pilot-operator");
  });

  afterAll(async () => {
    await reader.close();
    await pool.end();
  });

  it("shows one project's manager summary and verified read-only pending queue", async () => {
    const overview = await reader.projectOverview(projectId);
    expect(overview).toMatchObject({ projectId, contributorCount: 2, totalPoints: 11,
      pendingEvidenceCount: 0, readOnly: true });
    expect(overview.balances).toEqual([
      { contributorId: alice, displayName: "Alice", points: 8 },
      { contributorId: bob, displayName: "Bob", points: 3 },
    ]);
    expect((await reader.pendingEvidence(projectId)).pending).toEqual([]);
    expect(await reader.projectOverview(otherProject)).toMatchObject({
      projectId: otherProject, contributorCount: 1, totalPoints: 1,
    });
  });

  it("returns only the server-selected contributor's credits, vote and TEST allocation", async () => {
    const dashboard = await reader.contributorView(projectId, alice);
    expect(dashboard).toMatchObject({ projectId, contributorId: alice, points: 8, readOnly: true });
    expect(dashboard.recentCredits).toHaveLength(1);
    expect(dashboard.recentCredits[0]).toMatchObject({ pointsDelta: 8, reason: "Accepted implementation" });
    expect(dashboard.voting).toHaveLength(1);
    expect(dashboard.voting[0]).toMatchObject({ title: "Scope review", weight: 8, choice: "yes" });
    expect(dashboard.testDistributions).toHaveLength(1);
    expect(dashboard.testDistributions[0]).toMatchObject({ amountCents: 800, points: 8, status: "held" });
    expect(dashboard.paymentNotice).toMatch(/TEST-mode/);
    expect((await reader.contributorView(projectId, bob)).testDistributions[0])
      .toMatchObject({ amountCents: 300, points: 3, status: "held" });
    expect((await reader.contributorView(otherProject, alice)).recentCredits[0])
      .toMatchObject({ pointsDelta: 1 });
    expect((await reader.contributorView(otherProject, alice)).testDistributions).toEqual([]);
  });

  it("denies nonmembers and unknown projects and does not create financial records", async () => {
    await expect(reader.contributorView(otherProject, bob))
      .rejects.toThrow(/Contributor not found in project/);
    await expect(reader.contributorView(projectId, "not-a-member"))
      .rejects.toThrow(/Contributor not found in project/);
    await expect(reader.projectOverview("unknown-project"))
      .rejects.toThrow(/Project not found/);
    await expect(reader.pendingEvidence(projectId, -1)).rejects.toThrow(/Offset/);
    const attemptCount = await pool.query(
      `SELECT COUNT(*)::INT AS count FROM openpayables.payment_attempts a
       JOIN openpayables.distribution_obligations o ON o.id=a.obligation_id
       WHERE o.project_id=$1`, [projectId],
    );
    expect(attemptCount.rows[0].count).toBe(0);
  });
});
