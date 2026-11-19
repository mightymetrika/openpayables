/** Project-scoped GitHub evidence. Persisted candidates are immutable and do not award credits. */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AwardSize } from "../../core/credits.js";
import { githubAwardMetadata, positiveGitHubId } from "../../github/approval.js";
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


  /** An App installation belongs to an explicitly registered project repository, never a global default. */
  async bindAppInstallation(project: string, repo: GitHubRepository,
    binding: { appId: number; installationId: number }, operator: string) {
    const projectId = required(project, "project ID");
    const actor = required(operator, "operator");
    for (const value of [repo.id, binding.appId, binding.installationId]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid GitHub App binding identifier");
    }
    return this.transaction(async (db) => {
      const source = await db.query(
        `SELECT github_repo_id FROM openpayables.github_sources
         WHERE project_id=$1 AND github_repo_id=$2 AND lower(full_name)=lower($3)`,
        [projectId, repo.id, repo.fullName],
      );
      if (source.rowCount !== 1) throw new Error("Register the exact GitHub repository before binding its App installation");
      const inserted = await db.query(
        `INSERT INTO openpayables.github_app_source_bindings
         (project_id,github_repo_id,app_id,installation_id,bound_by)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING project_id`,
        [projectId, repo.id, binding.appId, binding.installationId, actor],
      );
      const existing = await db.query(
        `SELECT app_id,installation_id,bound_by,bound_at FROM openpayables.github_app_source_bindings
         WHERE project_id=$1 AND github_repo_id=$2`, [projectId, repo.id],
      );
      if (existing.rowCount !== 1 || Number(existing.rows[0].app_id) !== binding.appId ||
          Number(existing.rows[0].installation_id) !== binding.installationId) {
        throw new Error("GitHub App installation already bound with different immutable terms");
      }
      return { projectId, githubRepoId: repo.id, fullName: repo.fullName,
        appId: binding.appId, installationId: binding.installationId,
        boundBy: String(existing.rows[0].bound_by), boundAt: existing.rows[0].bound_at as Date,
        boundNow: inserted.rowCount === 1 };
    });
  }

  /** Read metadata only. No App keys or installation tokens are stored. */
  async appBinding(project: string, repoId: number) {
    const projectId = required(project, "project ID");
    if (!Number.isSafeInteger(repoId) || repoId <= 0) throw new Error("Invalid repository ID");
    const rows = await this.pool.query(
      `SELECT b.app_id,b.installation_id,b.bound_by,b.bound_at,s.full_name
       FROM openpayables.github_app_source_bindings b
       JOIN openpayables.github_sources s ON s.project_id=b.project_id AND s.github_repo_id=b.github_repo_id
       WHERE b.project_id=$1 AND b.github_repo_id=$2`, [projectId, repoId],
    );
    if (rows.rowCount === 0) return null;
    if (rows.rowCount !== 1) throw new Error("Conflicting GitHub App bindings");
    return { projectId, githubRepoId: repoId, fullName: String(rows.rows[0].full_name),
      appId: Number(rows.rows[0].app_id), installationId: Number(rows.rows[0].installation_id),
      boundBy: String(rows.rows[0].bound_by), boundAt: rows.rows[0].bound_at as Date };
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
      `SELECT gc.github_repo_id,gc.candidate_key,gc.kind,gc.pull_id,gc.pull_number,gc.github_user_id,
              gc.github_login,gc.title,gc.source_url,gc.merged_at,gc.review_ids,gc.last_review_at,gc.discovered_at,
       gi.contributor_id AS linked_contributor_id,
       ga.credit_event_id AS award_id,
       ga.award_size AS approved_size
       FROM openpayables.github_candidates gc
       LEFT JOIN openpayables.github_identity_links gi
         ON gi.project_id=gc.project_id AND gi.github_user_id=gc.github_user_id
       LEFT JOIN openpayables.github_candidate_approvals ga
         ON ga.project_id=gc.project_id AND ga.github_repo_id=gc.github_repo_id
           AND ga.candidate_key=gc.candidate_key
       WHERE gc.project_id=$1 ORDER BY gc.discovered_at,gc.candidate_key LIMIT 101 OFFSET $2`,
      [projectId, offset],
    );
    const data = result.rows.slice(0, 100).map((r) => ({
      githubRepoId: Number(r.github_repo_id), candidateKey: String(r.candidate_key),
      kind: String(r.kind), pullId: Number(r.pull_id), pullNumber: Number(r.pull_number),
      githubUserId: Number(r.github_user_id), githubLogin: String(r.github_login),
      title: String(r.title), sourceUrl: String(r.source_url), mergedAt: r.merged_at as Date,
      reviewIds: r.review_ids as number[], lastReviewAt: r.last_review_at as Date | null,
      discoveredAt: r.discovered_at as Date,
      linkedContributorId: r.linked_contributor_id as string | null,
      awardId: r.award_id as string | null,
      approvedSize: r.approved_size as AwardSize | null,
    }));
    return { projectId, offset, candidates: data, hasMore: result.rows.length > 100,
      nextOffset: result.rows.length > 100 ? offset + 100 : null,
      note: "Identity links are operator-attested, not proof of GitHub ownership; only explicit approval creates credits." };
  }

  /** A trusted operator explicitly links a stable numeric GitHub user ID to an existing project member. */
  async linkIdentity(project: string, githubUserId: number, contributor: string, operator: string) {
    const projectId = required(project, "project ID");
    const id = positiveGitHubId(githubUserId, "GitHub user ID");
    const contributorId = required(contributor, "contributor ID");
    const actor = required(operator, "operator");
    return this.transaction(async (db) => {
      const candidate = await db.query(
        `SELECT 1 FROM openpayables.github_candidates WHERE project_id=$1 AND github_user_id=$2 LIMIT 1`,
        [projectId, id],
      );
      if (candidate.rowCount !== 1) throw new Error("No discovered GitHub evidence for that project and user ID");
      const member = await db.query(
        `SELECT 1 FROM openpayables.project_contributors WHERE project_id=$1 AND contributor_id=$2`,
        [projectId, contributorId],
      );
      if (member.rowCount !== 1) throw new Error("Contributor must already belong to the project");
      const inserted = await db.query(
        `INSERT INTO openpayables.github_identity_links(project_id,github_user_id,contributor_id,linked_by)
         VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING github_user_id`,
        [projectId, id, contributorId, actor],
      );
      const existing = await db.query(
        `SELECT github_user_id,contributor_id,linked_by,linked_at
         FROM openpayables.github_identity_links
         WHERE project_id=$1 AND (github_user_id=$2 OR contributor_id=$3)`,
        [projectId, id, contributorId],
      );
      if (existing.rowCount !== 1 || Number(existing.rows[0].github_user_id) !== id ||
          existing.rows[0].contributor_id !== contributorId) {
        throw new Error("GitHub identity already linked differently; no reassignment allowed");
      }
      return { projectId, githubUserId: id, contributorId, linkedNow: inserted.rowCount === 1,
        linkedBy: existing.rows[0].linked_by as string,
        note: "Operator-attested identity association. GitHub user ownership is not verified by C8." };
    });
  }

  /** Approve one immutable candidate and its credit event in the SAME PostgreSQL transaction. */
  async approveCandidate(project: string, repoId: number, key: string, size: AwardSize,
    reason: string, operator: string) {
    const projectId = required(project, "project ID");
    const githubRepoId = positiveGitHubId(repoId, "GitHub repository ID");
    const candidateKey = required(key, "candidate key");
    const why = required(reason, "approval reason");
    const actor = required(operator, "operator");
    return this.transaction(async (db) => {
      // Lock this candidate to serialize duplicate and concurrent approval attempts.
      const result = await db.query(
        `SELECT kind,pull_id,github_user_id FROM openpayables.github_candidates
         WHERE project_id=$1 AND github_repo_id=$2 AND candidate_key=$3 FOR UPDATE`,
        [projectId, githubRepoId, candidateKey],
      );
      if (result.rowCount !== 1) throw new Error("GitHub candidate not found in that project and repository");
      const kind = result.rows[0].kind as "pr_author" | "pr_reviewer";
      const encoded = /^pr:([1-9]\d*):(author|reviewer):([1-9]\d*)$/.exec(candidateKey);
      if (!encoded || Number(encoded[1]) !== Number(result.rows[0].pull_id) ||
          Number(encoded[3]) !== Number(result.rows[0].github_user_id)) {
        throw new Error("Stored GitHub candidate identity does not match its source key");
      }
      const meta = githubAwardMetadata(githubRepoId, candidateKey, kind, size);
      const identity = await db.query(
        `SELECT contributor_id FROM openpayables.github_identity_links
         WHERE project_id=$1 AND github_user_id=$2`,
        [projectId, result.rows[0].github_user_id],
      );
      if (identity.rowCount !== 1) throw new Error("GitHub identity is not linked to a project contributor");
      const contributorId = String(identity.rows[0].contributor_id);
      const existing = await db.query(
        `SELECT contributor_id,award_size,approval_reason,approved_by,credit_event_id
         FROM openpayables.github_candidate_approvals
         WHERE project_id=$1 AND github_repo_id=$2 AND candidate_key=$3`,
        [projectId, githubRepoId, candidateKey],
      );
      if (existing.rowCount === 1) {
        const prior = existing.rows[0];
        if (prior.contributor_id !== contributorId || prior.award_size !== size || prior.approval_reason !== why) {
          throw new Error("Candidate already approved with different immutable terms");
        }
        return { projectId, githubRepoId, candidateKey, contributorId,
          awardId: String(prior.credit_event_id), points: meta.points, category: meta.category,
          approvedBy: String(prior.approved_by), approvedNow: false,
          paymentObligationsCreated: 0 };
      }
      const awardId = randomUUID();
      await db.query(
        `INSERT INTO openpayables.credit_events
         (id,project_id,contributor_id,category_code,event_type,size,points_delta,
          source,source_id,role,reason,approved_by)
         VALUES($1,$2,$3,$4,'award',$5,$6,$7,$8,$9,$10,$11)`,
        [awardId, projectId, contributorId, meta.category, size, meta.points, meta.source,
          meta.sourceId, meta.role, why, actor],
      );
      await db.query(
        `INSERT INTO openpayables.github_candidate_approvals
         (project_id,github_repo_id,candidate_key,contributor_id,award_size,approval_reason,approved_by,credit_event_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [projectId, githubRepoId, candidateKey, contributorId, size, why, actor, awardId],
      );
      return { projectId, githubRepoId, candidateKey, contributorId,
        awardId, points: meta.points, category: meta.category,
        approvedBy: actor, approvedNow: true, paymentObligationsCreated: 0 };
    });
  }

}
