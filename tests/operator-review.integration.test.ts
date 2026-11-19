import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/postgres/migrate.js";
import { OpenPayablesStore } from "../src/storage/postgres/repository.js";
import { OpenPayablesGitHub } from "../src/storage/postgres/github.js";
import { OpenPayablesContributorReview } from "../src/operator/review.js";
import type { GitHubCandidate, GitHubRepository } from "../src/github/discovery.js";

const url = process.env.OPENPAYABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("C12 contributor enrollment, pending review and money preview (dedicated test DB)", () => {
  const pool = new Pool({ connectionString: url });
  const store = new OpenPayablesStore(pool);
  const github = new OpenPayablesGitHub(pool);
  const workflow = new OpenPayablesContributorReview(pool);
  const suffix = randomUUID().slice(0, 8);
  const project = `c12-${suffix}`;
  const otherProject = `c12-other-${suffix}`;
  const alice = `c12-alice-${suffix}`;
  const bob = `c12-bob-${suffix}`;
  const third = `c12-third-${suffix}`;
  const repo: GitHubRepository = { id: Number(`5${Date.now().toString().slice(-10)}`),
    fullName: `example/c12-${suffix}`, private: false };
  const authorUser = 12001;
  const reviewerUser = 12002;
  const thirdUser = 12003;

  function evidence(kind: "pr_author" | "pr_reviewer", user: number, pullId = 54321): GitHubCandidate {
    const role = kind === "pr_author" ? "author" : "reviewer";
    const item = { candidateKey: `pr:${pullId}:${role}:${user}`, kind, pullId,
      pullNumber: pullId, githubUserId: user, githubLogin: `test-${user}`,
      title: `Merged pull request ${pullId}`, sourceUrl: `https://github.com/${repo.fullName}/pull/${pullId}`,
      mergedAt: "2026-11-18T10:00:00Z", reviewIds: kind === "pr_reviewer" ? [pullId + 1] : [],
      lastReviewAt: kind === "pr_reviewer" ? "2026-11-18T09:00:00Z" : null };
    return { ...item, fingerprint: createHash("sha256").update(JSON.stringify(item)).digest("hex") };
  }

  const author = evidence("pr_author", authorUser);
  const reviewer = evidence("pr_reviewer", reviewerUser);
  const unlinked = evidence("pr_author", thirdUser, 54322);

  beforeAll(async () => {
    await migrate(pool);
    await store.createProject(project, "C12 operator review", "operator-a");
    await store.createProject(otherProject, "Independent project", "operator-b");
    await github.registerSource(project, repo, "operator-a");
    await github.registerSource(otherProject, repo, "operator-b");
    await github.importCandidates(project, repo, [author, reviewer, unlinked]);
    await github.bindAppInstallation(project, repo, { appId: 5825297, installationId: 183507524 }, "operator-a");
  });
  afterAll(async () => { await pool.end(); });

  it("refuses unknown GitHub users without creating a contributor or membership", async () => {
    await expect(workflow.enroll(project, 999999, alice, "Alice", "operator-a"))
      .rejects.toThrow(/No discovered GitHub evidence/);
    const rows = await pool.query("SELECT 1 FROM openpayables.contributors WHERE id=$1", [alice]);
    expect(rows.rowCount).toBe(0);
    expect((await workflow.pending(project)).pending).toHaveLength(3);
    await expect(workflow.pending("not-a-project")).rejects.toThrow(/Project not found/);
  });

  it("atomically creates, joins and links; repeated enrollment is idempotent and conflicting links roll back", async () => {
    expect(await workflow.enroll(project, authorUser, alice, "Alice", "operator-a"))
      .toMatchObject({ contributorCreatedNow: true, joinedNow: true, linkedNow: true,
        identityVerified: false, creditsAwarded: 0 });
    expect(await workflow.enroll(project, authorUser, alice, "Alice", "operator-a"))
      .toMatchObject({ contributorCreatedNow: false, joinedNow: false, linkedNow: false });
    expect(await workflow.enroll(project, reviewerUser, bob, "Bob", "operator-a"))
      .toMatchObject({ linkedNow: true, identityVerified: false });
    await expect(workflow.enroll(project, authorUser, third, "Third", "operator-a"))
      .rejects.toThrow(/already linked differently/);
    await expect(workflow.enroll(project, thirdUser, alice, "Alice", "operator-a"))
      .rejects.toThrow(/already linked differently/);
    await expect(workflow.enroll(project, authorUser, alice, "Different Alice", "operator-a"))
      .rejects.toThrow(/different display name/);
    const orphan = await pool.query("SELECT 1 FROM openpayables.contributors WHERE id=$1", [third]);
    expect(orphan.rowCount).toBe(0);
    const membership = await pool.query(
      "SELECT contributor_id FROM openpayables.project_contributors WHERE project_id=$1", [project],
    );
    expect(membership.rows.map((x) => x.contributor_id).sort()).toEqual([alice, bob].sort());
  });

  it("shows pending candidates and verified/linked/unlinked status, then removes an approved item", async () => {
    await github.verifyIdentity(project, alice, authorUser, "test-12001", 5825297, "operator-a");
    const queue = await workflow.pending(project);
    expect(queue.pending).toHaveLength(3);
    expect(queue.pending.find((x) => x.candidateKey === author.candidateKey))
      .toMatchObject({ identityStatus: "verified", contributorId: alice, repository: repo.fullName });
    expect(queue.pending.find((x) => x.candidateKey === reviewer.candidateKey))
      .toMatchObject({ identityStatus: "operator_linked", contributorId: bob });
    expect(queue.pending.find((x) => x.candidateKey === unlinked.candidateKey))
      .toMatchObject({ identityStatus: "unlinked", contributorId: null });
    await expect(workflow.pending(project, -1)).rejects.toThrow(/Offset/);
    const approved = await github.approveCandidate(project, repo.id, author.candidateKey, "large", "Accepted implementation", "operator-a");
    expect(approved).toMatchObject({ approvedNow: true, points: 8, paymentObligationsCreated: 0 });
    const after = await workflow.pending(project);
    expect(after.pending).toHaveLength(2);
    expect(after.pending.some((x) => x.candidateKey === author.candidateKey)).toBe(false);
    expect(await workflow.enroll(project, authorUser, alice, "Alice", "operator-a"))
      .toMatchObject({ identityVerified: true, linkedNow: false });
  });

  it("previews exact 8:3 -> 800/300 cents without funding, obligations, or credit consumption", async () => {
    await github.approveCandidate(project, repo.id, reviewer.candidateKey, "medium", "Substantive review", "operator-a");
    const preview = await workflow.preview(project, 1100);
    expect(preview).toMatchObject({ hypotheticalPoolCents: 1100, allocatedCents: 1100,
      hypothetical: true, fundingVerified: false, paymentObligationsCreated: 0 });
    expect(preview.allocations).toMatchObject([
      { contributorId: alice, points: 8, amountCents: 800 },
      { contributorId: bob, points: 3, amountCents: 300 },
    ]);
    expect((await workflow.preview(project, 1100)).allocations).toEqual(preview.allocations);
    const counts = await pool.query(
      `SELECT (SELECT COUNT(*) FROM openpayables.funding_events WHERE project_id=$1) AS funding,
              (SELECT COUNT(*) FROM openpayables.distribution_periods WHERE project_id=$1) AS periods,
              (SELECT COUNT(*) FROM openpayables.distribution_obligations WHERE project_id=$1) AS obligations`,
      [project],
    );
    expect(counts.rows[0]).toMatchObject({ funding: "0", periods: "0", obligations: "0" });
    expect((await store.balances(project)).map((x) => x.points)).toEqual([8, 3]);
  });

  it("isolates independent projects and paginates more than 50 pending candidates", async () => {
    const more = Array.from({ length: 52 }, (_, i) => evidence("pr_author", authorUser, 60000 + i));
    await github.importCandidates(otherProject, repo, more);
    const first = await workflow.pending(otherProject);
    expect(first.pending).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(50);
    const second = await workflow.pending(otherProject, 50);
    expect(second.pending).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    expect(second.nextOffset).toBeNull();
    expect(first.pending[0]?.identityStatus).toBe("unlinked");
    await expect(workflow.preview(otherProject, 1100)).rejects.toThrow(/positive contribution credits/);
    expect(await workflow.enroll(otherProject, authorUser, third, "Third", "operator-b"))
      .toMatchObject({ linkedNow: true, contributorCreatedNow: true });
    expect((await workflow.pending(project)).pending).toHaveLength(1);
    expect((await workflow.pending(otherProject)).pending[0]?.contributorId).toBe(third);
  });
});
