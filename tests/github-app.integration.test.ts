import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/postgres/migrate.js";
import { OpenPayablesStore } from "../src/storage/postgres/repository.js";
import { OpenPayablesGitHub } from "../src/storage/postgres/github.js";

const url = process.env.OPENPAYABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("C9 project-scoped GitHub App binding (DEDICATED test DB)", () => {
  const pool = new Pool({ connectionString: url });
  const store = new OpenPayablesStore(pool);
  const github = new OpenPayablesGitHub(pool);
  const suffix = randomUUID().slice(0, 8);
  const project = `app-c9-${suffix}`;
  const otherProject = `app-c9-other-${suffix}`;
  const repo = { id: Number(`8${Date.now().toString().slice(-10)}`), fullName: `example/app-${suffix}`, private: false as const };
  const binding = { appId: 1111, installationId: 2222 };

  beforeAll(async () => {
    await migrate(pool);
    await store.createProject(project, "C9 App binding", "operator");
    await store.createProject(otherProject, "C9 independent operator", "other-operator");
    await github.registerSource(project, repo, "operator");
  });
  afterAll(async () => { await pool.end(); });

  it("stores only verified installation metadata and supports idempotent same binding", async () => {
    expect(await github.appBinding(project, repo.id)).toBeNull();
    const one = await github.bindAppInstallation(project, repo, binding, "operator");
    expect(one).toMatchObject({ projectId: project, githubRepoId: repo.id,
      appId: 1111, installationId: 2222, boundNow: true });
    const again = await github.bindAppInstallation(project, repo, binding, "operator");
    expect(again).toMatchObject({ boundNow: false, boundBy: "operator" });
    const metadata = await github.appBinding(project, repo.id);
    expect(metadata).toMatchObject({ fullName: repo.fullName, appId: 1111, installationId: 2222 });
    expect(JSON.stringify(metadata)).not.toMatch(/token|privateKey|secret/);
  });

  it("never silently reassigns an installation or binds an unregistered repository", async () => {
    await expect(github.bindAppInstallation(project, repo, { appId: 1111, installationId: 9999 }, "operator"))
      .rejects.toThrow(/different immutable/);
    await expect(github.bindAppInstallation(project, repo, { appId: 9999, installationId: 2222 }, "operator"))
      .rejects.toThrow(/different immutable/);
    await expect(github.bindAppInstallation(project, { ...repo, id: repo.id + 1 }, binding, "operator"))
      .rejects.toThrow(/Register the exact/);
    await expect(github.bindAppInstallation(project, { ...repo, fullName: "example/other" }, binding, "operator"))
      .rejects.toThrow(/Register the exact/);
    expect((await github.appBinding(project, repo.id))?.installationId).toBe(binding.installationId);
  });

  it("keeps projects independent even when they track the same GitHub repository", async () => {
    expect(await github.appBinding(otherProject, repo.id)).toBeNull();
    await github.registerSource(otherProject, repo, "other-operator");
    const other = await github.bindAppInstallation(otherProject, repo, { appId: 1111, installationId: 3333 }, "other-operator");
    expect(other).toMatchObject({ installationId: 3333, boundNow: true });
    expect((await github.appBinding(project, repo.id))?.installationId).toBe(2222);
  });

  it("makes installed App metadata immutable at the database level", async () => {
    await expect(pool.query(
      `UPDATE openpayables.github_app_source_bindings SET installation_id=99999
       WHERE project_id=$1 AND github_repo_id=$2`, [project, repo.id],
    )).rejects.toThrow(/immutable/);
    await expect(pool.query(
      `DELETE FROM openpayables.github_app_source_bindings WHERE project_id=$1 AND github_repo_id=$2`,
      [project, repo.id],
    )).rejects.toThrow(/immutable/);
    expect((await github.appBinding(project, repo.id))?.installationId).toBe(2222);
  });
});
