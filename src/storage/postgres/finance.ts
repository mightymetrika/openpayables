import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { allocateCents } from "../../core/allocation.js";
import type { PaymentProvider, ProviderTransfer, TransferInstruction } from "../../payments/provider.js";

function nonblank(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonblank`);
  return value.trim();
}
function positiveCents(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Amount must be positive integer cents");
  return value;
}
function safeNumber(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error("Database integer exceeds safe JavaScript range");
  return n;
}
export interface Obligation {
  id: string; periodId: string; projectId: string; contributorId: string;
  amountCents: number; points: number; status: string;
  connectedAccountId: string | null; transferId: string | null; idempotencyKey: string;
}
function mapObligation(row: Record<string, unknown>): Obligation {
  return {
    id: String(row.id), periodId: String(row.period_id), projectId: String(row.project_id),
    contributorId: String(row.contributor_id), amountCents: safeNumber(row.amount_cents),
    points: safeNumber(row.points), status: String(row.status),
    connectedAccountId: row.connected_account_id ? String(row.connected_account_id) : null,
    transferId: row.transfer_id ? String(row.transfer_id) : null,
    idempotencyKey: String(row.idempotency_key),
  };
}

/** Payment orchestration runs only from a trusted operator or signed webhook service. */
export class OpenPayablesFinance {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const value = await fn(db);
      await db.query("COMMIT");
      return value;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally { db.release(); }
  }

  /** Operator attestation is NOT automatic bank-balance verification. TEST funds only. */
  async addFunding(projectId: string, amountCents: number, source: string, operator: string) {
    return this.transaction(async (db) => {
      await db.query("SELECT id FROM openpayables.projects WHERE id=$1 FOR UPDATE", [nonblank(projectId, "project")]);
      const result = await db.query(
        `INSERT INTO openpayables.funding_events(id,project_id,amount_cents,source_reference,attested_by)
         VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [randomUUID(), projectId, positiveCents(amountCents), nonblank(source, "source"), nonblank(operator, "operator")],
      );
      return result.rows[0];
    });
  }

  async fundingStatus(projectId: string) {
    const result = await this.pool.query(
      `SELECT
        (SELECT COALESCE(SUM(amount_cents),0) FROM openpayables.funding_events WHERE project_id=$1) AS attested,
        (SELECT COALESCE(SUM(amount_cents),0) FROM openpayables.distribution_periods
          WHERE project_id=$1 AND status='approved') AS reserved`,
      [nonblank(projectId, "project")],
    );
    const attestedCents = safeNumber(result.rows[0].attested);
    const reservedCents = safeNumber(result.rows[0].reserved);
    return { projectId, attestedCents, reservedCents, remainingCents: attestedCents - reservedCents };
  }

  async createPeriod(projectId: string, label: string, amountCents: number, operator: string) {
    const result = await this.pool.query(
      `INSERT INTO openpayables.distribution_periods(id,project_id,label,amount_cents,created_by)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [randomUUID(), nonblank(projectId, "project"), nonblank(label, "label"), positiveCents(amountCents), nonblank(operator, "operator")],
    );
    return result.rows[0];
  }

  async approvePeriod(periodId: string, operator: string) {
    return this.transaction(async (db) => {
      // Serialize all fund reservations for a project. Concurrent approvals cannot oversubscribe.
      const periodResult = await db.query("SELECT * FROM openpayables.distribution_periods WHERE id=$1", [periodId]);
      if (periodResult.rowCount !== 1) throw new Error("Distribution period not found");
      const period = periodResult.rows[0];
      await db.query("SELECT id FROM openpayables.projects WHERE id=$1 FOR UPDATE", [period.project_id]);
      const locked = await db.query("SELECT * FROM openpayables.distribution_periods WHERE id=$1 FOR UPDATE", [periodId]);
      if (locked.rows[0].status !== "draft") throw new Error("Distribution period already approved");
      const pool = await db.query(
        `SELECT
          (SELECT COALESCE(SUM(amount_cents),0) FROM openpayables.funding_events WHERE project_id=$1) AS funded,
          (SELECT COALESCE(SUM(amount_cents),0) FROM openpayables.distribution_periods
            WHERE project_id=$1 AND status='approved') AS reserved`,
        [period.project_id],
      );
      const available = safeNumber(pool.rows[0].funded) - safeNumber(pool.rows[0].reserved);
      if (available < safeNumber(period.amount_cents)) throw new Error("Insufficient attested unreserved funding");

      const balances = await db.query(
        `SELECT contributor_id, SUM(points_delta)::BIGINT AS points
         FROM openpayables.credit_events WHERE project_id=$1
         GROUP BY contributor_id HAVING SUM(points_delta)>0 ORDER BY contributor_id`,
        [period.project_id],
      );
      const allocations = allocateCents(safeNumber(period.amount_cents), balances.rows.map((row) => ({
        contributorId: String(row.contributor_id), points: safeNumber(row.points),
      })));
      for (const x of allocations) {
        await db.query(
          `INSERT INTO openpayables.distribution_snapshot(period_id,contributor_id,points,amount_cents)
           VALUES($1,$2,$3,$4)`, [periodId, x.contributorId, x.points, x.amountCents],
        );
        if (x.amountCents > 0) {
          const id = randomUUID();
          await db.query(
            `INSERT INTO openpayables.distribution_obligations
              (id,period_id,project_id,contributor_id,points,amount_cents,idempotency_key)
             VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [id, periodId, period.project_id, x.contributorId, x.points, x.amountCents, `op-test-${id}`],
          );
        }
      }
      await db.query(`UPDATE openpayables.distribution_periods
        SET status='approved',approved_by=$2,approved_at=now() WHERE id=$1`,
      [periodId, nonblank(operator, "operator")]);
      return { periodId, projectId: period.project_id, amountCents: safeNumber(period.amount_cents), allocations };
    });
  }

  async showPeriod(periodId: string) {
    const period = await this.pool.query("SELECT * FROM openpayables.distribution_periods WHERE id=$1", [periodId]);
    if (period.rowCount !== 1) throw new Error("Period not found");
    const snapshot = await this.pool.query(
      "SELECT contributor_id,points,amount_cents FROM openpayables.distribution_snapshot WHERE period_id=$1 ORDER BY contributor_id", [periodId],
    );
    const obligations = await this.pool.query(
      "SELECT * FROM openpayables.distribution_obligations WHERE period_id=$1 ORDER BY contributor_id", [periodId],
    );
    return {
      period: period.rows[0],
      snapshot: snapshot.rows.map((x) => ({ contributorId: x.contributor_id, points: safeNumber(x.points), amountCents: safeNumber(x.amount_cents) })),
      obligations: obligations.rows.map(mapObligation),
    };
  }

  async setDestination(projectId: string, contributorId: string, accountId: string, operator: string) {
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error("Expected Stripe acct_... identifier");
    return this.transaction(async (db) => {
      const check = await db.query(
        `SELECT COUNT(*)::INT AS count FROM openpayables.distribution_obligations
         WHERE project_id=$1 AND contributor_id=$2 AND status IN ('ready','submitting')`,
        [projectId, contributorId],
      );
      if (check.rows[0].count > 0) throw new Error("A prepared or submitting obligation must be resolved before replacing destination");
      const result = await db.query(
        `INSERT INTO openpayables.payment_destinations(project_id,contributor_id,stripe_account_id,assigned_by)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(project_id,contributor_id) DO UPDATE
           SET stripe_account_id=EXCLUDED.stripe_account_id,assigned_by=EXCLUDED.assigned_by,assigned_at=now()
         RETURNING project_id,contributor_id,stripe_account_id`,
        [nonblank(projectId, "project"), nonblank(contributorId, "contributor"), accountId, nonblank(operator, "operator")],
      );
      return result.rows[0];
    });
  }

  async getObligation(id: string): Promise<Obligation> {
    const result = await this.pool.query("SELECT * FROM openpayables.distribution_obligations WHERE id=$1", [id]);
    if (result.rowCount !== 1) throw new Error("Obligation not found");
    return mapObligation(result.rows[0]);
  }

  async prepareObligation(id: string, provider: PaymentProvider): Promise<Obligation> {
    const obligation = await this.getObligation(id);
    if (obligation.status !== "held") throw new Error("Only held obligations may be prepared");
    const destination = await this.pool.query(
      "SELECT stripe_account_id FROM openpayables.payment_destinations WHERE project_id=$1 AND contributor_id=$2",
      [obligation.projectId, obligation.contributorId],
    );
    if (destination.rowCount !== 1) throw new Error("Contributor has no Stripe destination; obligation remains held");
    const accountId = String(destination.rows[0].stripe_account_id);
    if (!(await provider.accountReady(accountId))) throw new Error("Stripe destination is not payout-enabled; obligation remains held");
    return this.transaction(async (db) => {
      const result = await db.query(
        `UPDATE openpayables.distribution_obligations
         SET status='ready',connected_account_id=$2,updated_at=now()
         WHERE id=$1 AND status='held' RETURNING *`, [id, accountId],
      );
      if (result.rowCount !== 1) throw new Error("Obligation concurrently changed; cannot prepare");
      await this.recordEvent(db, id, "ready", `Verified Stripe TEST recipient ${accountId}`);
      return mapObligation(result.rows[0]);
    });
  }

  private async recordEvent(db: PoolClient, id: string, eventType: string, description: string) {
    await db.query(
      "INSERT INTO openpayables.payment_events(id,obligation_id,event_type,description) VALUES($1,$2,$3,$4)",
      [randomUUID(), id, eventType, description.slice(0, 500)],
    );
  }

  /** A transfer call happens at most ONCE per obligation. Ambiguous results are reconciliation-only. */
  async submitObligation(id: string, provider: PaymentProvider): Promise<Obligation> {
    // Read-only provider liquidity check BEFORE reserving an immutable payment attempt.
    // This is a safety preflight, not proof of a project's funded revenue or an
    // atomic reservation at Stripe; Stripe still enforces final transfer availability.
    const pending = await this.getObligation(id);
    if (pending.status !== "ready" || !pending.connectedAccountId) {
      throw new Error(`Not sendable (status=${pending.status}); no retry after uncertain payment`);
    }
    const available = await provider.availableBalanceCents("usd");
    if (!Number.isSafeInteger(available) || available < pending.amountCents) {
      throw new Error(`Insufficient available Stripe TEST platform funds: ${available} cents for ${pending.amountCents}-cent obligation; no payment attempt reserved`);
    }
    const instruction = await this.transaction(async (db): Promise<TransferInstruction> => {
      const result = await db.query("SELECT * FROM openpayables.distribution_obligations WHERE id=$1 FOR UPDATE", [id]);
      if (result.rowCount !== 1) throw new Error("Obligation not found");
      const o = mapObligation(result.rows[0]);
      if (o.status !== "ready" || !o.connectedAccountId) throw new Error(`Not sendable (status=${o.status}); no retry after uncertain payment`);
      await db.query("INSERT INTO openpayables.payment_attempts(id,obligation_id,idempotency_key) VALUES($1,$2,$3)",
        [randomUUID(), id, o.idempotencyKey]);
      await db.query("UPDATE openpayables.distribution_obligations SET status='submitting',updated_at=now() WHERE id=$1", [id]);
      await this.recordEvent(db, id, "submitting", "TEST transfer attempt reserved before external request");
      return {
        obligationId: o.id, periodId: o.periodId, projectId: o.projectId,
        amountCents: o.amountCents, destination: o.connectedAccountId, idempotencyKey: o.idempotencyKey,
      };
    });
    try {
      const transfer = await provider.createTransfer(instruction);
      return await this.acceptProviderTransfer(id, transfer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Even HTTP 4xx or a timeout does not authorize another transfer attempt.
      await this.pool.query(
        `UPDATE openpayables.distribution_obligations
         SET status='unknown',last_error=$2,updated_at=now()
         WHERE id=$1 AND status='submitting'`, [id, message.slice(0, 500)],
      );
      await this.pool.query("UPDATE openpayables.payment_attempts SET error_message=$2 WHERE obligation_id=$1", [id, message.slice(0, 500)]);
      return this.getObligation(id);
    }
  }

  async acceptProviderTransfer(id: string, transfer: ProviderTransfer): Promise<Obligation> {
    return this.transaction(async (db) => {
      const result = await db.query("SELECT * FROM openpayables.distribution_obligations WHERE id=$1 FOR UPDATE", [id]);
      if (result.rowCount !== 1) throw new Error("Obligation not found");
      const o = mapObligation(result.rows[0]);
      if (!["submitting", "unknown", "transferred", "reversal_review", "reversed"].includes(o.status)) {
        throw new Error("Unattempted obligation cannot accept external transfer");
      }
      if (transfer.amount !== o.amountCents || transfer.currency !== "usd" ||
        transfer.destination !== o.connectedAccountId || transfer.metadata?.obligation_id !== id ||
        transfer.metadata?.period_id !== o.periodId || transfer.metadata?.project_id !== o.projectId) {
        throw new Error("Stripe transfer does not match frozen payout obligation");
      }
      if (o.transferId && o.transferId !== transfer.id) throw new Error("Conflicting Stripe transfer ID: investigate duplicate payout");
      if (o.status === "reversed" && transfer.amount_reversed !== transfer.amount) {
        throw new Error("Previously reversed transfer now shows inconsistent amount");
      }
      if (o.status === "reversal_review" && transfer.amount_reversed === 0) {
        throw new Error("Stale transfer data cannot undo partial reversal");
      }
      const next = transfer.amount_reversed >= transfer.amount ? "reversed"
        : transfer.amount_reversed > 0 ? "reversal_review" : "transferred";
      const updated = await db.query(
        `UPDATE openpayables.distribution_obligations
         SET transfer_id=$2,status=$3,last_error=NULL,updated_at=now() WHERE id=$1 RETURNING *`, [id, transfer.id, next],
      );
      await db.query(
        `UPDATE openpayables.payment_attempts SET provider_transfer_id=$2 WHERE obligation_id=$1`, [id, transfer.id],
      );
      if (next !== o.status || !o.transferId) await this.recordEvent(db, id, next, `Stripe TEST transfer ${transfer.id}`);
      return mapObligation(updated.rows[0]);
    });
  }

  async reconcileObligation(id: string, provider: PaymentProvider): Promise<Obligation> {
    const o = await this.getObligation(id);
    if (!["submitting", "unknown", "transferred", "reversal_review", "reversed"].includes(o.status)) {
      throw new Error("Obligation has not been submitted");
    }
    const transfer = o.transferId ? await provider.retrieveTransfer(o.transferId)
      : await provider.findTransferByObligation(id);
    return transfer ? this.acceptProviderTransfer(id, transfer) : this.getObligation(id);
  }

  /** Caller must verify the provider's signed webhook and test-mode event before invoking. */
  async recordVerifiedStripeEvent(eventId: string, eventType: string, transfer: ProviderTransfer) {
    return this.transaction(async (db) => {
      const inserted = await db.query(
        `INSERT INTO openpayables.stripe_webhook_events(stripe_event_id,event_type)
         VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING stripe_event_id`, [nonblank(eventId, "event ID"), eventType],
      );
      if (inserted.rowCount === 0) return { duplicate: true, updated: false };
      const id = transfer.metadata?.obligation_id;
      if (!id) return { duplicate: false, updated: false };
      // Process via same connection and lock to keep receipt dedup + obligation adjustment atomic.
      const rows = await db.query("SELECT * FROM openpayables.distribution_obligations WHERE id=$1 FOR UPDATE", [id]);
      if (rows.rowCount !== 1) return { duplicate: false, updated: false };
      const o = mapObligation(rows.rows[0]);
      if (!["submitting", "unknown", "transferred", "reversal_review", "reversed"].includes(o.status)) return { duplicate: false, updated: false };
      if (transfer.amount !== o.amountCents || transfer.currency !== "usd" ||
        transfer.destination !== o.connectedAccountId || transfer.metadata?.period_id !== o.periodId ||
        transfer.metadata?.project_id !== o.projectId || (o.transferId && transfer.id !== o.transferId)) {
        throw new Error("Webhook transfer mismatch; event rejected");
      }
      const next = transfer.amount_reversed >= transfer.amount ? "reversed"
        : transfer.amount_reversed > 0 ? "reversal_review" : "transferred";
      if ((o.status === "reversed" && next !== "reversed") ||
        (o.status === "reversal_review" && next === "transferred")) {
        // Webhook delivery is not ordered; an older event must not undo a reversal.
        return { duplicate: false, updated: false };
      }
      await db.query(
        `UPDATE openpayables.distribution_obligations
         SET transfer_id=$2,status=$3,last_error=NULL,updated_at=now() WHERE id=$1`, [id, transfer.id, next],
      );
      await db.query("UPDATE openpayables.payment_attempts SET provider_transfer_id=$2 WHERE obligation_id=$1", [id, transfer.id]);
      if (o.status !== next || !o.transferId) await this.recordEvent(db, id, next, `Verified Stripe TEST webhook ${eventId}`);
      return { duplicate: false, updated: true };
    });
  }

  async paymentHistory(id: string) {
    const o = await this.getObligation(id);
    const events = await this.pool.query(
      "SELECT event_type,description,created_at FROM openpayables.payment_events WHERE obligation_id=$1 ORDER BY created_at,id", [id],
    );
    return { obligation: o, events: events.rows };
  }
}
