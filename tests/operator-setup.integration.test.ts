import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/postgres/migrate.js";
import { OpenPayablesStore } from "../src/storage/postgres/repository.js";
import { OpenPayablesOperatorSetup } from "../src/operator/setup.js";
import type { OperatorGitHubAccess } from "../src/operator/setup.js";

const url = process.env.OPENPAYABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("C11 atomic operator setup (DEDICATED PostgreSQL test database)", () => {
  const pool = new Pool({ connectionString: url });
  const setup = new OpenPayablesOperatorSetup(pool);
  const store = new OpenPayablesStore(pool);
  const suffix = randomUUID().slice(0, 8);
  const project = `operator-c11-${suffix}`;
  const secondProject = `operator-c11-2-${suffix}`;
  const legacyProject = `operator-c11-legacy-${suffix}`;
  const repo = { id: 490000001, fullName: `sample/c11-${suffix}`, private: false as const };
  const access: OperatorGitHubAccess = {
    repository: async (requested) => {
      if (requested.toLowerCase() !== repo.fullName.toLowerCase()) throw new Error("Unexpected lookup");
      return repo;
    },
    authorizeRepository: async () => ({ appId: 1111, installationId: 2222, token: "ephemeral-stub" }),
  };
  beforeAll(async () => { await migrate(pool); });
  afterAll(async () => { await pool.end(); });

  it("creates the project, four default categories and exact App binding atomically", async () => {
    const result = await setup.setup(project, "Sample contribution project", repo.fullName, "operator-a", access);
    expect(result).toMatchObject({ projectId: project, createdNow: true, githubRepoId: repo.id,
      appId: 1111, installationId: 2222, creditsAwarded: 0, paymentObligationsCreated: 0 });
    const status = await setup.status(project);
    expect(status).toMatchObject({ operatorId: "operator-a", counts: { contributors: 0, candidates: 0,
      approvals: 0, linkedIdentities: 0, verifiedIdentities: 0 } });
    expect(status.githubSources).toHaveLength(1);
    expect(status.githubSources[0]!).toMatchObject({ installationRecorded: true, installationId: 2222 });
    const defaults = await pool.query("SELECT code FROM openpayables.categories WHERE project_id=$1", [project]);
    expect(defaults.rows.map((r) => r.code).sort()).toEqual(["development", "documentation", "review", "testing"]);
    expect(await store.creditHistory(project)).toHaveLength(0);
  });

  it("is idempotent for identical terms, with no duplicate repository or categories", async () => {
    const [a, b] = await Promise.all([
      setup.setup(project, "Sample contribution project", repo.fullName, "operator-a", access),
      setup.setup(project, "Sample contribution project", repo.fullName, "operator-a", access),
    ]);
    expect(a.createdNow).toBe(false);
    expect(b.createdNow).toBe(false);
    expect((await setup.status(project)).githubSources).toHaveLength(1);
    const rows = await pool.query("SELECT COUNT(*) AS n FROM openpayables.categories WHERE project_id=$1", [project]);
    expect(Number(rows.rows[0].n)).toBe(4);
  });

  it("rejects different operator, name or installation and preserves the accepted binding", async () => {
    await expect(setup.setup(project, "Different name", repo.fullName, "operator-a", access))
      .rejects.toThrow(/different name or operator/);
    await expect(setup.setup(project, "Sample contribution project", repo.fullName, "operator-b", access))
      .rejects.toThrow(/different name or operator/);
    const changed: OperatorGitHubAccess = { ...access,
      authorizeRepository: async () => ({ appId: 1111, installationId: 9999, token: "ephemeral" }) };
    await expect(setup.setup(project, "Sample contribution project", repo.fullName, "operator-a", changed))
      .rejects.toThrow(/incomplete or different GitHub setup/);
    expect((await setup.status(project)).githubSources[0]?.installationId).toBe(2222);
  });

  it("keeps a second operator's project separate even when tracking the same repo", async () => {
    const other: OperatorGitHubAccess = { ...access,
      authorizeRepository: async () => ({ appId: 1111, installationId: 3333, token: "different-operator-token" }) };
    const result = await setup.setup(secondProject, "Independent project", repo.fullName, "operator-b", other);
    expect(result).toMatchObject({ createdNow: true, installationId: 3333 });
    expect((await setup.status(project)).githubSources[0]?.installationId).toBe(2222);
    expect((await setup.status(secondProject)).githubSources[0]?.installationId).toBe(3333);
  });

  it("refuses to silently adopt an existing manually-created project", async () => {
    await store.createProject(legacyProject, "Legacy", "operator-a");
    await expect(setup.setup(legacyProject, "Legacy", repo.fullName, "operator-a", access))
      .rejects.toThrow(/incomplete or different GitHub setup/);
    const status = await setup.status(legacyProject);
    expect(status.githubSources).toEqual([]);
  });
});
