import type { Pool } from "pg";
import { pilotIdempotencyKey, type PilotTransferInstruction, type PilotTransferProvider, type PilotTransferObservation } from "../../payments/stripe/live-transfer.js";

interface ExecutionInput {
  approvalId: string;
  recipientAccountId: string;
  amountCents: number;
  executionReference: string;
}

/** Only the trusted operator runtime; synthetic providers in pilot_test only. */
export class LivePilotTransferLedger {
  constructor(private readonly pool: Pool, private readonly mode: "live" | "pilot_test" = "live") {}
  private async guard(): Promise<void> {
    const result = await this.pool.query(`SELECT current_database() AS db, session_user AS actor,
      (SELECT rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname=session_user) AS elevated`);
    const row = result.rows[0];
    if (this.mode === "live" ? row?.db !== "openpayables_live" || row.actor !== "openpayables_live_operator" || row.elevated !== false
      : row?.db !== "openpayables_test") throw new Error("Dedicated pilot database/login required");
  }
  private async approval(id: string) {
    pilotIdempotencyKey(id);
    await this.guard();
    const result = await this.pool.query("SELECT * FROM openpayables.live_pilot_approvals WHERE id=$1 AND mode=$2", [id, this.mode]);
    const row = result.rows[0];
    if (!row) throw new Error("Pilot approval not found");
    const instruction: PilotTransferInstruction = { approvalId: id, platformAccountId: row.platform_account_id,
      recipientAccountId: row.recipient_account_id, topupId: row.topup_id, amountCents: row.amount_cents };
    return { row, instruction };
  }
  async status(id: string) {
    const { instruction } = await this.approval(id);
    const snapshot = (await this.pool.query(`SELECT row_to_json(a) AS attempt, row_to_json(o) AS observation
      FROM openpayables.live_pilot_approvals p
      LEFT JOIN openpayables.live_pilot_attempts a ON a.approval_id=p.id
      LEFT JOIN LATERAL (SELECT * FROM openpayables.live_pilot_transfer_observations WHERE approval_id=p.id
        ORDER BY amount_reversed_cents DESC LIMIT 1) o ON true WHERE p.id=$1`, [id])).rows[0];
    const attempt = snapshot.attempt;
    const observation = snapshot.observation;
    return { instruction, attempt, observation, state: !attempt ? "approved_not_attempted" : !observation ? "outcome_unknown_no_retry" :
      observation.amount_reversed_cents > 0 ? "transfer_reversal_observed" : "transfer_observed", bankPayoutVerified: false };
  }
  private async record(i: PilotTransferInstruction, observed: PilotTransferObservation) {
    if (!/^tr_[A-Za-z0-9]+$/.test(observed.transferId) || !Number.isSafeInteger(observed.amountReversedCents) ||
      observed.amountReversedCents < 0 || observed.amountReversedCents > i.amountCents) throw new Error("Invalid transfer observation");
    await this.pool.query(`INSERT INTO openpayables.live_pilot_transfer_observations
      (approval_id,transfer_id,amount_reversed_cents) VALUES ($1,$2,$3) ON CONFLICT (approval_id,amount_reversed_cents) DO NOTHING`,
    [i.approvalId, observed.transferId, observed.amountReversedCents]);
    return this.status(i.approvalId);
  }
  async execute(input: ExecutionInput, provider: PilotTransferProvider) {
    const { row, instruction: i } = await this.approval(input.approvalId);
    if (provider.mode !== this.mode) throw new Error("Pilot provider mode mismatch");
    if (input.recipientAccountId !== i.recipientAccountId || input.amountCents !== i.amountCents ||
      !input.executionReference.trim() || input.executionReference.length > 200 || input.executionReference.trim() === row.authorization_reference) {
      throw new Error("Exact approved recipient/amount and separate execution authorization required");
    }
    if ((await this.status(i.approvalId)).attempt) throw new Error("Attempt already exists; reconcile only, never resend");
    const e = await provider.preflight(i);
    if (e.platformAccountId !== i.platformAccountId || e.country !== "US" || e.transfersCapability !== "active" ||
      e.recipient?.accountId !== i.recipientAccountId || e.recipient.country !== "US" || e.recipient.transfersCapability !== "active" ||
      !e.recipient.payoutsEnabled || !e.recipient.transfersAndPayoutsAppearEnabled || e.topup?.id !== i.topupId ||
      e.topup.currency !== "usd" || e.topup.status !== "succeeded" || e.topup.balanceTransactionId !== row.balance_transaction_id ||
      !Number.isSafeInteger(e.receiptNetCents) || e.receiptNetCents !== Number(row.receipt_net_cents) || e.receiptNetCents < i.amountCents ||
      !Number.isSafeInteger(e.usdAvailableCents) || e.usdAvailableCents < i.amountCents) throw new Error("Fresh LIVE funding or recipient evidence mismatched");
    // Autocommitted INSERT: only one concurrent execution wins. If commit acknowledgement fails, do not POST.
    const result = await this.pool.query(`INSERT INTO openpayables.live_pilot_attempts (approval_id,idempotency_key,execution_reference)
      VALUES ($1,$2,$3) ON CONFLICT (approval_id) DO NOTHING RETURNING approval_id`,
    [i.approvalId, pilotIdempotencyKey(i.approvalId), input.executionReference.trim()]);
    if (result.rowCount !== 1) throw new Error("Attempt already exists; reconcile only, never resend");
    // Every exception after this point is indeterminate; the durable attempt is never removed.
    try { return await this.record(i, await provider.sendOnce(i)); }
    catch { throw new Error("Transfer outcome unknown; never resend. Reconcile using the exact Stripe transfer ID or inspect Workbench"); }
  }
  async reconcile(id: string, transferId: string, provider: Pick<PilotTransferProvider, "mode" | "retrieve">) {
    const { instruction } = await this.approval(id);
    if (provider.mode !== this.mode) throw new Error("Pilot provider mode mismatch");
    if (!/^tr_[A-Za-z0-9]+$/.test(transferId)) throw new Error("Exact Stripe transfer ID required");
    if (!(await this.status(id)).attempt) throw new Error("No durable attempt; reconciliation refused");
    const observed = await provider.retrieve(instruction, transferId);
    if (observed.transferId !== transferId) throw new Error("Transfer ID mismatch");
    return this.record(instruction, observed);
  }
}
