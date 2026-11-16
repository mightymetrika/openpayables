import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/postgres/migrate.js";
import { OpenPayablesStore } from "../src/storage/postgres/repository.js";

const url = process.env.OPENPAYABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("real PostgreSQL integration (dedicated TEST database only)", () => {
  const pool = new Pool({ connectionString: url });
  const store = new OpenPayablesStore(pool);
  const suffix = randomUUID().slice(0, 8);
  const projectId = `test-${suffix}`;
  const alice = `alice-${suffix}`;
  const bob = `bob-${suffix}`;
  let largeAwardId = "";
  let proposalId = "";

  beforeAll(async () => {
    await migrate(pool);
    await store.createProject(projectId, "Integration test project", "test-operator");
    await store.createContributor(alice, "Alice");
    await store.createContributor(bob, "Bob");
    await store.joinProject(projectId, alice);
    await store.joinProject(projectId, bob);
  });

  afterAll(async () => {
    // Intentional: immutable historical records are retained in this disposable TEST database.
    await pool.end();
  });

  it("persists two approved awards and rejects duplicates", async () => {
    const award = await store.award({ projectId, contributorId: alice, category: "development", size: "large",
      source: "github", sourceId: `example/repo#${suffix}`, role: "author", reason: "Accepted implementation", approvedBy: "test-operator" });
    largeAwardId = String(award.id);
    await store.award({ projectId, contributorId: bob, category: "review", size: "medium",
      source: "github", sourceId: `example/repo#${suffix}`, role: "reviewer", reason: "Substantive review", approvedBy: "test-operator" });
    await expect(store.award({ projectId, contributorId: alice, category: "development", size: "large",
      source: "github", sourceId: `example/repo#${suffix}`, role: "author", reason: "Duplicate", approvedBy: "test-operator" })).rejects.toThrow();
    expect((await store.balances(projectId)).map((x) => x.points)).toEqual([8, 3]);
  });

  it("locks voting weights at opening even when credits change", async () => {
    const proposal = await store.openProposal(projectId, "Adopt next priority", "Advisory vote", "test-operator");
    proposalId = String(proposal.id);
    await store.award({ projectId, contributorId: alice, category: "testing", size: "small",
      source: "manual", sourceId: `test-${suffix}`, role: "tester", reason: "Verified test", approvedBy: "test-operator" });
    await store.castVote(proposalId, alice, "yes", "test-operator");
    await store.castVote(proposalId, bob, "no", "test-operator");
    await expect(store.castVote(proposalId, alice, "yes", "test-operator")).rejects.toThrow();
    expect((await store.tallyProposal(proposalId)).tally).toEqual({
      yes: 8, no: 3, abstain: 0, uncast: 0, eligibleWeight: 11, castWeight: 11, voterCount: 2,
    });
    await store.closeProposal(proposalId, "test-operator");
    await expect(store.castVote(proposalId, bob, "yes", "test-operator")).rejects.toThrow(/not open/);
  });

  it("reverses an award through a new immutable event", async () => {
    await store.reverseAward(largeAwardId, "Original award later invalidated", "test-operator");
    await expect(store.reverseAward(largeAwardId, "Duplicate reversal", "test-operator")).rejects.toThrow();
    expect((await store.balances(projectId)).map((x) => x.points)).toEqual([1, 3]);
    const history = await store.creditHistory(projectId);
    expect(history.some((event) => event.event_type === "reversal")).toBe(true);
  });
});
