/** C12: practical, trusted-operator enrollment and review of immutable GitHub evidence.
 * No GitHub credentials, Stripe credentials, funds or payment obligations are written here.
 */
import type { Pool, PoolClient } from "pg";
import { allocateCents } from "../core/allocation.js";
import type { CreditBalance } from "../core/credits.js";
import { positiveGitHubId } from "../github/approval.js";

function required(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonblank`);
  return value.trim();
}

export interface NamedBalance extends CreditBalance { displayName: string }

/** A hypothetical distribution: no funding check, reservation, payment or ledger write. */
export function previewFromBalances(project: string, cents: number, balances: readonly NamedBalance[]) {
  const projectId = required(project, "project ID");
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("Preview pool must be a positive safe integer of USD cents");
  }
  const shares = allocateCents(cents, balances.map(({ contributorId, points }) => ({ contributorId, points })));
  const names = new Map(balances.map(({ contributorId, displayName }) => [contributorId, displayName]));
  const totalPoints = balances.reduce((sum, x) => sum + x.points, 0);
  if (!Number.isSafeInteger(totalPoints)) throw new Error("Total credits exceed safe integer range");
  return {
    projectId, currency: "usd", hypotheticalPoolCents: cents, totalPoints,
    allocations: shares.map((share) => ({ ...share, displayName: names.get(share.contributorId) ?? "",
      amountUsd: (share.amountCents / 100).toFixed(2) })),
    allocatedCents: shares.reduce((sum, share) => sum + share.amountCents, 0),
    hypothetical: true, fundingVerified: false, creditsConsumed: false,
    paymentObligationsCreated: 0,
    note: "Read-only calculation from current credits. It does not attest funds, reserve a pool, approve a period, or promise payment. Approved distributions use their own locked snapshot.",
  };
}

export class OpenPayablesContributorReview {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
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

  /** Create/join/link in one transaction. This is an OPERATOR ATTESTATION, not user authentication.
   * An immutable project identity link can subsequently be verified by C10 Device Flow.
   */
  async enroll(project: string, githubUser: number, contributor: string, name: string, operator: string) {
    const projectId = required(project, "project ID");
    const githubUserId = positiveGitHubId(githubUser, "GitHub user ID");
    const contributorId = required(contributor, "contributor ID");
    const displayName = required(name, "display name");
    const actor = required(operator, "operator");
    return this.transaction(async (db) => {
      const discovered = await db.query(
        `SELECT 1 FROM openpayables.github_candidates
         WHERE project_id=$1 AND github_user_id=$2 LIMIT 1`, [projectId, githubUserId],
      );
      if (discovered.rowCount !== 1) throw new Error("No discovered GitHub evidence for this project and user ID");

      const created = await db.query(
        `INSERT INTO openpayables.contributors(id,display_name) VALUES($1,$2)
         ON CONFLICT DO NOTHING RETURNING id`, [contributorId, displayName],
      );
      const existingContributor = await db.query(
        `SELECT display_name FROM openpayables.contributors WHERE id=$1 FOR UPDATE`, [contributorId],
      );
      if (existingContributor.rowCount !== 1 || existingContributor.rows[0].display_name !== displayName) {
        throw new Error("Contributor ID already exists with a different display name; no changes made");
      }
      const joined = await db.query(
        `INSERT INTO openpayables.project_contributors(project_id,contributor_id)
         VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING project_id`, [projectId, contributorId],
      );
      const linked = await db.query(
        `INSERT INTO openpayables.github_identity_links(project_id,github_user_id,contributor_id,linked_by)
         VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING github_user_id`,
        [projectId, githubUserId, contributorId, actor],
      );
      const existingLink = await db.query(
        `SELECT github_user_id,contributor_id,linked_by FROM openpayables.github_identity_links
         WHERE project_id=$1 AND (github_user_id=$2 OR contributor_id=$3)`,
        [projectId, githubUserId, contributorId],
      );
      if (existingLink.rowCount !== 1 || Number(existingLink.rows[0].github_user_id) !== githubUserId ||
          existingLink.rows[0].contributor_id !== contributorId) {
        throw new Error("Project GitHub identity already linked differently; no reassignment allowed");
      }
      const verification = await db.query(
        `SELECT verified_at FROM openpayables.github_identity_verifications
         WHERE project_id=$1 AND github_user_id=$2 AND contributor_id=$3`,
        [projectId, githubUserId, contributorId],
      );
      return { projectId, githubUserId, contributorId, displayName,
        contributorCreatedNow: created.rowCount === 1,
        joinedNow: joined.rowCount === 1, linkedNow: linked.rowCount === 1,
        identityVerified: verification.rowCount === 1,
        linkedBy: String(existingLink.rows[0].linked_by),
        creditsAwarded: 0, paymentObligationsCreated: 0,
        nextStep: `npm run cli -- github identity verify ${projectId} ${contributorId}`,
        note: "Operator-attested identity only. C10 contributor-controlled GitHub authorization is separate; no credits are awarded by enrollment.",
      };
    });
  }

  /** Read-only, paginated, PROJECT-scoped queue of as-yet-unapproved candidates. */
  async pending(project: string, offset = 0) {
    const projectId = required(project, "project ID");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
      throw new Error("Offset must be a nonnegative safe integer no greater than 1000000");
    }
    const exists = await this.pool.query("SELECT 1 FROM openpayables.projects WHERE id=$1", [projectId]);
    if (exists.rowCount !== 1) throw new Error("Project not found");
    const limit = 50;
    const rows = await this.pool.query(
      `SELECT gc.github_repo_id, gs.full_name, gc.candidate_key, gc.kind,
              gc.github_user_id, gc.github_login, gc.pull_number, gc.title, gc.source_url,
              gc.merged_at, gi.contributor_id, gv.verified_at
       FROM openpayables.github_candidates gc
       JOIN openpayables.github_sources gs
         ON gs.project_id=gc.project_id AND gs.github_repo_id=gc.github_repo_id
       LEFT JOIN openpayables.github_identity_links gi
         ON gi.project_id=gc.project_id AND gi.github_user_id=gc.github_user_id
       LEFT JOIN openpayables.github_identity_verifications gv
         ON gv.project_id=gc.project_id AND gv.github_user_id=gc.github_user_id
            AND gv.contributor_id=gi.contributor_id
       LEFT JOIN openpayables.github_candidate_approvals ga
         ON ga.project_id=gc.project_id AND ga.github_repo_id=gc.github_repo_id
            AND ga.candidate_key=gc.candidate_key
       WHERE gc.project_id=$1 AND ga.candidate_key IS NULL
       ORDER BY gc.merged_at DESC, gc.github_repo_id, gc.candidate_key
       LIMIT $2 OFFSET $3`, [projectId, limit + 1, offset],
    );
    const pending = rows.rows.slice(0, limit).map((row) => ({
      githubRepoId: Number(row.github_repo_id), repository: String(row.full_name),
      candidateKey: String(row.candidate_key), kind: String(row.kind),
      githubUserId: Number(row.github_user_id), githubLogin: String(row.github_login),
      pullNumber: Number(row.pull_number), title: String(row.title), sourceUrl: String(row.source_url),
      mergedAt: row.merged_at as Date, contributorId: row.contributor_id as string | null,
      identityStatus: row.verified_at !== null ? "verified" : row.contributor_id !== null ? "operator_linked" : "unlinked",
    }));
    const hasMore = rows.rows.length > limit;
    return { projectId, offset, pending, hasMore, nextOffset: hasMore ? offset + limit : null,
      note: "Unapproved evidence only. Enroll a GitHub user, optionally verify identity via Device Flow, then use github approve. Evidence is not automatically scored or paid." };
  }

  async preview(project: string, cents: number) {
    const projectId = required(project, "project ID");
    const exists = await this.pool.query("SELECT 1 FROM openpayables.projects WHERE id=$1", [projectId]);
    if (exists.rowCount !== 1) throw new Error("Project not found");
    const balances = await this.pool.query(
      `SELECT pc.contributor_id, c.display_name, COALESCE(SUM(e.points_delta),0)::BIGINT AS points
       FROM openpayables.project_contributors pc
       JOIN openpayables.contributors c ON c.id=pc.contributor_id
       LEFT JOIN openpayables.credit_events e
         ON e.project_id=pc.project_id AND e.contributor_id=pc.contributor_id
       WHERE pc.project_id=$1
       GROUP BY pc.contributor_id,c.display_name ORDER BY pc.contributor_id`, [projectId],
    );
    return previewFromBalances(projectId, cents, balances.rows.map((row) => ({
      contributorId: String(row.contributor_id), displayName: String(row.display_name),
      points: Number(row.points),
    })));
  }
}
