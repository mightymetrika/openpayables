/**
 * Application-facing read model for authenticated HOST SERVER use only.
 *
 * The caller must authenticate each request and authorize an explicit project
 * and, for contributor views, a server-resolved contributor ID. This library
 * does not authenticate users and MUST NEVER be exposed as an unrestricted API.
 * It performs SELECT queries only; no financial action or provider API call.
 */
import { createPool } from "../storage/postgres/connection.js";
import { OpenPayablesContributorReview } from "../operator/review.js";

function nonblank(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be nonblank`);
  }
  return value.trim();
}

function safeNumber(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("Database integer exceeds safe JavaScript range");
  return number;
}

function instant(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("Invalid database timestamp");
  return date.toISOString();
}

export interface ManagerBalance {
  contributorId: string;
  displayName: string;
  points: number;
}

export interface ProjectOverview {
  projectId: string;
  projectName: string;
  contributorCount: number;
  totalPoints: number;
  pendingEvidenceCount: number;
  balances: ManagerBalance[];
  readOnly: true;
}

export interface ContributorView {
  projectId: string;
  contributorId: string;
  displayName: string;
  points: number;
  recentCredits: {
    id: string; category: string; eventType: string; pointsDelta: number;
    source: string; sourceId: string; reason: string; at: string;
  }[];
  voting: {
    proposalId: string; title: string; status: string; weight: number;
    choice: string | null; openedAt: string;
  }[];
  testDistributions: {
    periodId: string; label: string; amountCents: number; points: number;
    status: string; approvedAt: string;
  }[];
  readOnly: true;
  paymentNotice: string;
}

/** Dedicated PostgreSQL connection. Instantiate once per trusted server process and close on shutdown. */
export class OpenPayablesReadOnly {
  private readonly pool;
  private readonly review;

  constructor(connectionString: string) {
    this.pool = createPool(connectionString);
    this.review = new OpenPayablesContributorReview(this.pool);
  }

  async close(): Promise<void> { await this.pool.end(); }

  /** Host authorizes the manager's OpenPayables PROJECT access BEFORE calling. */
  async projectOverview(project: string): Promise<ProjectOverview> {
    const projectId = nonblank(project, "project ID");
    const row = await this.pool.query(
      "SELECT id,name FROM openpayables.projects WHERE id=$1", [projectId],
    );
    if (row.rowCount !== 1) throw new Error("Project not found");
    const balances = await this.pool.query(
      `SELECT pc.contributor_id, c.display_name,
              COALESCE(SUM(e.points_delta),0)::BIGINT AS points
         FROM openpayables.project_contributors pc
         JOIN openpayables.contributors c ON c.id=pc.contributor_id
         LEFT JOIN openpayables.credit_events e
           ON e.project_id=pc.project_id AND e.contributor_id=pc.contributor_id
        WHERE pc.project_id=$1
        GROUP BY pc.contributor_id,c.display_name ORDER BY pc.contributor_id`, [projectId],
    );
    const pending = await this.pool.query(
      `SELECT COUNT(*)::BIGINT AS count
         FROM openpayables.github_candidates gc
         LEFT JOIN openpayables.github_candidate_approvals ga
           ON ga.project_id=gc.project_id AND ga.github_repo_id=gc.github_repo_id
          AND ga.candidate_key=gc.candidate_key
        WHERE gc.project_id=$1 AND ga.candidate_key IS NULL`, [projectId],
    );
    const mapped = balances.rows.map((r) => ({
      contributorId: String(r.contributor_id), displayName: String(r.display_name),
      points: safeNumber(r.points),
    }));
    const totalPoints = mapped.reduce((total, r) => total + r.points, 0);
    if (!Number.isSafeInteger(totalPoints)) throw new Error("Total credits exceed safe integer range");
    return {
      projectId, projectName: String(row.rows[0].name), contributorCount: mapped.length,
      totalPoints, pendingEvidenceCount: safeNumber(pending.rows[0].count),
      balances: mapped, readOnly: true,
    };
  }

  /** Host authorizes manager access; reuse the validated, 50-item project-scoped queue. */
  async pendingEvidence(project: string, offset = 0) {
    return this.review.pending(nonblank(project, "project ID"), offset);
  }

  /**
   * Host MUST map its authenticated user to the contributorId on the server;
   * never accept a caller-selected contributor ID from a browser request.
   */
  async contributorView(project: string, contributor: string): Promise<ContributorView> {
    const projectId = nonblank(project, "project ID");
    const contributorId = nonblank(contributor, "contributor ID");
    const member = await this.pool.query(
      `SELECT c.display_name FROM openpayables.project_contributors pc
       JOIN openpayables.contributors c ON c.id=pc.contributor_id
       WHERE pc.project_id=$1 AND pc.contributor_id=$2`, [projectId, contributorId],
    );
    if (member.rowCount !== 1) throw new Error("Contributor not found in project");

    const [balance, history, proposals, distributions] = await Promise.all([
      this.pool.query(
        `SELECT COALESCE(SUM(points_delta),0)::BIGINT AS points
         FROM openpayables.credit_events WHERE project_id=$1 AND contributor_id=$2`,
        [projectId, contributorId],
      ),
      this.pool.query(
        `SELECT id,category_code,event_type,points_delta,source,source_id,reason,approved_at
         FROM openpayables.credit_events WHERE project_id=$1 AND contributor_id=$2
         ORDER BY approved_at DESC,id DESC LIMIT 50`, [projectId, contributorId],
      ),
      this.pool.query(
        `SELECT p.id,p.title,p.status,p.opened_at,w.weight,b.choice
         FROM openpayables.proposals p
         JOIN openpayables.proposal_weights w ON w.proposal_id=p.id AND w.contributor_id=$2
         LEFT JOIN openpayables.ballots b
           ON b.proposal_id=p.id AND b.contributor_id=w.contributor_id
         WHERE p.project_id=$1 ORDER BY p.opened_at DESC,p.id DESC LIMIT 25`,
        [projectId, contributorId],
      ),
      this.pool.query(
        `SELECT p.id,p.label,p.approved_at,s.points,s.amount_cents,o.status
         FROM openpayables.distribution_snapshot s
         JOIN openpayables.distribution_periods p ON p.id=s.period_id
         LEFT JOIN openpayables.distribution_obligations o
           ON o.period_id=s.period_id AND o.contributor_id=s.contributor_id
         WHERE p.project_id=$1 AND s.contributor_id=$2 AND p.status='approved'
         ORDER BY p.approved_at DESC,p.id DESC LIMIT 25`, [projectId, contributorId],
      ),
    ]);
    return {
      projectId, contributorId, displayName: String(member.rows[0].display_name),
      points: safeNumber(balance.rows[0].points),
      recentCredits: history.rows.map((r) => ({
        id: String(r.id), category: String(r.category_code), eventType: String(r.event_type),
        pointsDelta: safeNumber(r.points_delta), source: String(r.source),
        sourceId: String(r.source_id), reason: String(r.reason), at: instant(r.approved_at),
      })),
      voting: proposals.rows.map((r) => ({
        proposalId: String(r.id), title: String(r.title), status: String(r.status),
        weight: safeNumber(r.weight), choice: r.choice === null ? null : String(r.choice),
        openedAt: instant(r.opened_at),
      })),
      testDistributions: distributions.rows.map((r) => ({
        periodId: String(r.id), label: String(r.label), amountCents: safeNumber(r.amount_cents),
        points: safeNumber(r.points), status: r.status === null ? "no_obligation" : String(r.status),
        approvedAt: instant(r.approved_at),
      })),
      readOnly: true,
      paymentNotice: "TEST-mode ledger figures only; credits and allocations are not guaranteed payment or bank settlement.",
    };
  }
}
