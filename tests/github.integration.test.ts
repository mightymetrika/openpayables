import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/postgres/migrate.js";
import { OpenPayablesStore } from "../src/storage/postgres/repository.js";
import { OpenPayablesGitHub } from "../src/storage/postgres/github.js";
import type { GitHubCandidate, GitHubRepository } from "../src/github/discovery.js";

const url = process.env.OPENPAYABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("C7 GitHub evidence persistence (DEDICATED test DB)", () => {
  const pool = new Pool({ connectionString: url });
  const store = new OpenPayablesStore(pool);
  const github = new OpenPayablesGitHub(pool);
  const suffix = randomUUID().slice(0, 8);
  const projectId = `github-${suffix}`;
  const repo: GitHubRepository = { id: Number(`9${Date.now().toString().slice(-10)}`), fullName: `owner/repo-${suffix}`, private: false };
  const example = (kind: "pr_author" | "pr_reviewer", githubUserId: number, reviewIds: number[] = []): GitHubCandidate => {
    const base = {
      candidateKey: `pr:987:#{kind}:${githubUserId}`.replace("#{kind}", kind === "pr_author" ? "author" : "reviewer"),
      kind, pullId: 987, pullNumber: 12, githubUserId, githubLogin: `user-${githubUserId}`,
      title: "Accepted work", sourceUrl: `https://github.com/${repo.fullName}/pull/12`,
      mergedAt: "2026-11-17T18:00:00Z", reviewIds,
      lastReviewAt: kind === "pr_reviewer" ? "2026-11-17T17:00:00Z" : null,
    };
    return { ...base, fingerprint: createHash("sha256").update(JSON.stringify(base)).digest("hex") };
  };

  beforeAll(async () => {
    await migrate(pool);
    await store.createProject(projectId, "Public GitHub intake", "operator");
  });
  afterAll(async () => { await pool.end(); });

  it("registers one public repository idempotently, preventing silent re-binding", async () => {
    expect((await github.registerSource(projectId, repo, "operator")).registeredNow).toBe(true);
    expect((await github.registerSource(projectId, repo, "operator")).registeredNow).toBe(false);
    expect((await github.sources(projectId)).sources).toHaveLength(1);
    await expect(github.registerSource(projectId, { ...repo, id: repo.id + 1 }, "operator"))
      .rejects.toThrow(/conflict/);
    await expect(github.registerSource(projectId, { ...repo, fullName: "owner/renamed" }, "operator"))
      .rejects.toThrow(/conflict/);
    await expect(github.registerSource(projectId, { ...repo, private: true as false }, "operator"))
      .rejects.toThrow(/public/);
    expect(await github.requireSource(projectId, repo.fullName)).toMatchObject(repo);
  });

  it("imports author and reviewer evidence once without awarding points or creating obligations", async () => {
    const items = [example("pr_author", 10), example("pr_reviewer", 11, [101, 102])];
    expect(await github.importCandidates(projectId, repo, items)).toMatchObject({
      discovered: 2, newCandidates: 2, unchangedCandidates: 0,
      changedEvidence: 0, creditsAwarded: 0, paymentObligationsCreated: 0,
    });
    expect(await github.importCandidates(projectId, repo, items)).toMatchObject({
      discovered: 2, newCandidates: 0, unchangedCandidates: 2,
      changedEvidence: 0, creditsAwarded: 0,
    });
    const result = await github.candidates(projectId);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.some((x) => x.kind === "pr_reviewer" && x.reviewIds.length === 2)).toBe(true);
    const balances = await store.balances(projectId);
    expect(balances).toHaveLength(0);
    const obligations = await pool.query("SELECT COUNT(*)::INT AS n FROM openpayables.distribution_obligations WHERE project_id=$1", [projectId]);
    expect(obligations.rows[0].n).toBe(0);
  });

  it("detects source metadata changes without rewriting immutable evidence", async () => {
    const altered = { ...example("pr_author", 10), title: "Title changed upstream", fingerprint: "c".repeat(64) };
    expect(await github.importCandidates(projectId, repo, [altered])).toMatchObject({
      newCandidates: 0, unchangedCandidates: 0, changedEvidence: 1,
    });
    expect((await github.candidates(projectId)).candidates.find((x) => x.kind === "pr_author")?.title).toBe("Accepted work");
  });

  it("rolls back the whole batch on invalid candidates and refuses unregistered projects", async () => {
    const one = example("pr_author", 12);
    await expect(github.importCandidates(projectId, repo, [one, one])).rejects.toThrow(/Duplicate discovery/);
    const broken = { ...example("pr_reviewer", 22), kind: "invalid" as "pr_reviewer" };
    await expect(github.importCandidates(projectId, repo, [one, broken])).rejects.toThrow();
    expect((await github.candidates(projectId)).candidates).toHaveLength(2);
    await expect(github.importCandidates("unregistered", repo, [one])).rejects.toThrow();
    await expect(github.importCandidates(projectId, { ...repo, id: repo.id + 9 }, [one])).rejects.toThrow(/registration/);
  });
});
