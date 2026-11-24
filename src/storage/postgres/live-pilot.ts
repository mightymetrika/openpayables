import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { allocateCents } from "../../core/allocation.js";
import type { LivePilotEvidence } from "../../payments/stripe/live-readiness.js";

export const LIVE_PILOT_CAP_CENTS = 2500;
export interface PilotApprovalInput {
  projectId: string;
  contributorId: string;
  recipientId: string;
  topupId: string;
  amountCents: number;
  authorizationReference: string;
}
export interface PilotEvidenceReader {
  inspectPilot(recipientId: string, topupId: string): Promise<LivePilotEvidence>;
}
function validateInput(input: PilotApprovalInput): void {
  if (!input.projectId.trim() || !input.contributorId.trim() ||
      !/^acct_[A-Za-z0-9]+$/.test(input.recipientId) || !/^tu_[A-Za-z0-9]+$/.test(input.topupId) ||
      !input.authorizationReference.trim() || input.authorizationReference.length > 200 ||
      !Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > LIVE_PILOT_CAP_CENTS) {
    throw new Error("Invalid pilot approval input (positive integer cents, maximum 2500; exact IDs and authorization reference required)");
  }
}

/** Trusted operator process only. Never expose through a web or contributor endpoint.
 * Synthetic integration fixtures are permitted only in the dedicated TEST DB.
 * This approval is NOT a transfer authorization token or bank payout.
 */
export class LivePilotLedger {
  constructor(private readonly pool: Pool, private readonly mode: "live" | "pilot_test" = "live") {}

  private async guard(db: Pool | PoolClient): Promise<void> {
    const result = await db.query(`SELECT current_database() AS db, session_user AS actor,
      (SELECT rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname=session_user) AS elevated`);
    const row = result.rows[0];
    if (this.mode === "live") {
      if (row?.db !== "openpayables_live" || row.actor !== "openpayables_live_operator" || row.elevated !== false) {
        throw new Error("LIVE pilot requires openpayables_live and a dedicated non-admin openpayables_live_operator login");
      }
    } else if (row?.db !== "openpayables_test") {
      throw new Error("Synthetic pilot fixtures require openpayables_test");
    }
  }

  async show(projectId: string) {
    await this.guard(this.pool);
    const result = await this.pool.query(
      "SELECT * FROM openpayables.live_pilot_approvals WHERE mode=$1 AND project_id=$2", [this.mode, projectId]);
    return result.rows[0] ?? null;
  }

  async approve(input: PilotApprovalInput, provider: PilotEvidenceReader) {
    validateInput(input);
    await this.guard(this.pool); // reject wrong database before any Stripe request
    const evidence = await provider.inspectPilot(input.recipientId, input.topupId);
    const { platformAccountId, recipient, topup, usdAvailableCents, receiptNetCents } = evidence;
    if (!/^acct_[A-Za-z0-9]+$/.test(platformAccountId) || platformAccountId === input.recipientId ||
        evidence.country !== "US" || evidence.transfersCapability !== "active" ||
        recipient?.accountId !== input.recipientId || recipient.country !== "US" ||
        recipient.transfersAndPayoutsAppearEnabled !== true || recipient.transfersCapability !== "active" ||
        recipient.payoutsEnabled !== true || topup?.id !== input.topupId ||
        topup.status !== "succeeded" || topup.currency !== "usd" ||
        !/^txn_[A-Za-z0-9]+$/.test(topup.balanceTransactionId) ||
        !Number.isSafeInteger(topup.amountCents) || !Number.isSafeInteger(receiptNetCents) || receiptNetCents > topup.amountCents || receiptNetCents < input.amountCents ||
        !Number.isSafeInteger(usdAvailableCents) || usdAvailableCents < input.amountCents) {
      throw new Error("Pilot receipt, available balance or recipient readiness insufficient or mismatched");
    }
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await this.guard(db);
      // Serialize competing approvals and freeze the allocation from a single SQL snapshot.
      await db.query("SELECT pg_advisory_xact_lock(94002,hashtext($1))", [platformAccountId]);
      const project = await db.query("SELECT id FROM openpayables.projects WHERE id=$1", [input.projectId]);
      if (project.rowCount !== 1) throw new Error("Pilot project not found");
      const balances = await db.query(`SELECT contributor_id,SUM(points_delta)::BIGINT AS points
        FROM openpayables.credit_events WHERE project_id=$1 GROUP BY contributor_id
        HAVING SUM(points_delta)>0 ORDER BY contributor_id`, [input.projectId]);
      const allocations = allocateCents(input.amountCents, balances.rows.map(row => ({
        contributorId: String(row.contributor_id), points: Number(row.points),
      })));
      if (allocations.length !== 1 || allocations[0]?.contributorId !== input.contributorId) {
        throw new Error("First pilot requires exactly one positive-credit contributor matching the approved recipient");
      }
      const result = await db.query(`INSERT INTO openpayables.live_pilot_approvals
        (id,mode,project_id,contributor_id,points,amount_cents,platform_account_id,recipient_account_id,
         topup_id,balance_transaction_id,receipt_net_cents,observed_available_cents,authorization_reference)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [randomUUID(), this.mode, input.projectId, input.contributorId, allocations[0].points, input.amountCents,
        platformAccountId, input.recipientId, input.topupId, topup.balanceTransactionId, receiptNetCents,
        usdAvailableCents, input.authorizationReference.trim()]);
      await db.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally { db.release(); }
  }
}
