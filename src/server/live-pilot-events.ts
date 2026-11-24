import { createHmac, timingSafeEqual } from "node:crypto";
import { asObject } from "../payments/stripe/live-payout.js";
import { pilotIdempotencyKey } from "../payments/stripe/live-transfer.js";

export type EventScope = "platform" | "connected";
export type PilotEvent = { id: string; kind: "transfer"; approvalId: string; transferId: string } |
  { id: string; kind: "payout"; accountId: string; payoutId: string };
const transferTypes = ["transfer.created", "transfer.updated", "transfer.reversed"];
const payoutTypes = ["payout.created", "payout.updated", "payout.paid", "payout.failed", "payout.canceled", "payout.reconciliation_completed"];

/** Snapshot webhook authentication; signed data routes reads but does not establish payment status. */
export function parsePilotEvent(raw: Buffer, header: string, secret: string, scope: EventScope, now = Math.floor(Date.now()/1000)): PilotEvent | null {
  if (!secret?.startsWith("whsec_") || secret.length <= 6 || raw.length > 1024*1024 || header.length > 8192) throw new Error("Invalid webhook configuration or body");
  const parts = header.split(",").map(x => x.trim());
  const times = parts.filter(x => x.startsWith("t=")).map(x => x.slice(2));
  const t = times[0];
  if (times.length !== 1 || !t || !/^\d+$/.test(t) || !Number.isSafeInteger(Number(t)) || Math.abs(now-Number(t)) > 300) throw new Error("Invalid webhook timestamp");
  const digest = createHmac("sha256", secret).update(`${t}.`).update(raw).digest();
  if (!parts.filter(x => x.startsWith("v1=")).some(x => /^[a-f0-9]{64}$/i.test(x.slice(3)) && timingSafeEqual(digest,Buffer.from(x.slice(3),"hex")))) throw new Error("Invalid webhook signature");
  const event = asObject(JSON.parse(raw.toString("utf8")));
  if (event.object !== "event" || event.livemode !== true || typeof event.id !== "string" || !/^evt_[A-Za-z0-9]+$/.test(event.id) || typeof event.type !== "string") throw new Error("Expected LIVE snapshot event");
  if (scope === "platform" && event.account != null) throw new Error("Connected event on platform endpoint");
  if (scope === "connected" && (typeof event.account !== "string" || !/^acct_[A-Za-z0-9]+$/.test(event.account))) throw new Error("Connected account event required");
  if (scope === "platform" && transferTypes.includes(event.type)) {
    const data = asObject(asObject(event.data).object);
    if (data.object !== "transfer" || data.livemode !== true || typeof data.id !== "string" || !/^tr_[A-Za-z0-9]+$/.test(data.id)) throw new Error("Invalid transfer event object");
    const metadata = asObject(data.metadata);
    const approvalId = metadata.openpayables_approval_id;
    if (approvalId === undefined) return null;
    if (typeof approvalId !== "string" || data.transfer_group !== pilotIdempotencyKey(approvalId)) throw new Error("Invalid pilot transfer routing metadata");
    return { id: event.id, kind: "transfer", approvalId, transferId: data.id };
  }
  if (scope === "connected" && payoutTypes.includes(event.type)) {
    const data = asObject(asObject(event.data).object);
    if (data.object !== "payout" || data.livemode !== true || typeof data.id !== "string" || !/^po_[A-Za-z0-9]+$/.test(data.id)) throw new Error("Invalid payout event object");
    return { id: event.id, kind: "payout", accountId: event.account as string, payoutId: data.id };
  }
  return null;
}
