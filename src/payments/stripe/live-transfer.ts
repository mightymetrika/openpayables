import { StripeLiveReadiness, type LivePilotEvidence } from "./live-readiness.js";

export interface PilotTransferInstruction {
  approvalId: string;
  platformAccountId: string;
  recipientAccountId: string;
  topupId: string;
  amountCents: number;
}
export interface PilotTransferObservation {
  transferId: string;
  amountReversedCents: number;
}
export interface PilotTransferProvider {
  readonly mode: "live" | "pilot_test";
  preflight(instruction: PilotTransferInstruction): Promise<LivePilotEvidence>;
  sendOnce(instruction: PilotTransferInstruction): Promise<PilotTransferObservation>;
  retrieve(instruction: PilotTransferInstruction, transferId: string): Promise<PilotTransferObservation>;
}
const account = /^acct_[A-Za-z0-9]+$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const transfer = /^tr_[A-Za-z0-9]+$/;
export function pilotIdempotencyKey(id: string): string {
  if (!uuid.test(id)) throw new Error("Invalid approval UUID");
  return `openpayables-pilot-${id}`;
}
function assertInstruction(i: PilotTransferInstruction): void {
  pilotIdempotencyKey(i.approvalId);
  if (!account.test(i.platformAccountId) || !account.test(i.recipientAccountId) || i.platformAccountId === i.recipientAccountId ||
      !/^tu_[A-Za-z0-9]+$/.test(i.topupId) || !Number.isSafeInteger(i.amountCents) || i.amountCents < 1 || i.amountCents > 2500) {
    throw new Error("Invalid frozen pilot transfer instruction");
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed Stripe object");
  return value as Record<string, unknown>;
}
export function parseTransfer(raw: Record<string, unknown>, i: PilotTransferInstruction, expectedId?: string): PilotTransferObservation {
  if (raw.object !== "transfer" || raw.livemode !== true || typeof raw.id !== "string" || !transfer.test(raw.id) ||
      (expectedId !== undefined && raw.id !== expectedId) || raw.destination !== i.recipientAccountId || raw.currency !== "usd" ||
      raw.amount !== i.amountCents || raw.transfer_group !== pilotIdempotencyKey(i.approvalId) ||
      object(raw.metadata).openpayables_approval_id !== i.approvalId || !Number.isSafeInteger(raw.amount_reversed) ||
      (raw.amount_reversed as number) < 0 || (raw.amount_reversed as number) > i.amountCents ||
      raw.reversed !== (raw.amount_reversed === i.amountCents)) {
    throw new Error("Stripe transfer evidence mismatched; manual incident review required");
  }
  return { transferId: raw.id, amountReversedCents: raw.amount_reversed as number };
}

/** Restricted server-side operator client; no automatic retries, top-ups, payouts, or account creation. */
export class StripeLivePilotTransfer implements PilotTransferProvider {
  readonly mode = "live" as const;
  private prepared: { fingerprint: string; expiresAt: number } | null = null;
  constructor(private readonly key: string | undefined, private readonly expectedPlatform: string | undefined,
    private readonly allowWrite = false) {
    if (!key?.startsWith("rk_live_") || key.length <= 8 || !expectedPlatform || !account.test(expectedPlatform)) {
      throw new Error("LIVE restricted key and exact expected platform required");
    }
  }
  private assertPayer(i: PilotTransferInstruction): void {
    assertInstruction(i);
    if (i.platformAccountId !== this.expectedPlatform) throw new Error("Frozen payer differs from configured payer");
  }
  private async request(path: string, body?: URLSearchParams, idempotency?: string): Promise<Record<string, unknown>> {
    const res = await fetch(`https://api.stripe.com${path}`, {
      method: body ? "POST" : "GET", redirect: "error",
      headers: { Authorization: `Bearer ${this.key}`, "Stripe-Version": "2026-11-18.endive",
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotency! } : {}) },
      ...(body ? { body } : {}), signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Stripe pilot request failed (HTTP ${res.status})`);
    return object(await res.json());
  }
  async preflight(i: PilotTransferInstruction): Promise<LivePilotEvidence> {
    this.prepared = null;
    const startedAt = Date.now();
    this.assertPayer(i);
    // Use the SAME credential for fresh funding evidence and eventual transfer.
    const evidence = await new StripeLiveReadiness(this.key, this.expectedPlatform, "YES_READ_ONLY").inspectPilot(i.recipientAccountId, i.topupId);
    const raw = await this.request(`/v2/core/accounts/${i.recipientAccountId}?include%5B%5D=configuration.recipient`);
    const capability = object(object(object(object(object(raw.configuration).recipient).capabilities).stripe_balance).stripe_transfers);
    if (raw.id !== i.recipientAccountId || raw.object !== "v2.core.account" || capability.status !== "active") {
      throw new Error("LIVE recipient v2 transfers capability not verified");
    }
    if (evidence.usdAvailableCents < i.amountCents || evidence.receiptNetCents < i.amountCents) {
      throw new Error("Insufficient freshly observed LIVE funding");
    }
    if (Date.now() >= startedAt + 60000) throw new Error("Preflight expired before completion");
    this.prepared = { fingerprint: JSON.stringify(i), expiresAt: startedAt + 60000 };
    return evidence;
  }
  async sendOnce(i: PilotTransferInstruction): Promise<PilotTransferObservation> {
    this.assertPayer(i);
    if (!this.allowWrite) throw new Error("Transfer writing disabled");
    const prepared = this.prepared;
    this.prepared = null;
    if (!prepared || prepared.fingerprint !== JSON.stringify(i) || Date.now() >= prepared.expiresAt) {
      throw new Error("Exact fresh preflight required before POST");
    }
    // The ledger commits the unique attempt before invoking this method.
    const key = pilotIdempotencyKey(i.approvalId);
    const body = new URLSearchParams({ amount: String(i.amountCents), currency: "usd", destination: i.recipientAccountId,
      transfer_group: key, "metadata[openpayables_approval_id]": i.approvalId });
    return parseTransfer(await this.request("/v1/transfers", body, key), i);
  }
  async retrieve(i: PilotTransferInstruction, transferId: string): Promise<PilotTransferObservation> {
    this.assertPayer(i);
    if (!transfer.test(transferId)) throw new Error("Exact transfer ID required");
    // Verify account identity and LIVE balance with this read credential, without requiring remaining funding.
    const payer = await this.request("/v1/account");
    const balance = await this.request("/v1/balance");
    if (payer.id !== i.platformAccountId || balance.object !== "balance" || balance.livemode !== true) {
      throw new Error("Reconciliation requires the exact LIVE payer account");
    }
    return parseTransfer(await this.request(`/v1/transfers/${transferId}`), i, transferId);
  }
}
