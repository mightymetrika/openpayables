import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/postgres/migrate.js";
import { OpenPayablesStore } from "../src/storage/postgres/repository.js";
import { OpenPayablesFinance } from "../src/storage/postgres/finance.js";
import { OpenPayablesGitHub } from "../src/storage/postgres/github.js";
import type { GitHubCandidate, GitHubRepository } from "../src/github/discovery.js";

const url = process.env.OPENPAYABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("C8 candidate identity and approval to TEST dollar allocation (DEDICATED test DB)", () => {
  const pool = new Pool({ connectionString: url });
  const store = new OpenPayablesStore(pool);
  const github = new OpenPayablesGitHub(pool);
  const money = new OpenPayablesFinance(pool);
  const suffix = randomUUID().slice(0, 8);
  const project = `github-approve-${suffix}`;
  const alice = `alice-${suffix}`;
  const bob = `bob-${suffix}`;
  const repo: GitHubRepository = { id: Number(`8${Date.now().toString().slice(-10)}`), fullName: `owner/payable-${suffix}`, private: false };
  const createCandidate = (kind: "pr_author" | "pr_reviewer", githubUserId: number, pullId = 987): GitHubCandidate => {
    const keyRole = kind === "pr_author" ? "author" : "reviewer";
    const candidate = {
      candidateKey: `pr:${pullId}:${keyRole}:${githubUserId}`,
      kind, pullId, pullNumber: pullId === 987 ? 12 : 13,
      githubUserId, githubLogin: `user-${githubUserId}`,
      title: "Accepted GitHub contribution", sourceUrl: `https://github.com/${repo.fullName}/pull/12`,
      mergedAt: "2026-11-17T18:00:00Z",
      reviewIds: kind === "pr_reviewer" ? [101, 102] : [],
      lastReviewAt: kind === "pr_reviewer" ? "2026-11-17T17:00:00Z" : null,
    };
    return { ...candidate, fingerprint: createHash("sha256").update(JSON.stringify(candidate)).digest("hex") };
  };
  const author = createCandidate("pr_author", 10);
  const reviewer = createCandidate("pr_reviewer", 11);
  const unlinked = createCandidate("pr_author", 12);

  beforeAll(async () => {
    await migrate(pool);
    await store.createProject(project, "GitHub approval pilot", "operator");
    await store.createContributor(alice, "Alice");
    await store.createContributor(bob, "Bob");
    await store.joinProject(project, alice);
    await store.joinProject(project, bob);
    await github.registerSource(project, repo, "operator");
    await github.importCandidates(project, repo, [author, reviewer, unlinked]);
  });
  afterAll(async () => { await pool.end(); });

  it("does not award points until a candidate is explicitly approved and its identity is mapped", async () => {
    expect((await store.balances(project)).map((x) => x.points)).toEqual([0, 0]);
    await expect(github.approveCandidate(project, repo.id, author.candidateKey, "large", "Accepted", "operator"))
      .rejects.toThrow(/not linked/);
    await expect(github.linkIdentity(project, 99, alice, "operator"))
      .rejects.toThrow(/No discovered/);
    await expect(github.linkIdentity(project, 10, "non-member", "operator"))
      .rejects.toThrow(/belong/);
    expect((await store.creditHistory(project))).toHaveLength(0);
  });

  it("immutably associates stable GitHub IDs with project members and refuses conflicts", async () => {
    expect(await github.linkIdentity(project, 10, alice, "operator")).toMatchObject({
      githubUserId: 10, contributorId: alice, linkedNow: true,
    });
    expect(await github.linkIdentity(project, 10, alice, "operator")).toMatchObject({ linkedNow: false });
    expect(await github.linkIdentity(project, 11, bob, "operator")).toMatchObject({ linkedNow: true });
    await expect(github.linkIdentity(project, 10, bob, "operator")).rejects.toThrow(/already linked/);
    await expect(github.linkIdentity(project, 12, alice, "operator")).rejects.toThrow(/already linked/);
    const queue = await github.candidates(project);
    expect(queue.candidates.find((x) => x.candidateKey === author.candidateKey)?.linkedContributorId).toBe(alice);
    expect(queue.candidates.find((x) => x.candidateKey === unlinked.candidateKey)?.linkedContributorId).toBeNull();
  });

  it("awards 8 author and 3 reviewer points exactly once, with immutable approval evidence", async () => {
    const a = await github.approveCandidate(project, repo.id, author.candidateKey, "large", "Accepted feature", "operator");
    const b = await github.approveCandidate(project, repo.id, reviewer.candidateKey, "medium", "Substantive review", "operator");
    expect(a).toMatchObject({ approvedNow: true, contributorId: alice, category: "development", points: 8, paymentObligationsCreated: 0 });
    expect(b).toMatchObject({ approvedNow: true, contributorId: bob, category: "review", points: 3 });
    expect(await github.approveCandidate(project, repo.id, author.candidateKey, "large", "Accepted feature", "operator"))
      .toMatchObject({ approvedNow: false, awardId: a.awardId });
    await expect(github.approveCandidate(project, repo.id, author.candidateKey, "small", "Accepted feature", "operator"))
      .rejects.toThrow(/already approved/);
    await expect(github.approveCandidate(project, repo.id, author.candidateKey, "large", "Changed reason", "operator"))
      .rejects.toThrow(/already approved/);
    await expect(github.approveCandidate(project, repo.id + 1, author.candidateKey, "large", "Accepted feature", "operator"))
      .rejects.toThrow(/not found/);
    await expect(github.approveCandidate(project, repo.id, unlinked.candidateKey, "large", "Accepted feature", "operator"))
      .rejects.toThrow(/not linked/);
    expect((await store.balances(project)).map((x) => x.points)).toEqual([8, 3]);
    expect((await store.creditHistory(project))).toHaveLength(2);
    const queue = await github.candidates(project);
    expect(queue.candidates.find((x) => x.candidateKey === author.candidateKey)?.awardId).toBe(a.awardId);
    expect(queue.candidates.find((x) => x.candidateKey === author.candidateKey)?.approvedSize).toBe("large");
    await expect(pool.query("UPDATE openpayables.github_candidate_approvals SET award_size='small' WHERE credit_event_id=$1", [a.awardId]))
      .rejects.toThrow(/immutable/);
  });

  it("converts those approved GitHub credits to a conserved $8/$3 TEST distribution without sending money", async () => {
    await money.addFunding(project, 1100, `c8-test-${suffix}`, "operator");
    const period = await money.createPeriod(project, `c8-8to3-${suffix}`, 1100, "operator");
    const approved = await money.approvePeriod(period.id, "operator");
    expect(approved.allocations).toMatchObject([
      { contributorId: alice, points: 8, amountCents: 800 },
      { contributorId: bob, points: 3, amountCents: 300 },
    ]);
    const showed = await money.showPeriod(period.id);
    expect(showed.obligations).toHaveLength(2);
    expect(showed.obligations.every((x) => x.status === "held")).toBe(true);
    expect(showed.obligations.reduce((sum, x) => sum + x.amountCents, 0)).toBe(1100);
    expect((await money.fundingStatus(project)).remainingCents).toBe(0);
  });

  it("serializes simultaneous approvals of another candidate so at most one credit event is created", async () => {
    const next = createCandidate("pr_author", 10, 988);
    await github.importCandidates(project, repo, [next]);
    const attempts = await Promise.all([
      github.approveCandidate(project, repo.id, next.candidateKey, "small", "Accepted patch", "operator"),
      github.approveCandidate(project, repo.id, next.candidateKey, "small", "Accepted patch", "operator"),
    ]);
    expect(attempts.map((x) => x.approvedNow).sort()).toEqual([false, true]);
    expect(attempts[0]!.awardId).toBe(attempts[1]!.awardId);
    expect((await store.creditHistory(project))).toHaveLength(3);
    expect((await store.balances(project)).map((x) => x.points)).toEqual([9, 3]);
    await expect(pool.query("DELETE FROM openpayables.github_identity_links WHERE project_id=$1", [project]))
      .rejects.toThrow(/immutable/);
  });
});
