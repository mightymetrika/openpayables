import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/postgres/migrate.js";
import { OpenPayablesGitHub } from "../src/storage/postgres/github.js";
import { OpenPayablesStore } from "../src/storage/postgres/repository.js";
import type { GitHubCandidate, GitHubRepository } from "../src/github/discovery.js";

const url = process.env.OPENPAYABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("C10 verified contributor identity (DEDICATED PostgreSQL test database)", () => {
  const pool = new Pool({ connectionString: url });
  const store = new OpenPayablesStore(pool);
  const github = new OpenPayablesGitHub(pool);
  const suffix = randomUUID().slice(0, 8);
  const project = `github-c10-${suffix}`;
  const contributor = `contributor-${suffix}`;
  const repo: GitHubRepository = { id: 890000000, fullName: `example/c10-${suffix}`, private: false };
  const appId = 5825297;
  const githubUserId = 432123;
  const candidateData = { candidateKey: `pr:700:author:${githubUserId}`, kind: "pr_author" as const,
    pullId: 700, pullNumber: 4, githubUserId, githubLogin: "sample-dev",
    title: "Accepted feature", sourceUrl: `https://github.com/${repo.fullName}/pull/4`,
    mergedAt: "2026-11-18T12:00:00Z", reviewIds: [] as number[], lastReviewAt: null };
  const candidate: GitHubCandidate = { ...candidateData,
    fingerprint: createHash("sha256").update(JSON.stringify(candidateData)).digest("hex") };

  beforeAll(async () => {
    await migrate(pool);
    await store.createProject(project, "Identity verification test", "operator");
    await store.createContributor(contributor, "Contributor");
    await store.joinProject(project, contributor);
    await github.registerSource(project, repo, "operator");
    await github.importCandidates(project, repo, [candidate]);
    await github.linkIdentity(project, githubUserId, contributor, "operator");
    await github.bindAppInstallation(project, repo, { appId, installationId: 183507524 }, "operator");
  });
  afterAll(async () => { await pool.end(); });

  it("begins with an operator-attested link, not a verified user", async () => {
    expect(await github.identityStatus(project, contributor)).toMatchObject({
      projectId: project, contributorId: contributor, githubUserId, linked: true, verified: false,
    });
    const queue = await github.candidates(project);
    expect(queue.candidates[0]).toMatchObject({ linkedContributorId: contributor, identityVerifiedAt: null });
  });

  it("rejects a different authenticated GitHub account, unknown contributor, or wrong App", async () => {
    await expect(github.verifyIdentity(project, contributor, 999999, "wrong-user", appId, "operator"))
      .rejects.toThrow(/does not match/);
    await expect(github.verifyIdentity(project, "unknown", githubUserId, "sample-dev", appId, "operator"))
      .rejects.toThrow(/Link an existing/);
    await expect(github.verifyIdentity(project, contributor, githubUserId, "sample-dev", 777777, "operator"))
      .rejects.toThrow(/App is not bound/);
    expect((await github.identityStatus(project, contributor)).verified).toBe(false);
  });

  it("stores an immutable one-time account-control record, without issuing credits", async () => {
    const result = await github.verifyIdentity(project, contributor, githubUserId, "sample-dev", appId, "operator");
    expect(result).toMatchObject({ verifiedNow: true, githubUserId, contributorId: contributor,
      appId, verificationMethod: "github_app_device_flow", creditsAwarded: 0,
      paymentObligationsCreated: 0 });
    const status = await github.identityStatus(project, contributor);
    expect(status).toMatchObject({ linked: true, verified: true, githubUserId,
      githubLoginAtVerification: "sample-dev", verifiedAppId: appId });
    expect((await github.candidates(project)).candidates[0]?.identityVerifiedAt).toBeTruthy();
    expect(await store.creditHistory(project)).toHaveLength(0);
    await expect(pool.query("DELETE FROM openpayables.github_identity_verifications WHERE project_id=$1", [project]))
      .rejects.toThrow(/immutable/);
  });

  it("is idempotent under concurrent verifications and refuses unauthorized reassignment", async () => {
    const results = await Promise.all([
      github.verifyIdentity(project, contributor, githubUserId, "sample-dev", appId, "operator"),
      github.verifyIdentity(project, contributor, githubUserId, "sample-dev", appId, "operator"),
    ]);
    expect(results.every((r) => !r.verifiedNow)).toBe(true);
    await expect(github.verifyIdentity(project, contributor, githubUserId, "sample-dev", appId + 1, "operator"))
      .rejects.toThrow(/not bound/);
    const rows = await pool.query("SELECT * FROM openpayables.github_identity_verifications WHERE project_id=$1", [project]);
    expect(rows.rowCount).toBe(1);
  });
});
