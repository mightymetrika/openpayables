import { parseTransfer, pilotIdempotencyKey, type PilotTransferInstruction, type PilotTransferObservation } from "./live-transfer.js";

export interface PayoutTrace {
  payoutId: string;
  transferId: string;
  destinationPaymentId: string;
  balanceTransactionId: string;
  netCents: number;
  payoutCents: number;
  status: "pending" | "in_transit" | "paid" | "failed" | "canceled" | "reversed";
}
export interface PilotPayoutProvider {
  readonly mode: "live" | "pilot_test";
  inspect(i: PilotTransferInstruction, transferId: string, payoutId: string, known?: PayoutTrace): Promise<{ transfer: PilotTransferObservation; trace: PayoutTrace | null }>;
}
export function asObject(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("Malformed Stripe evidence");
  return x as Record<string, unknown>;
}
export function validateTrace(t: PayoutTrace, i: PilotTransferInstruction, transferId: string, payoutId: string) {
  if (t.transferId !== transferId || t.payoutId !== payoutId || !/^tr_[A-Za-z0-9]+$/.test(t.transferId) || !/^po_[A-Za-z0-9]+$/.test(t.payoutId) ||
      !/^py_[A-Za-z0-9]+$/.test(t.destinationPaymentId) || !/^txn_[A-Za-z0-9]+$/.test(t.balanceTransactionId) ||
      !Number.isSafeInteger(t.netCents) || t.netCents < 1 || t.netCents > i.amountCents || !Number.isSafeInteger(t.payoutCents) || t.payoutCents < 1 ||
      !["pending", "in_transit", "paid", "failed", "canceled", "reversed"].includes(t.status)) throw new Error("Invalid payout trace");
}

/** Only GET requests. Account context is set by the frozen approval, never by arbitrary webhook data. */
export class StripeLivePayoutReader implements PilotPayoutProvider {
  readonly mode = "live" as const;
  constructor(private readonly key: string | undefined, private readonly payer: string | undefined) {
    if (!key?.startsWith("rk_live_") || key.length <= 8 || !payer || !/^acct_[A-Za-z0-9]+$/.test(payer)) throw new Error("LIVE restricted read key and exact payer required");
  }
  private async get(path: string, recipient?: string) {
    const res = await fetch(`https://api.stripe.com${path}`, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${this.key}`, "Stripe-Version": "2026-11-18.endive", ...(recipient ? { "Stripe-Account": recipient } : {}) } });
    if (!res.ok) throw new Error(`Stripe payout read failed (HTTP ${res.status})`);
    return asObject(await res.json());
  }
  async inspect(i: PilotTransferInstruction, transferId: string, payoutId: string, known?: PayoutTrace) {
    pilotIdempotencyKey(i.approvalId);
    if (i.platformAccountId !== this.payer || !/^acct_[A-Za-z0-9]+$/.test(i.recipientAccountId) || i.recipientAccountId === this.payer ||
        !/^tr_[A-Za-z0-9]+$/.test(transferId) || !/^po_[A-Za-z0-9]+$/.test(payoutId)) throw new Error("Exact payer, recipient, transfer and payout required");
    const payer = await this.get("/v1/account");
    const balance = await this.get("/v1/balance");
    if (payer.id !== this.payer || balance.object !== "balance" || balance.livemode !== true) throw new Error("Wrong LIVE payer");
    const raw = await this.get(`/v1/transfers/${transferId}`);
    const transfer = parseTransfer(raw, i, transferId);
    const payment = raw.destination_payment;
    if (typeof payment !== "string" || !/^py_[A-Za-z0-9]+$/.test(payment)) throw new Error("Transfer destination payment unavailable");
    const payout = await this.get(`/v1/payouts/${payoutId}`, i.recipientAccountId);
    if (payout.object !== "payout" || payout.id !== payoutId || payout.livemode !== true) throw new Error("Wrong recipient payout evidence");
    if (payout.automatic !== true || payout.method !== "standard" || payout.type !== "bank_account" || payout.currency !== "usd") return { transfer, trace: null };
    if (!Number.isSafeInteger(payout.amount) || (payout.amount as number) < 1 || !["paid","pending","in_transit","failed","canceled"].includes(String(payout.status))) throw new Error("Malformed payout evidence");
    const status = payout.reversed_by ? "reversed" : payout.status as PayoutTrace["status"];
    if (known) {
      validateTrace(known, i, transferId, payoutId);
      if (known.destinationPaymentId !== payment || known.payoutCents !== payout.amount) throw new Error("Payout evidence conflicts with recorded trace");
      // Preserve the earlier membership evidence if the payout subsequently fails.
      if (["failed","canceled","reversed"].includes(status)) return { transfer, trace: { ...known, status } };
    }
    if (payout.reconciliation_status !== "completed") return { transfer, trace: null };
    // Stripe sandbox acceptance: combining payout and source returns HTTP 400.
    // Request payout membership alone; the response includes the payout debit
    // and potentially unrelated payments. Match the exact source locally.
    const q = new URLSearchParams({ payout: payoutId, limit: "100" });
    const list = await this.get(`/v1/balance_transactions?${q}`, i.recipientAccountId);
    if (list.object !== "list" || list.has_more !== false || !Array.isArray(list.data)) throw new Error("Incomplete payout membership evidence");
    const matches = list.data.map(asObject).filter(tx => tx.source === payment);
    if (matches.length === 0) return { transfer, trace: null };
    if (matches.length !== 1) throw new Error("Ambiguous destination payment membership");
    const tx = matches[0]!;
    if (tx.object !== "balance_transaction" || tx.source !== payment || tx.currency !== "usd" || tx.status !== "available" || tx.amount !== i.amountCents ||
        !["payment","charge","inbound_transfer"].includes(String(tx.type)) || !Number.isSafeInteger(tx.fee) || (tx.fee as number) < 0 || tx.net !== i.amountCents - (tx.fee as number)) throw new Error("Destination payment transaction mismatch");
    const trace: PayoutTrace = { payoutId, transferId, destinationPaymentId: payment, balanceTransactionId: tx.id as string,
      netCents: tx.net as number, payoutCents: payout.amount as number, status };
    validateTrace(trace, i, transferId, payoutId);
    return { transfer, trace };
  }
}
