import type { Pool } from "pg";
import { LivePilotTransferLedger } from "./live-pilot-transfer.js";
import { validateTrace, type PayoutTrace, type PilotPayoutProvider } from "../../payments/stripe/live-payout.js";
import type { PilotTransferInstruction } from "../../payments/stripe/live-transfer.js";

/** One matched standard automatic payout per pilot. Later failures/reversals dominate earlier paid evidence. */
export class LivePilotPayoutLedger {
  private readonly transfers: LivePilotTransferLedger;
  constructor(private readonly pool: Pool, private readonly mode: "live" | "pilot_test" = "live") {
    this.transfers = new LivePilotTransferLedger(pool, mode);
  }
  private async traces(id: string): Promise<PayoutTrace[]> {
    const result = await this.pool.query(`SELECT payout_id,transfer_id,destination_payment_id,balance_transaction_id,net_cents,payout_cents,status
      FROM openpayables.live_pilot_payout_observations WHERE approval_id=$1 ORDER BY observed_at`, [id]);
    return result.rows.map(row => ({ payoutId: row.payout_id, transferId: row.transfer_id, destinationPaymentId: row.destination_payment_id,
      balanceTransactionId: row.balance_transaction_id, netCents: row.net_cents, payoutCents: Number(row.payout_cents), status: row.status }));
  }
  async status(id: string) {
    const transfer = await this.transfers.status(id); // validates database identity and mode
    const traces = await this.traces(id);
    const adverse = traces.find(t => ["failed", "canceled", "reversed"].includes(t.status));
    const paid = traces.find(t => t.status === "paid");
    return { ...transfer, traces, payoutState: transfer.state === "transfer_reversal_observed" ? "transfer_reversal_review" :
      adverse ? "payout_failure_or_reversal_review" : paid ? "stripe_reported_paid" : traces.length ? "payout_traced_not_paid" : "payout_not_traced",
      bankPayoutVerified: false };
  }
  async reconcile(id: string, payoutId: string, provider: PilotPayoutProvider) {
    if (provider.mode !== this.mode) throw new Error("Pilot provider mode mismatch");
    if (!/^po_[A-Za-z0-9]+$/.test(payoutId)) throw new Error("Exact payout ID required");
    const existing = await this.transfers.status(id);
    if (!existing.attempt || !existing.observation) throw new Error("Verified transfer observation required before payout tracing");
    const i: PilotTransferInstruction = existing.instruction;
    const transferId: string = existing.observation.transfer_id;
    const known = (await this.traces(id))[0];
    // Do not silently replace a previously matched payout. Unrelated payouts may be ignored by webhook routing.
    if (known && known.payoutId !== payoutId) throw new Error("Different payout already matched; manual incident review required");
    const evidence = await provider.inspect(i, transferId, payoutId, known);
    if (evidence.transfer.transferId !== transferId) throw new Error("Transfer evidence mismatch");
    await this.transfers.reconcile(id, transferId, { mode: this.mode, retrieve: async () => evidence.transfer });
    if (evidence.trace) {
      const t = evidence.trace;
      validateTrace(t, i, transferId, payoutId);
      await this.pool.query(`INSERT INTO openpayables.live_pilot_payout_observations
        (approval_id,transfer_id,payout_id,destination_payment_id,balance_transaction_id,net_cents,payout_cents,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (approval_id,status) DO NOTHING`,
        [id,t.transferId,t.payoutId,t.destinationPaymentId,t.balanceTransactionId,t.netCents,t.payoutCents,t.status]);
    }
    return this.status(id);
  }
}
