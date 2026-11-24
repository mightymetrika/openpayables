import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import { createPool } from "../storage/postgres/connection.js";
import { LivePilotTransferLedger } from "../storage/postgres/live-pilot-transfer.js";
import { LivePilotPayoutLedger } from "../storage/postgres/live-pilot-payout.js";
import { StripeLivePilotTransfer, StripeSandboxPilotTransfer } from "../payments/stripe/live-transfer.js";
import { StripeLivePayoutReader, StripeSandboxPayoutReader } from "../payments/stripe/live-payout.js";
import { parsePilotEvent, type PilotEvent } from "./live-pilot-events.js";

/** Trusted, dedicated operator runtime. No transfer-writing key or command in this server. */
async function routePilotEvent(pool: Pool, payer: string, key: string, event: PilotEvent, mode: "live" | "pilot_test") {
  const transfers = new LivePilotTransferLedger(pool, mode);
  const payouts = new LivePilotPayoutLedger(pool, mode);
  const result = await pool.query(`SELECT id FROM openpayables.live_pilot_approvals WHERE mode=$3 AND platform_account_id=$1 AND
    ${event.kind === "transfer" ? "id=$2" : "recipient_account_id=$2"}`, [payer,event.kind === "transfer" ? event.approvalId : event.accountId, mode]);
  if (result.rowCount === 0) return;
  if (result.rowCount !== 1) throw new Error("Ambiguous pilot event routing");
  const id: string = result.rows[0].id;
  const snapshot = await transfers.status(id);
  if (!snapshot.attempt) return; // unrelated or premature event cannot create an attempt
  if (event.kind === "transfer") {
    return transfers.reconcile(id,event.transferId,mode === "live" ? new StripeLivePilotTransfer(key,payer) : new StripeSandboxPilotTransfer(key,payer));
  } else {
    if (!snapshot.observation) throw new Error("Transfer observation required; retry or reconcile manually");
    const state = await payouts.status(id);
    if (state.traces.length && state.traces[0]?.payoutId !== event.payoutId) return; // unrelated payout; subsequent payouts require manual review
    return payouts.reconcile(id,event.payoutId,mode === "live" ? new StripeLivePayoutReader(key,payer) : new StripeSandboxPayoutReader(key,payer));
  }
}

export async function handlePilotEvent(pool: Pool, payer: string, key: string, event: PilotEvent) {
  return routePilotEvent(pool,payer,key,event,"live");
}
export async function handleSandboxPilotEvent(pool: Pool, payer: string, key: string, event: PilotEvent) {
  return routePilotEvent(pool,payer,key,event,"pilot_test");
}

export async function runLivePilotWebhook() {
  const platformSecret = process.env.OPENPAYABLES_LIVE_PLATFORM_WEBHOOK_SECRET;
  const connectedSecret = process.env.OPENPAYABLES_LIVE_CONNECTED_WEBHOOK_SECRET;
  const key = process.env.OPENPAYABLES_STRIPE_LIVE_READ_KEY;
  const payer = process.env.OPENPAYABLES_LIVE_EXPECTED_PLATFORM_ACCOUNT_ID;
  const url = process.env.OPENPAYABLES_LIVE_DATABASE_URL;
  if (process.env.OPENPAYABLES_LIVE_READ_ONLY_CONFIRM !== "YES_READ_ONLY" || !url || !key || !payer ||
      !platformSecret?.startsWith("whsec_") || platformSecret.length <= 6 || !connectedSecret?.startsWith("whsec_") || connectedSecret.length <= 6 || platformSecret === connectedSecret) throw new Error("Dedicated LIVE read-only webhook settings required");
  new StripeLivePayoutReader(key,payer); // validate credential shape without network activity
  const port = Number(process.env.OPENPAYABLES_LIVE_WEBHOOK_PORT ?? "8788");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid LIVE webhook port");
  const pool = createPool(url);
  try {
    const result = await pool.query(`SELECT current_database() AS db, session_user AS actor,
      (SELECT rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname=session_user) AS elevated`);
    const row = result.rows[0];
    if (row?.db !== "openpayables_live" || row.actor !== "openpayables_live_operator" || row.elevated !== false) throw new Error("Dedicated LIVE webhook database required");
  } catch (error) { await pool.end(); throw error; }
  const server = createServer(async (req,res) => {
    const scope = req.url === "/stripe/live/platform" ? "platform" : req.url === "/stripe/live/connected" ? "connected" : null;
    if (req.method !== "POST" || !scope) { res.writeHead(404).end(); return; }
    let event: PilotEvent | null;
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const part of req) {
        const chunk = Buffer.from(part);
        length += chunk.length;
        if (length > 1024*1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string") throw new Error("Missing signature");
      event = parsePilotEvent(Buffer.concat(chunks),signature,scope === "platform" ? platformSecret : connectedSecret,scope);
    } catch { res.writeHead(400).end("Invalid event"); return; }
    try {
      if (event) await handlePilotEvent(pool,payer,key,event);
      res.writeHead(200).end("OK");
    } catch { console.error("LIVE pilot event processing failed; retry/reconcile using Stripe Workbench"); res.writeHead(503).end("Retry later"); }
  });
  server.requestTimeout = 30000;
  server.listen(port,"127.0.0.1",()=>console.log(`LIVE pilot webhook listening on loopback port ${port}`));
  server.on("error",()=>{ console.error("LIVE webhook listener failed"); void pool.end(); process.exitCode=1; });
  for (const signal of ["SIGINT","SIGTERM"] as const) process.once(signal,()=>server.close(()=>{void pool.end();}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runLivePilotWebhook().catch(()=>{
  console.error("LIVE pilot webhook startup refused or failed"); process.exitCode=1;
});
