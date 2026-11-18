import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { allocateCents } from "../../core/allocation.js";
import type { PaymentProvider, ProviderTransfer, TransferInstruction, TestFundingProvider, TestTopupReceipt, TestTopupObservation, TestConnectedPayoutProvider, TestPayoutStatus } from "../../payments/provider.js";

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
      const locked = await db.query("SELECT id FROM openpayables.projects WHERE id=$1 FOR UPDATE", [nonblank(projectId, "project")]);
      if (locked.rowCount !== 1) throw new Error("Project not found");
      const verified = await db.query(
        "SELECT 1 FROM openpayables.funding_events WHERE project_id=$1 AND evidence_kind='stripe_test_topup' LIMIT 1", [projectId]);
      if (verified.rowCount) throw new Error("Cannot mix operator-attested funding with verified Stripe TEST receipts in one project");
      const result = await db.query(
        `INSERT INTO openpayables.funding_events(id,project_id,amount_cents,source_reference,attested_by)
         VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [randomUUID(), projectId, positiveCents(amountCents), nonblank(source, "source"), nonblank(operator, "operator")],
      );
      return result.rows[0];
    });
  }

  /** Bind one succeeded Stripe TEST receipt to one project. Not a claim that Stripe assigns the project. */
  async importTestTopup(projectId: string, topupId: string, provider: TestFundingProvider, operator: string) {
    projectId = nonblank(projectId, "project");
    operator = nonblank(operator, "operator");
    if (!/^tu_[A-Za-z0-9]+$/.test(topupId)) throw new Error("Invalid Stripe TEST top-up ID");
    // Provider calls are outside the DB transaction. No DB funding is inserted on failure.
    const receipt: TestTopupReceipt = await provider.verifyTestTopup(topupId);
    if (receipt.topupId !== topupId || receipt.currency !== "usd" ||
        !/^acct_[A-Za-z0-9]+$/.test(receipt.platformAccountId) ||
        !/^txn_[A-Za-z0-9]+$/.test(receipt.balanceTransactionId) ||
        !Number.isSafeInteger(receipt.amountCents) || receipt.amountCents <= 0) {
      throw new Error("Provider top-up evidence is invalid");
    }
    return this.transaction(async (db) => {
      // Project lock serializes imports, attested-fund additions, and approvals.
      const locked = await db.query("SELECT id FROM openpayables.projects WHERE id=$1 FOR UPDATE", [projectId]);
      if (locked.rowCount !== 1) throw new Error("Project not found");
      const existing = await db.query(
        "SELECT evidence_kind,stripe_platform_account_id FROM openpayables.funding_events WHERE project_id=$1", [projectId]);
      if (existing.rows.some((x) => x.evidence_kind !== "stripe_test_topup")) {
        throw new Error("Cannot mix Stripe TEST receipts with operator-attested funding in one project");
      }
      if (existing.rows.some((x) => x.stripe_platform_account_id !== receipt.platformAccountId)) {
        throw new Error("Cannot mix Stripe platforms within one project's verified TEST funding");
      }
      const binding = await db.query(
        "SELECT stripe_platform_account_id FROM openpayables.project_payment_platforms WHERE project_id=$1", [projectId]);
      if (binding.rowCount && binding.rows[0].stripe_platform_account_id !== receipt.platformAccountId) {
        throw new Error("Current Stripe TEST platform does not match the project's bound payment account");
      }
      const result = await db.query(
        `INSERT INTO openpayables.funding_events
          (id,project_id,amount_cents,source_reference,attested_by,evidence_kind,
           stripe_platform_account_id,stripe_topup_id,stripe_balance_transaction_id,verified_at)
         VALUES($1,$2,$3,$4,$5,'stripe_test_topup',$6,$7,$8,now())
         ON CONFLICT DO NOTHING RETURNING
           id,project_id,amount_cents,evidence_kind,stripe_platform_account_id,
           stripe_topup_id,stripe_balance_transaction_id,verified_at`,
        [randomUUID(), projectId, receipt.amountCents, `stripe-test:${receipt.platformAccountId}:${topupId}`,
          operator, receipt.platformAccountId, topupId, receipt.balanceTransactionId],
      );
      if (result.rowCount !== 1) throw new Error("Stripe TEST top-up already attributed; duplicate funding refused");
      // An imported verified receipt establishes the project's TEST payer account.
      if (!binding.rowCount) {
        await db.query(
          `INSERT INTO openpayables.project_payment_platforms
             (project_id,stripe_platform_account_id,bound_by) VALUES ($1,$2,$3)`,
          [projectId, receipt.platformAccountId, operator],
        );
      }
      return result.rows[0];
    });
  }

  /** Bind the current operator-owned Stripe TEST account, not a contributor's account. */
  async bindTestPlatform(projectId: string, provider: Pick<PaymentProvider, "platformAccountId">, operator: string) {
    projectId = nonblank(projectId, "project");
    operator = nonblank(operator, "operator");
    const platform = await provider.platformAccountId();
    if (!/^acct_[A-Za-z0-9]+$/.test(platform)) throw new Error("Invalid authenticated Stripe platform ID");
    return this.transaction(async (db) => {
      const project = await db.query("SELECT id FROM openpayables.projects WHERE id=$1 FOR UPDATE", [projectId]);
      if (project.rowCount !== 1) throw new Error("Project not found");
      const binding = await db.query(
        "SELECT project_id,stripe_platform_account_id,mode,bound_by,bound_at FROM openpayables.project_payment_platforms WHERE project_id=$1", [projectId]);
      if (binding.rowCount) {
        if (binding.rows[0].stripe_platform_account_id !== platform) {
          throw new Error("Project already bound to a different Stripe TEST platform; rebinding refused");
        }
        return binding.rows[0];
      }
      const receipts = await db.query(
        "SELECT DISTINCT stripe_platform_account_id FROM openpayables.funding_events WHERE project_id=$1 AND evidence_kind='stripe_test_topup'", [projectId]);
      if (receipts.rows.some((x) => x.stripe_platform_account_id !== platform)) {
        throw new Error("Project funding receipts belong to a different Stripe TEST platform");
      }
      // Legacy TEST transfer history without source-platform evidence cannot
      // be safely attached to a new payment account by a simple CLI command.
      const attempted = await db.query(
        `SELECT 1 FROM openpayables.payment_attempts a
         JOIN openpayables.distribution_obligations o ON o.id=a.obligation_id
         WHERE o.project_id=$1 LIMIT 1`, [projectId]);
      if (attempted.rowCount) {
        throw new Error("Unbound legacy project has payment attempts; verify history before binding a Stripe platform");
      }
      const inserted = await db.query(
        `INSERT INTO openpayables.project_payment_platforms
           (project_id,stripe_platform_account_id,bound_by)
         VALUES($1,$2,$3)
         RETURNING project_id,stripe_platform_account_id,mode,bound_by,bound_at`,
        [projectId, platform, operator],
      );
      return inserted.rows[0];
    });
  }

  /** Public Stripe account ID is safe to display; credentials are never persisted. */
  async boundTestPlatform(projectId: string) {
    const result = await this.pool.query(
      "SELECT project_id,stripe_platform_account_id,mode,bound_by,bound_at FROM openpayables.project_payment_platforms WHERE project_id=$1",
      [nonblank(projectId, "project")],
    );
    return result.rows[0] ?? null;
  }

  /** Fail before provider-side work when a project is unbound or uses another key. */
  async assertTestPlatform(projectId: string, provider: Pick<PaymentProvider, "platformAccountId">): Promise<string> {
    const bound = await this.boundTestPlatform(projectId);
    if (!bound) throw new Error("Project has no bound Stripe TEST platform; run stripe platform bind first");
    const actual = await provider.platformAccountId();
    if (bound.stripe_platform_account_id !== actual) {
      throw new Error("Stripe TEST credentials do not match this project's bound payment account");
    }
    return actual;
  }

  /** TEST funding is bound to one authenticated Stripe platform per project. */
  async verifiedPlatformForProject(projectId: string): Promise<string | null> {
    const rows = await this.pool.query(
      `SELECT DISTINCT stripe_platform_account_id FROM openpayables.funding_events
       WHERE project_id=$1 AND evidence_kind='stripe_test_topup'`,
      [nonblank(projectId, "project")],
    );
    if (rows.rows.length > 1) throw new Error("Verified project spans multiple Stripe platforms");
    return rows.rows.length ? String(rows.rows[0].stripe_platform_account_id) : null;
  }

  async verifiedPlatformForPeriod(periodId: string): Promise<string | null> {
    const period = await this.pool.query("SELECT project_id FROM openpayables.distribution_periods WHERE id=$1", [periodId]);
    if (period.rowCount !== 1) throw new Error("Distribution period not found");
    return this.verifiedPlatformForProject(String(period.rows[0].project_id));
  }

  /** Store a permanent, immutable warning when an imported TEST receipt changes. */
  private async recheckPlatformTestReceipts(
    platformId: string, provider: TestFundingProvider & Pick<PaymentProvider, "platformAccountId">, operator: string,
  ) {
    operator = nonblank(operator, "operator");
    if ((await provider.platformAccountId()) !== platformId) {
      throw new Error("Current Stripe TEST platform does not match verified funding receipts");
    }
    const receipts = await this.pool.query(
      `SELECT id,project_id,stripe_topup_id,stripe_balance_transaction_id,amount_cents
       FROM openpayables.funding_events
       WHERE evidence_kind='stripe_test_topup' AND stripe_platform_account_id=$1
       ORDER BY project_id,id`, [platformId],
    );
    let flagged = 0;
    for (const receipt of receipts.rows) {
      // A provider/network failure is NOT interpreted as a reversal. It aborts preflight.
      const observed: TestTopupObservation = await provider.inspectTestTopup(String(receipt.stripe_topup_id));
      const ok = observed.topupId === receipt.stripe_topup_id &&
        observed.platformAccountId === platformId && observed.status === "succeeded" &&
        observed.currency === "usd" && observed.amountCents === safeNumber(receipt.amount_cents) &&
        observed.balanceTransactionId === receipt.stripe_balance_transaction_id;
      if (!ok) {
        const reason = `Provider receipt changed: status=${observed.status}; amount=${observed.amountCents}; currency=${observed.currency}; transaction=${observed.balanceTransactionId ?? "none"}; account=${observed.platformAccountId}`.slice(0, 450);
        const inserted = await this.transaction(async (db) => {
          // Project lock prevents this receipt being flagged during its own approval.
          // Do NOT acquire the platform lock: a sending process can hold it while rechecking.
          await db.query("SELECT id FROM openpayables.projects WHERE id=$1 FOR UPDATE", [receipt.project_id]);
          const result = await db.query(
            `INSERT INTO openpayables.funding_receipt_alerts
               (funding_event_id,project_id,observed_status,reason,identified_by)
             VALUES($1,$2,$3,$4,$5) ON CONFLICT(funding_event_id) DO NOTHING
             RETURNING funding_event_id`,
            [receipt.id, receipt.project_id, observed.status, reason, operator],
          );
          return result.rowCount === 1;
        });
        if (inserted) flagged++;
      }
    }
    const alerts = await this.pool.query(
      `SELECT COUNT(*)::INT AS n FROM openpayables.funding_receipt_alerts a
       JOIN openpayables.funding_events f ON f.id=a.funding_event_id
       WHERE f.stripe_platform_account_id=$1`, [platformId],
    );
    return { platformAccountId: platformId, checked: receipts.rows.length, newlyObservedProblems: flagged,
      blockedReceipts: Number(alerts.rows[0].n) };
  }

  async recheckProjectTestFunding(
    projectId: string, provider: TestFundingProvider & Pick<PaymentProvider, "platformAccountId">, operator: string,
  ) {
    const platform = await this.verifiedPlatformForProject(projectId);
    if (!platform) throw new Error("Project has no verified Stripe TEST funding to recheck");
    return this.recheckPlatformTestReceipts(platform, provider, operator);
  }

  /** Historical provider receipts minus permanent hold alerts, and all frozen approved periods. */
  private async platformFundingSummary(platformId: string, db: Pool | PoolClient = this.pool) {
    const result = await db.query(
      `SELECT
        (SELECT COALESCE(SUM(f.amount_cents),0)
         FROM openpayables.funding_events f
         LEFT JOIN openpayables.funding_receipt_alerts a ON a.funding_event_id=f.id
         WHERE f.evidence_kind='stripe_test_topup' AND f.stripe_platform_account_id=$1
           AND a.funding_event_id IS NULL) AS funded,
        (SELECT COALESCE(SUM(d.amount_cents),0)
         FROM openpayables.distribution_periods d
         WHERE d.status='approved' AND EXISTS (
           SELECT 1 FROM openpayables.funding_events f
           WHERE f.project_id=d.project_id AND f.evidence_kind='stripe_test_topup'
             AND f.stripe_platform_account_id=$1)) AS committed`, [platformId],
    );
    return { fundedCents: safeNumber(result.rows[0].funded), committedCents: safeNumber(result.rows[0].committed) };
  }

  /** Outstanding obligations belong to the platform even when another project is sending. */
  private async platformUnpaidCents(platformId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COALESCE(SUM(o.amount_cents),0) AS cents
       FROM openpayables.distribution_obligations o
       WHERE o.status IN ('held','ready','submitting','unknown','reversal_review','reversed')
         AND EXISTS (SELECT 1 FROM openpayables.funding_events f
           WHERE f.project_id=o.project_id AND f.evidence_kind='stripe_test_topup'
             AND f.stripe_platform_account_id=$1)`, [platformId],
    );
    return safeNumber(result.rows[0].cents);
  }

  /** Serialize TEST payment preflight and provider transfer against one Stripe platform. */
  private async withPlatformLock<T>(platformId: string, fn: () => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    let acquired = false;
    let discardConnection = false;
    let operationFailed = false;
    let operationError: unknown;
    let releaseError: Error | undefined;
    let result!: T;

    try {
      await db.query("SELECT pg_advisory_lock(94001,hashtext($1))", [platformId]);
      acquired = true;
      result = await fn();
    } catch (error) {
      operationFailed = true;
      operationError = error;
      // A failed lock acquisition may have reached PostgreSQL. Do not reuse the session.
      if (!acquired) discardConnection = true;
    }

    if (acquired) {
      try {
        const unlocked = await db.query(
          "SELECT pg_advisory_unlock(94001,hashtext($1)) AS unlocked", [platformId],
        );
        if (unlocked.rows[0]?.unlocked !== true) {
          throw new Error("Stripe platform advisory lock could not be released");
        }
      } catch (error) {
        // Never return a possibly locked session to the connection pool.
        discardConnection = true;
        releaseError = error instanceof Error ? error : new Error(String(error));
      }
    }
    db.release(discardConnection);

    if (releaseError) throw releaseError;
    if (operationFailed) throw operationError;
    return result;
  }

  async fundingStatus(projectId: string) {
    const result = await this.pool.query(
      `SELECT
        (SELECT COALESCE(SUM(amount_cents),0) FROM openpayables.funding_events
          WHERE project_id=$1 AND evidence_kind='attested_test') AS attested,
        (SELECT COALESCE(SUM(amount_cents),0) FROM openpayables.funding_events
          WHERE project_id=$1 AND evidence_kind='stripe_test_topup') AS verified_test,
        (SELECT COALESCE(SUM(f.amount_cents),0) FROM openpayables.funding_events f
          JOIN openpayables.funding_receipt_alerts a ON a.funding_event_id=f.id
          WHERE f.project_id=$1) AS blocked_test,
        (SELECT COALESCE(SUM(amount_cents),0) FROM openpayables.distribution_periods
          WHERE project_id=$1 AND status='approved') AS reserved`,
      [nonblank(projectId, "project")],
    );
    const attestedCents = safeNumber(result.rows[0].attested);
    const verifiedTestCents = safeNumber(result.rows[0].verified_test);
    const blockedVerifiedCents = safeNumber(result.rows[0].blocked_test);
    const reservedCents = safeNumber(result.rows[0].reserved);
    return {
      projectId, attestedCents, verifiedTestCents, blockedVerifiedCents, reservedCents,
      remainingCents: attestedCents + verifiedTestCents - blockedVerifiedCents - reservedCents,
    };
  }

  async createPeriod(projectId: string, label: string, amountCents: number, operator: string) {
    const result = await this.pool.query(
      `INSERT INTO openpayables.distribution_periods(id,project_id,label,amount_cents,created_by)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [randomUUID(), nonblank(projectId, "project"), nonblank(label, "label"), positiveCents(amountCents), nonblank(operator, "operator")],
    );
    return result.rows[0];
  }

  async approvePeriod(
    periodId: string, operator: string,
    provider?: TestFundingProvider & Pick<PaymentProvider, "platformAccountId">,
  ) {
    const preflightPlatform = await this.verifiedPlatformForPeriod(periodId);
    if (preflightPlatform) {
      if (!provider) throw new Error("Verified Stripe TEST funding requires a provider recheck before approval");
      await this.recheckPlatformTestReceipts(preflightPlatform, provider, operator);
    }
    return this.transaction(async (db) => {
      // Serialize all fund reservations for a project. Concurrent approvals cannot oversubscribe.
      const periodResult = await db.query("SELECT * FROM openpayables.distribution_periods WHERE id=$1", [periodId]);
      if (periodResult.rowCount !== 1) throw new Error("Distribution period not found");
      const period = periodResult.rows[0];
      await db.query("SELECT id FROM openpayables.projects WHERE id=$1 FOR UPDATE", [period.project_id]);
      const locked = await db.query("SELECT * FROM openpayables.distribution_periods WHERE id=$1 FOR UPDATE", [periodId]);
      if (locked.rows[0].status !== "draft") throw new Error("Distribution period already approved");
      const platformRows = await db.query(
        `SELECT DISTINCT stripe_platform_account_id FROM openpayables.funding_events
         WHERE project_id=$1 AND evidence_kind='stripe_test_topup'`, [period.project_id],
      );
      if (platformRows.rows.length > 1) throw new Error("Verified project spans multiple Stripe platforms");
      const platform = platformRows.rows.length ? String(platformRows.rows[0].stripe_platform_account_id) : null;
      if (platform) {
        if (platform !== preflightPlatform) throw new Error("Project funding changed during approval; retry inspection");
        await db.query("SELECT pg_advisory_xact_lock(94001,hashtext($1))", [platform]);
      }
      const pool = await db.query(
        `SELECT
          (SELECT COALESCE(SUM(f.amount_cents),0) FROM openpayables.funding_events f
           LEFT JOIN openpayables.funding_receipt_alerts a ON a.funding_event_id=f.id
           WHERE f.project_id=$1 AND a.funding_event_id IS NULL) AS funded,
          (SELECT COALESCE(SUM(amount_cents),0) FROM openpayables.distribution_periods
            WHERE project_id=$1 AND status='approved') AS reserved`,
        [period.project_id],
      );
      const available = safeNumber(pool.rows[0].funded) - safeNumber(pool.rows[0].reserved);
      if (available < safeNumber(period.amount_cents)) throw new Error("Insufficient unreserved project funding");
      if (platform) {
        const summary = await this.platformFundingSummary(platform, db);
        if (summary.fundedCents - summary.committedCents < safeNumber(period.amount_cents)) {
          throw new Error("Insufficient uncommitted verified TEST funds across Stripe platform projects");
        }
      }

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
    await this.assertTestPlatform(obligation.projectId, provider);
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
  async submitObligation(id: string, provider: PaymentProvider & Partial<TestFundingProvider>): Promise<Obligation> {
    const pending = await this.getObligation(id);
    if (pending.status !== "ready" || !pending.connectedAccountId) {
      throw new Error(`Not sendable (status=${pending.status}); no retry after uncertain payment`);
    }
    await this.assertTestPlatform(pending.projectId, provider);
    const platform = await this.verifiedPlatformForProject(pending.projectId);
    if (!platform) return this.sendAfterPreflight(id, provider, pending.amountCents);
    if ((await provider.platformAccountId()) !== platform) {
      throw new Error("Current Stripe TEST platform does not match project funding receipts; no payment attempted");
    }
    if (!provider.inspectTestTopup) {
      throw new Error("Provider cannot recheck verified Stripe TEST funding; no payment attempted");
    }
    // Recheck first, outside the platform lock, so a simultaneous distribution
    // approval cannot deadlock with a receipt-audit project lock.
    await this.recheckPlatformTestReceipts(
      platform, provider as PaymentProvider & TestFundingProvider, "automatic-payment-preflight",
    );
    // The session advisory lock remains held until transfer/reconciliation finish.
    // Concurrent verified-project sends cannot use the same balance snapshot.
    return this.withPlatformLock(platform, async () => {
      const summary = await this.platformFundingSummary(platform);
      if (summary.fundedCents < summary.committedCents) {
        throw new Error("Stripe TEST verified funding shortfall across projects; payment blocked for review");
      }
      const outstanding = await this.platformUnpaidCents(platform);
      return this.sendAfterPreflight(id, provider, Math.max(pending.amountCents, outstanding));
    });
  }

  /** Stripe enforces actual liquidity; local preflight is not a Stripe reservation. */
  private async sendAfterPreflight(id: string, provider: PaymentProvider, requiredAvailable: number): Promise<Obligation> {
    const available = await provider.availableBalanceCents("usd");
    if (!Number.isSafeInteger(available) || available < requiredAvailable) {
      throw new Error(`Insufficient available Stripe TEST platform funds: ${available} cents for ${requiredAvailable}-cent obligation/commitments; no payment attempt reserved`);
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
    await this.assertTestPlatform(o.projectId, provider);
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

  /**
   * Observe connected-account bank payouts, not individual transfer settlements.
   * No transfers/payouts are created. No distribution obligations are updated.
   */
  async syncConnectedPayouts(
    projectId: string, contributorId: string, provider: TestConnectedPayoutProvider, operator: string,
  ) {
    projectId = nonblank(projectId, "project");
    contributorId = nonblank(contributorId, "contributor");
    operator = nonblank(operator, "operator");
    const platformId = await this.assertTestPlatform(projectId, provider);
    const assigned = await this.pool.query(
      `SELECT stripe_account_id FROM openpayables.payment_destinations
       WHERE project_id=$1 AND contributor_id=$2`, [projectId, contributorId],
    );
    if (assigned.rowCount !== 1) throw new Error("Contributor has no configured Stripe TEST payout destination");
    const connectedId: string = String(assigned.rows[0].stripe_account_id);
    const observed = await provider.listConnectedPayouts(connectedId);
    // Validate even fake/alternate provider implementations before any database writes.
    const ids = new Set<string>();
    const statuses: TestPayoutStatus[] = ["pending", "in_transit", "paid", "failed", "canceled"];
    for (const p of observed) {
      if (!/^po_[A-Za-z0-9]+$/.test(p.id) || ids.has(p.id) || p.livemode !== false ||
        !Number.isSafeInteger(p.amount) || p.amount <= 0 ||
        !/^[a-z]{3}$/.test(p.currency) || !statuses.includes(p.status) ||
        !Number.isSafeInteger(p.created) || p.created < 0 ||
        (p.arrival_date !== null && (!Number.isSafeInteger(p.arrival_date) || p.arrival_date < 0)) ||
        (p.destination !== null && !/^[A-Za-z0-9_]+$/.test(p.destination)) ||
        (p.failure_code !== null && (typeof p.failure_code !== "string" || p.failure_code.length > 128))) {
        throw new Error("Invalid Stripe TEST connected payout evidence; sync aborted");
      }
      ids.add(p.id);
    }
    return this.transaction(async (db) => {
      // Lock the project to serialize competing payout syncs; lock the assigned
      // destination row to ensure a concurrent reassignment cannot cross scopes.
      const project = await db.query("SELECT id FROM openpayables.projects WHERE id=$1 FOR UPDATE", [projectId]);
      if (project.rowCount !== 1) throw new Error("Project not found");
      const current = await db.query(
        `SELECT stripe_account_id FROM openpayables.payment_destinations
         WHERE project_id=$1 AND contributor_id=$2 FOR UPDATE`, [projectId, contributorId],
      );
      if (current.rowCount !== 1 || current.rows[0].stripe_account_id !== connectedId) {
        throw new Error("Payout destination changed during inspection; sync refused");
      }
      const bound = await db.query(
        "SELECT stripe_platform_account_id FROM openpayables.project_payment_platforms WHERE project_id=$1", [projectId],
      );
      if (bound.rowCount !== 1 || bound.rows[0].stripe_platform_account_id !== platformId) {
        throw new Error("Stripe project binding changed during payout inspection");
      }
      let newPayouts = 0;
      let changes = 0;
      for (const p of observed) {
        const prior = await db.query(
          `SELECT * FROM openpayables.connected_payouts
           WHERE project_id=$1 AND contributor_id=$2 AND stripe_payout_id=$3 FOR UPDATE`,
          [projectId, contributorId, p.id],
        );
        if (prior.rowCount !== 0) {
          const old = prior.rows[0];
          // An existing payout's identity and money fields are immutable.
          if (old.stripe_platform_account_id !== platformId || old.connected_account_id !== connectedId ||
            safeNumber(old.amount_cents) !== p.amount || old.currency !== p.currency ||
            safeNumber(old.created_unix) !== p.created || old.payout_destination_id !== p.destination) {
            throw new Error("Previously observed Stripe payout identity or amount changed; manual review required");
          }
          const oldStatus = String(old.current_status);
          const allowed: Record<string, string[]> = {
            pending: ["pending", "in_transit", "paid", "failed", "canceled"],
            in_transit: ["in_transit", "paid", "failed", "canceled"],
            paid: ["paid", "failed"],
            failed: ["failed"],
            canceled: ["canceled"],
          };
          if (!allowed[oldStatus]?.includes(p.status)) {
            throw new Error("Stripe payout status regressed; manual review required");
          }
          if (oldStatus === p.status &&
            (old.arrival_unix === null ? null : safeNumber(old.arrival_unix)) === p.arrival_date &&
            old.failure_code === p.failure_code) continue;
          await db.query(
            `UPDATE openpayables.connected_payouts
             SET current_status=$4,arrival_unix=$5,failure_code=$6,last_observed_at=now()
             WHERE project_id=$1 AND contributor_id=$2 AND stripe_payout_id=$3`,
            [projectId, contributorId, p.id, p.status, p.arrival_date, p.failure_code],
          );
        } else {
          await db.query(
            `INSERT INTO openpayables.connected_payouts
             (project_id,contributor_id,stripe_payout_id,stripe_platform_account_id,connected_account_id,
              amount_cents,currency,payout_destination_id,created_unix,current_status,arrival_unix,failure_code)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [projectId, contributorId, p.id, platformId, connectedId, p.amount, p.currency,
              p.destination, p.created, p.status, p.arrival_date, p.failure_code],
          );
          newPayouts++;
        }
        await db.query(
          `INSERT INTO openpayables.connected_payout_observations
           (id,project_id,contributor_id,stripe_payout_id,status,arrival_unix,failure_code,observed_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [randomUUID(), projectId, contributorId, p.id, p.status, p.arrival_date, p.failure_code, operator],
        );
        changes++;
      }
      return {
        projectId, contributorId, platformAccountId: platformId, connectedAccountId: connectedId,
        observedPayouts: observed.length, newPayouts, newObservations: changes,
        individualObligationsSettled: 0,
        note: "Bank payout records are account-level; no individual OpenPayables transfer is marked bank-settled.",
      };
    });
  }

  /** Local audit view: never labels individual contribution-payment obligations as settled. */
  async connectedPayoutHistory(projectId: string, contributorId: string) {
    projectId = nonblank(projectId, "project");
    contributorId = nonblank(contributorId, "contributor");
    const payouts = await this.pool.query(
      `SELECT stripe_payout_id,connected_account_id,amount_cents,currency,
              current_status,arrival_unix,failure_code,first_observed_at,last_observed_at
       FROM openpayables.connected_payouts
       WHERE project_id=$1 AND contributor_id=$2 ORDER BY first_observed_at,stripe_payout_id`,
      [projectId, contributorId],
    );
    const events = await this.pool.query(
      `SELECT stripe_payout_id,status,arrival_unix,failure_code,observed_by,observed_at
       FROM openpayables.connected_payout_observations
       WHERE project_id=$1 AND contributor_id=$2 ORDER BY observed_at,id`,
      [projectId, contributorId],
    );
    return {
      projectId, contributorId,
      payouts: payouts.rows.map((r) => ({ ...r, amount_cents: safeNumber(r.amount_cents) })),
      events: events.rows,
      note: "Connected-account payouts are not uniquely attributable to OpenPayables transfers.",
    };
  }

  async paymentHistory(id: string) {
    const o = await this.getObligation(id);
    const events = await this.pool.query(
      "SELECT event_type,description,created_at FROM openpayables.payment_events WHERE obligation_id=$1 ORDER BY created_at,id", [id],
    );
    return { obligation: o, events: events.rows };
  }
}
