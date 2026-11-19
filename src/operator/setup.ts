/** C11: atomic, one-command onboarding for a public GitHub project.
 * GitHub is checked before any PostgreSQL write. No credentials enter the DB.
 */
import type { Pool, PoolClient } from "pg";
import { parsePublicRepository } from "../github/discovery.js";
import type { GitHubRepository } from "../github/discovery.js";
import type { GitHubAppSession } from "../github/app.js";

export interface OperatorGitHubAccess {
  repository(fullName: string): Promise<GitHubRepository>;
  authorizeRepository(repo: GitHubRepository): Promise<GitHubAppSession>;
}

function nonblank(input: string, label: string): string {
  if (typeof input !== "string" || !input.trim()) throw new Error(`${label} must be nonblank`);
  return input.trim();
}

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label}`);
  return value;
}

const CATEGORIES = [
  ["development", "Accepted implementation and bug fixes"],
  ["documentation", "Project documentation"],
  ["testing", "Quality assurance and testing"],
  ["review", "Substantive technical review"],
] as const;

export class OpenPayablesOperatorSetup {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const result = await fn(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  /** Repeats with identical terms return the same project. A conflict never changes records. */
  async setup(project: string, projectName: string, repository: string,
    operator: string, access: OperatorGitHubAccess) {
    const projectId = nonblank(project, "project ID");
    const name = nonblank(projectName, "project name");
    const actor = nonblank(operator, "operator");
    const requested = parsePublicRepository(repository).fullName;

    // All remote operations precede the database transaction. Never hold a DB
    // lock while asking GitHub for an installation token.
    const repo = await access.repository(requested);
    positiveId(repo.id, "GitHub repository ID");
    if (repo.private !== false ||
        parsePublicRepository(repo.fullName).fullName.toLowerCase() !== requested.toLowerCase()) {
      throw new Error("GitHub repository identity differs from the requested public repository");
    }
    const authorized = await access.authorizeRepository(repo);
    const appId = positiveId(authorized.appId, "GitHub App ID");
    const installationId = positiveId(authorized.installationId, "GitHub installation ID");
    if (typeof authorized.token !== "string" || !authorized.token) {
      throw new Error("GitHub App installation authentication did not return an access token");
    }

    return this.transaction(async (db) => {
      const inserted = await db.query(
        `INSERT INTO openpayables.projects(id,name,created_by) VALUES($1,$2,$3)
         ON CONFLICT DO NOTHING RETURNING id`, [projectId, name, actor],
      );
      if (inserted.rowCount === 1) {
        for (const [code, description] of CATEGORIES) {
          await db.query(
            `INSERT INTO openpayables.categories(project_id,code,description,created_by)
             VALUES($1,$2,$3,$4)`, [projectId, code, description, actor],
          );
        }
        await db.query(
          `INSERT INTO openpayables.github_sources(project_id,github_repo_id,full_name,registered_by)
           VALUES($1,$2,$3,$4)`, [projectId, repo.id, repo.fullName, actor],
        );
        await db.query(
          `INSERT INTO openpayables.github_app_source_bindings
           (project_id,github_repo_id,app_id,installation_id,bound_by)
           VALUES($1,$2,$3,$4,$5)`, [projectId, repo.id, appId, installationId, actor],
        );
      } else {
        const existing = await db.query(
          `SELECT name,created_by FROM openpayables.projects WHERE id=$1 FOR UPDATE`, [projectId],
        );
        if (existing.rowCount !== 1 || existing.rows[0].name !== name ||
            existing.rows[0].created_by !== actor) {
          throw new Error("Project ID already exists with different name or operator; no changes made");
        }
        const sources = await db.query(
          `SELECT s.github_repo_id,s.full_name,b.app_id,b.installation_id
           FROM openpayables.github_sources s
           LEFT JOIN openpayables.github_app_source_bindings b
           ON b.project_id=s.project_id AND b.github_repo_id=s.github_repo_id
           WHERE s.project_id=$1`, [projectId],
        );
        if (sources.rowCount !== 1 || Number(sources.rows[0].github_repo_id) !== repo.id ||
            String(sources.rows[0].full_name).toLowerCase() !== repo.fullName.toLowerCase() ||
            Number(sources.rows[0].app_id) !== appId ||
            Number(sources.rows[0].installation_id) !== installationId) {
          throw new Error("Project already exists with incomplete or different GitHub setup; use existing CLI commands");
        }
      }
      return { projectId, name, operatorId: actor, githubRepoId: repo.id,
        githubRepository: repo.fullName, appId, installationId,
        createdNow: inserted.rowCount === 1,
        creditsAwarded: 0, paymentObligationsCreated: 0,
        nextStep: `npm run cli -- github sync ${projectId} ${repo.fullName} YYYY-MM-DD`,
        note: "Trusted local operator setup only. GitHub App access is checked; no contributor identity or payment account is created." };
    });
  }

  /** Local DB inspection only; this does not claim the remote installation is still active. */
  async status(project: string) {
    const projectId = nonblank(project, "project ID");
    const p = await this.pool.query(
      `SELECT id,name,created_by FROM openpayables.projects WHERE id=$1`, [projectId],
    );
    if (p.rowCount !== 1) throw new Error("Project not found");
    const sources = await this.pool.query(
      `SELECT s.github_repo_id,s.full_name,b.app_id,b.installation_id
       FROM openpayables.github_sources s
       LEFT JOIN openpayables.github_app_source_bindings b
       ON b.project_id=s.project_id AND b.github_repo_id=s.github_repo_id
       WHERE s.project_id=$1 ORDER BY s.full_name`, [projectId],
    );
    const totals = await this.pool.query(
      `SELECT
         (SELECT COUNT(*) FROM openpayables.project_contributors WHERE project_id=$1) AS contributors,
         (SELECT COUNT(*) FROM openpayables.github_candidates WHERE project_id=$1) AS candidates,
         (SELECT COUNT(*) FROM openpayables.github_candidate_approvals WHERE project_id=$1) AS approvals,
         (SELECT COUNT(*) FROM openpayables.github_identity_links WHERE project_id=$1) AS linked_identities,
         (SELECT COUNT(*) FROM openpayables.github_identity_verifications WHERE project_id=$1) AS verified_identities`,
      [projectId],
    );
    const gitHubSources = sources.rows.map((row) => ({
      githubRepoId: Number(row.github_repo_id), repository: String(row.full_name),
      appId: row.app_id === null ? null : Number(row.app_id),
      installationId: row.installation_id === null ? null : Number(row.installation_id),
      installationRecorded: row.installation_id !== null,
    }));
    const row = totals.rows[0];
    return { projectId, name: String(p.rows[0].name), operatorId: String(p.rows[0].created_by),
      githubSources: gitHubSources,
      counts: { contributors: Number(row.contributors), candidates: Number(row.candidates),
        approvals: Number(row.approvals), linkedIdentities: Number(row.linked_identities),
        verifiedIdentities: Number(row.verified_identities) },
      note: "Local setup status; run github sync to recheck actual GitHub App access. No payment eligibility or settlement is implied." };
  }
}
