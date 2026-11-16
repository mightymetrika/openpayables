import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { pointsForSize, type AwardSize } from "../../core/credits.js";
import { tallyVotes, type VoteChoice, type VoteTally } from "../../core/voting.js";

export interface AwardInput {
  projectId: string;
  contributorId: string;
  category: string;
  size: AwardSize;
  source: string;
  sourceId: string;
  role: string;
  reason: string;
  approvedBy: string;
}

function requireText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonblank`);
  return value.trim();
}

/** PostgreSQL adapter: never imports Supabase, Prisma, Clerk or Next.js. */
export class OpenPayablesStore {
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

  async createProject(projectId: string, name: string, operator: string) {
    const id = requireText(projectId, "project ID");
    const projectName = requireText(name, "name");
    const actor = requireText(operator, "operator");
    return this.transaction(async (db) => {
      const result = await db.query(
        `INSERT INTO openpayables.projects(id, name, created_by) VALUES($1,$2,$3)
         RETURNING id, name, created_by, created_at`,
        [id, projectName, actor],
      );
      const defaults = [
        ["development", "Accepted implementation and bug fixes"],
        ["documentation", "Project documentation"],
        ["testing", "Quality assurance and testing"],
        ["review", "Substantive technical review"],
      ];
      for (const [code, description] of defaults) {
        await db.query(
          "INSERT INTO openpayables.categories(project_id,code,description,created_by) VALUES($1,$2,$3,$4)",
          [id, code, description, actor],
        );
      }
      return result.rows[0];
    });
  }

  async createContributor(id: string, displayName: string) {
    const result = await this.pool.query(
      `INSERT INTO openpayables.contributors(id,display_name) VALUES($1,$2)
       RETURNING id, display_name, created_at`,
      [requireText(id, "contributor ID"), requireText(displayName, "display name")],
    );
    return result.rows[0];
  }

  async joinProject(projectId: string, contributorId: string) {
    const result = await this.pool.query(
      `INSERT INTO openpayables.project_contributors(project_id,contributor_id)
       VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING project_id,contributor_id`,
      [requireText(projectId, "project ID"), requireText(contributorId, "contributor ID")],
    );
    return { projectId, contributorId, joinedNow: result.rowCount === 1 };
  }

  async addCategory(projectId: string, code: string, description: string, operator: string) {
    const result = await this.pool.query(
      `INSERT INTO openpayables.categories(project_id,code,description,created_by)
       VALUES($1,$2,$3,$4) RETURNING project_id,code,description`,
      [requireText(projectId, "project ID"), requireText(code, "category"),
        requireText(description, "description"), requireText(operator, "operator")],
    );
    return result.rows[0];
  }

  async award(input: AwardInput) {
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO openpayables.credit_events
       (id,project_id,contributor_id,category_code,event_type,size,points_delta,
        source,source_id,role,reason,approved_by)
       VALUES($1,$2,$3,$4,'award',$5,$6,$7,$8,$9,$10,$11)
       RETURNING id,project_id,contributor_id,category_code,points_delta,source,source_id,role,approved_at`,
      [id, requireText(input.projectId, "project ID"),
        requireText(input.contributorId, "contributor ID"), requireText(input.category, "category"),
        input.size, pointsForSize(input.size), requireText(input.source, "source"),
        requireText(input.sourceId, "source ID"), requireText(input.role, "role"),
        requireText(input.reason, "approval reason"), requireText(input.approvedBy, "operator")],
    );
    return result.rows[0];
  }

  async reverseAward(awardId: string, reason: string, operator: string) {
    const actor = requireText(operator, "operator");
    const explanation = requireText(reason, "reversal reason");
    return this.transaction(async (db) => {
      const original = await db.query(
        `SELECT * FROM openpayables.credit_events WHERE id=$1 AND event_type='award' FOR UPDATE`,
        [requireText(awardId, "award ID")],
      );
      if (original.rowCount !== 1) throw new Error("Award not found");
      const award = original.rows[0];
      const result = await db.query(
        `INSERT INTO openpayables.credit_events
         (id,project_id,contributor_id,category_code,event_type,size,points_delta,
          source,source_id,role,reason,approved_by,reversal_of)
         VALUES($1,$2,$3,$4,'reversal',NULL,$5,'reversal',$6,'reversal',$7,$8,$9)
         RETURNING id,reversal_of,project_id,contributor_id,points_delta,approved_at`,
        [randomUUID(), award.project_id, award.contributor_id, award.category_code,
          -award.points_delta, award.id, explanation, actor, award.id],
      );
      return result.rows[0];
    });
  }

  async balances(projectId: string) {
    const result = await this.pool.query(
      `SELECT pc.contributor_id, c.display_name,
         COALESCE(SUM(e.points_delta),0)::BIGINT AS points
       FROM openpayables.project_contributors pc
       JOIN openpayables.contributors c ON c.id=pc.contributor_id
       LEFT JOIN openpayables.credit_events e
         ON e.project_id=pc.project_id AND e.contributor_id=pc.contributor_id
       WHERE pc.project_id=$1
       GROUP BY pc.contributor_id,c.display_name
       ORDER BY pc.contributor_id`,
      [requireText(projectId, "project ID")],
    );
    return result.rows.map((row) => ({
      contributorId: String(row.contributor_id),
      displayName: String(row.display_name),
      points: Number(row.points) as number,
    }));
  }

  async creditHistory(projectId: string) {
    const result = await this.pool.query(
      `SELECT id,contributor_id,category_code,event_type,size,points_delta,
              source,source_id,role,reason,approved_by,reversal_of,approved_at
       FROM openpayables.credit_events WHERE project_id=$1
       ORDER BY approved_at,id`,
      [requireText(projectId, "project ID")],
    );
    return result.rows;
  }

  async openProposal(projectId: string, title: string, description: string, operator: string) {
    return this.transaction(async (db) => {
      const id = randomUUID();
      const result = await db.query(
        `INSERT INTO openpayables.proposals(id,project_id,title,description,opened_by)
         VALUES($1,$2,$3,$4,$5) RETURNING id,project_id,title,status,opened_at`,
        [id, requireText(projectId, "project ID"), requireText(title, "title"),
          description ?? "", requireText(operator, "operator")],
      );
      const weights = await db.query(
        `INSERT INTO openpayables.proposal_weights(proposal_id, contributor_id, weight)
         SELECT $1, contributor_id, SUM(points_delta)::INTEGER
         FROM openpayables.credit_events
         WHERE project_id=$2
         GROUP BY contributor_id
         HAVING SUM(points_delta) > 0
         RETURNING contributor_id,weight`,
        [id, projectId],
      );
      if (weights.rowCount === 0) throw new Error("Cannot open a vote without approved contribution points");
      return { ...result.rows[0], weights: weights.rows };
    });
  }

  async castVote(proposalId: string, contributorId: string, choice: VoteChoice, operator: string) {
    if (!["yes", "no", "abstain"].includes(choice)) throw new Error("Invalid vote choice");
    return this.transaction(async (db) => {
      const proposal = await db.query("SELECT status FROM openpayables.proposals WHERE id=$1 FOR UPDATE", [proposalId]);
      if (proposal.rowCount !== 1 || proposal.rows[0].status !== "open") throw new Error("Proposal is not open");
      const result = await db.query(
        `INSERT INTO openpayables.ballots(proposal_id,contributor_id,choice,cast_by)
         VALUES($1,$2,$3,$4) RETURNING proposal_id,contributor_id,choice,cast_at`,
        [requireText(proposalId, "proposal ID"), requireText(contributorId, "contributor ID"),
          choice, requireText(operator, "operator")],
      );
      return result.rows[0];
    });
  }

  async tallyProposal(proposalId: string): Promise<{ proposal: unknown; tally: VoteTally }> {
    const proposal = await this.pool.query(
      "SELECT id,project_id,title,status,opened_at,closed_at FROM openpayables.proposals WHERE id=$1",
      [requireText(proposalId, "proposal ID")],
    );
    if (proposal.rowCount !== 1) throw new Error("Proposal not found");
    const weights = await this.pool.query(
      "SELECT contributor_id,weight FROM openpayables.proposal_weights WHERE proposal_id=$1",
      [proposalId],
    );
    const ballots = await this.pool.query(
      "SELECT contributor_id,choice FROM openpayables.ballots WHERE proposal_id=$1",
      [proposalId],
    );
    return {
      proposal: proposal.rows[0],
      tally: tallyVotes(
        weights.rows.map((row) => ({ contributorId: String(row.contributor_id), weight: Number(row.weight) })),
        ballots.rows.map((row) => ({ contributorId: String(row.contributor_id), choice: row.choice as VoteChoice })),
      ),
    };
  }

  async closeProposal(proposalId: string, operator: string) {
    const result = await this.pool.query(
      `UPDATE openpayables.proposals SET status='closed',closed_by=$2,closed_at=now()
       WHERE id=$1 AND status='open' RETURNING id,status,closed_at`,
      [requireText(proposalId, "proposal ID"), requireText(operator, "operator")],
    );
    if (result.rowCount !== 1) throw new Error("Open proposal not found");
    return result.rows[0];
  }
}
