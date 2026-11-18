/** Project-scoped GitHub evidence. Persisted candidates are immutable and do not award credits. */
import type { Pool, PoolClient } from "pg";
import type { GitHubCandidate, GitHubRepository } from "../../github/discovery.js";

function required(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonblank`);
  return value.trim();
}

export class OpenPayablesGitHub {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const answer = await fn(db);
      await db.query("COMMIT");
      return answer;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  async registerSource(project: string, repo: GitHubRepository, operator: string) {
    const projectId = required(project, "project ID");
    const actor = required(operator, "operator");
    if (repo.private !== false || !Number.isSafeInteger(repo.id) || repo.id <= 0) {
      throw new Error("A verified public GitHub repository is required");
    }
    return this.transaction(async (db) => {
      const added = await db.query(
        `INSERT INTO openpayables.github_sources (project_id,github_repo_id,full_name,registered_by)
         VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING
         RETURNING project_id,github_repo_id,full_name`,
        [projectId, repo.id, repo.fullName, actor],
      );
      const current = await db.query(
        `SELECT project_id,github_repo_id,full_name,registered_by,registered_at
         FROM openpayables.github_sources
         WHERE project_id=$1 AND (github_repo_id=$2 OR lower(full_name)=lower($3))`,
        [projectId, repo.id, repo.fullName],
      );
      if (current.rowCount !== 1 ||
          Number(current.rows[0].github_repo_id) !== repo.id ||
          String(current.rows[0].full_name).toLowerCase() !== repo.fullName.toLowerCase()) {
        throw new Error("GitHub source identity conflict or repository rename; refusing silent reassignment");
      }
      return { projectId, githubRepoId: repo.id, fullName: current.rows[0].full_name as string,
        registeredNow: added.rowCount === 1 };
    });
  }

  async sources(project: string) {
    const rows = await this.pool.query(
      `SELECT github_repo_id,full_name,registered_by,registered_at
       FROM openpayables.github_sources WHERE project_id=$1 ORDER BY full_name`,
      [required(project, "project ID")],
    );
    return { projectId: project, sources: rows.rows.map((r) => ({
      githubRepoId: Number(r.github_repo_id), fullName: String(r.full_name),
      registeredBy: String(r.registered_by), registeredAt: r.registered_at as Date,
    })) };
  }

  async requireSource(project: string, fullName: string): Promise<GitHubRepository> {
    const results = await this.pool.query(
      `SELECT github_repo_id,full_name FROM openpayables.github_sources
       WHERE project_id=$1 AND lower(full_name)=lower($2)`,
      [required(project, "project ID"), required(fullName, "repository")],
    );
    if (results.rowCount !== 1) throw new Error("GitHub source is not registered for this project");
    return { id: Number(results.rows[0].github_repo_id),
      fullName: String(results.rows[0].full_name), private: false };
  }

  async importCandidates(project: string, repo: GitHubRepository, items: readonly GitHubCandidate[]) {
    const projectId = required(project, "project ID");
    if (!Number.isSafeInteger(repo.id) || repo.id <= 0) throw new Error("Invalid GitHub repository identity");
    const unique = new Set<string>();
    for (const item of items) {
      if (unique.has(item.candidateKey)) throw new Error("Duplicate discovery candidate; import aborted");
      unique.add(item.candidateKey);
      if (!/^pr:\d+:(author|reviewer):\d+$/.test(item.candidateKey) ||
        !Number.isSafeInteger(item.githubUserId) || !Number.isSafeInteger(item.pullId) ||
        !Number.isSafeInteger(item.pullNumber) ||
        !/^[0-9a-f]{64}$/.test(item.fingerprint)) throw new Error("Invalid discovery candidate");
    }
    return this.transaction(async (db) => {
      // Do not permit reusing an old project link if the GitHub repository was replaced or renamed.
      const source = await db.query(
        `SELECT full_name FROM openpayables.github_sources
         WHERE project_id=$1 AND github_repo_id=$2 FOR KEY SHARE`,
        [projectId, repo.id],
      );
      if (source.rowCount !== 1 || String(source.rows[0].full_name) !== repo.fullName) {
        throw new Error("GitHub source registration differs from verified repository; import aborted");
      }
      let added = 0;
      let unchanged = 0;
      let changed = 0;
      for (const item of items) {
        const result = await db.query(
          `INSERT INTO openpayables.github_candidates (
             project_id,github_repo_id,candidate_key,kind,pull_id,pull_number,
             github_user_id,github_login,title,source_url,merged_at,review_ids,last_review_at,fingerprint)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
           ON CONFLICT DO NOTHING RETURNING candidate_key`,
          [projectId, repo.id, item.candidateKey, item.kind, item.pullId, item.pullNumber,
            item.githubUserId, item.githubLogin, item.title, item.sourceUrl, item.mergedAt,
            JSON.stringify(item.reviewIds), item.lastReviewAt, item.fingerprint],
        );
        if (result.rowCount === 1) { added++; continue; }
        const existing = await db.query(
          `SELECT fingerprint FROM openpayables.github_candidates
           WHERE project_id=$1 AND github_repo_id=$2 AND candidate_key=$3`,
          [projectId, repo.id, item.candidateKey],
        );
        if (existing.rowCount !== 1) throw new Error("Candidate uniqueness conflict; import aborted");
        if (existing.rows[0].fingerprint === item.fingerprint) unchanged++;
        else changed++;
      }
      return { projectId, repo: repo.fullName, discovered: items.length,
        newCandidates: added, unchangedCandidates: unchanged, changedEvidence: changed,
        creditsAwarded: 0, paymentObligationsCreated: 0,
        note: "GitHub candidates are immutable evidence, not approved contributions. Changed evidence is reported but not overwritten." };
    });
  }

  async candidates(project: string, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Offset must be a nonnegative integer");
    const projectId = required(project, "project ID");
    const result = await this.pool.query(
      `SELECT github_repo_id,candidate_key,kind,pull_id,pull_number,github_user_id,
              github_login,title,source_url,merged_at,review_ids,last_review_at,discovered_at
       FROM openpayables.github_candidates
       WHERE project_id=$1 ORDER BY discovered_at,candidate_key LIMIT 101 OFFSET $2`,
      [projectId, offset],
    );
    const data = result.rows.slice(0, 100).map((r) => ({
      githubRepoId: Number(r.github_repo_id), candidateKey: String(r.candidate_key),
      kind: String(r.kind), pullId: Number(r.pull_id), pullNumber: Number(r.pull_number),
      githubUserId: Number(r.github_user_id), githubLogin: String(r.github_login),
      title: String(r.title), sourceUrl: String(r.source_url), mergedAt: r.merged_at as Date,
      reviewIds: r.review_ids as number[], lastReviewAt: r.last_review_at as Date | null,
      discoveredAt: r.discovered_at as Date,
    }));
    return { projectId, offset, candidates: data, hasMore: result.rows.length > 100,
      nextOffset: result.rows.length > 100 ? offset + 100 : null,
      note: "Pending evidence only; no GitHub-to-contributor identity link or credit award exists in C7." };
  }
}
