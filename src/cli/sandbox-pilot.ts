/** Dedicated acceptance runner for the existing OpenPayables Development sandbox.
 * Never invoke with LIVE credentials, a production database, or real contributors.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createPool } from "../storage/postgres/connection.js";
import { migrate } from "../storage/postgres/migrate.js";
import { OpenPayablesStore } from "../storage/postgres/repository.js";
import { LivePilotLedger } from "../storage/postgres/live-pilot.js";
import { LivePilotTransferLedger } from "../storage/postgres/live-pilot-transfer.js";
import { LivePilotPayoutLedger } from "../storage/postgres/live-pilot-payout.js";
import { StripeSandboxReadiness } from "../payments/stripe/live-readiness.js";
import { StripeSandboxPilotTransfer } from "../payments/stripe/live-transfer.js";
import { StripeSandboxPayoutReader } from "../payments/stripe/live-payout.js";
import { parseSandboxPilotEvent } from "../server/live-pilot-events.js";
import { handleSandboxPilotEvent } from "../server/live-pilot-webhook.js";

const cents = 500;
async function main(args: string[]) {
  const [action, ref, transferId] = args;
  if (!(action === "prepare" && args.length === 1 || action === "execute" && args.length === 3 && transferId === "YES_EXECUTE_ONE_TEST_TRANSFER" ||
      action === "status" && args.length === 1 || action === "reconcile" && args.length === 2 || action === "payout" && args.length === 2 ||
      action === "webhook" && args.length === 1)) throw new Error("Usage: prepare | status | execute APPROVAL_UUID YES_EXECUTE_ONE_TEST_TRANSFER | reconcile tr_ID | payout po_ID | webhook");
  const payer = process.env.OPENPAYABLES_SANDBOX_PLATFORM_ACCOUNT_ID;
  const recipient = process.env.OPENPAYABLES_SANDBOX_RECIPIENT_ACCOUNT_ID;
  const receipt = process.env.OPENPAYABLES_SANDBOX_TOPUP_ID;
  if (!payer || !recipient || !receipt || !/^acct_[A-Za-z0-9]+$/.test(payer) || !/^acct_[A-Za-z0-9]+$/.test(recipient) || payer === recipient || !/^tu_[A-Za-z0-9]+$/.test(receipt)) throw new Error("Exact sandbox payer, recipient and top-up required");
  const key = process.env.OPENPAYABLES_STRIPE_TEST_SECRET_KEY;
  const dbUrl = process.env.OPENPAYABLES_TEST_DATABASE_URL;
  if (!key || !/^(sk|rk)_test_.+$/.test(key) || !dbUrl) throw new Error("Dedicated TEST key and local TEST DB URL required");
  const parsed = new URL(dbUrl);
  if (!["postgres:","postgresql:"].includes(parsed.protocol) || parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/openpayables_test" || parsed.search || parsed.hash) throw new Error("Only loopback openpayables_test accepted");
  const pool = createPool(dbUrl);
  let listening = false;
  try {
    const identity = await pool.query("SELECT current_database() AS db, inet_server_addr()::text AS address");
    if (identity.rows[0]?.db !== "openpayables_test" || !["127.0.0.1", "127.0.0.1/32"].includes(identity.rows[0]?.address)) throw new Error("Wrong TEST database identity");
    const reader = new StripeSandboxReadiness(key,payer,"YES_SANDBOX_ONLY");
    await reader.inspect(); // establish exact account + TEST mode before every action
    await migrate(pool);
    const approvals = new LivePilotLedger(pool,"pilot_test");
    const transfers = new LivePilotTransferLedger(pool,"pilot_test");
    const payouts = new LivePilotPayoutLedger(pool,"pilot_test");
    const find = async () => (await pool.query("SELECT id FROM openpayables.live_pilot_approvals WHERE mode='pilot_test' AND platform_account_id=$1",[payer])).rows[0]?.id as string | undefined;
    let id = await find();
    if (action === "prepare") {
      if (!id) {
        // Check real sandbox receipt/recipient before creating synthetic project records.
        await reader.inspectPilot(recipient,receipt);
        const suffix = randomUUID();
        const projectId = `sandbox-pilot-${suffix}`;
        const contributorId = `sandbox-contributor-${suffix}`;
        const store = new OpenPayablesStore(pool);
        await store.createProject(projectId,"Stripe sandbox acceptance only","sandbox-operator");
        await store.createContributor(contributorId,"Synthetic sandbox contributor");
        await store.joinProject(projectId,contributorId);
        await store.award({projectId,contributorId,category:"development",size:"large",source:"sandbox",sourceId:suffix,role:"author",reason:"Synthetic sandbox acceptance only",approvedBy:"sandbox-operator"});
        const row = await approvals.approve({projectId,contributorId,recipientId:recipient,topupId:receipt,amountCents:cents,authorizationReference:"SANDBOX_APPROVAL_ONLY"},reader);
        id = row.id;
      }
      const status = await payouts.status(id!);
      if (status.instruction.recipientAccountId !== recipient || status.instruction.topupId !== receipt || status.instruction.amountCents !== cents) throw new Error("Unexpected frozen sandbox approval");
      console.log(JSON.stringify(status,null,2));
    } else if (action === "webhook") {
      const secret = process.env.OPENPAYABLES_SANDBOX_WEBHOOK_SECRET;
      if (!secret?.startsWith("whsec_") || secret.length <= 6) throw new Error("Stripe CLI sandbox signing secret required");
      const server = createServer(async (req,res) => {
        const scope = req.url === "/stripe/sandbox/platform" ? "platform" : req.url === "/stripe/sandbox/connected" ? "connected" : null;
        if (req.method !== "POST" || !scope) { res.writeHead(404).end(); return; }
        let event;
        try {
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const part of req) {
            const chunk = Buffer.from(part); length += chunk.length;
            if (length > 1024*1024) { res.writeHead(413).end(); return; }
            chunks.push(chunk);
          }
          const sig = req.headers["stripe-signature"];
          if (typeof sig !== "string") throw new Error("Missing signature");
          event = parseSandboxPilotEvent(Buffer.concat(chunks),sig,secret,scope);
        } catch { res.writeHead(400).end("Invalid TEST event"); return; }
        try {
          if (event) {
            const result = await handleSandboxPilotEvent(pool,payer,key,event);
            console.log(`SIGNED TEST ${scope} ${event.id}: ${result ? "reconciled" : "no matching pilot"}`);
          }
          res.writeHead(200).end("OK");
        } catch { console.error("TEST event processing failed; reconcile manually"); res.writeHead(503).end("Retry later"); }
      });
      server.requestTimeout = 30000;
      await new Promise<void>((resolve,reject)=>{ server.once("error",reject); server.listen(8789,"127.0.0.1",resolve); });
      listening = true;
      console.log("SANDBOX webhook listening on 127.0.0.1:8789; LIVE events rejected");
      for (const signal of ["SIGINT","SIGTERM"] as const) process.once(signal,()=>server.close(()=>{void pool.end();}));
    } else {
      if (!id) throw new Error("No sandbox approval; run prepare first");
      const snapshot = await transfers.status(id);
      if (snapshot.instruction.recipientAccountId !== recipient || snapshot.instruction.topupId !== receipt || snapshot.instruction.amountCents !== cents) throw new Error("Unexpected frozen sandbox approval");
      if (action === "status") console.log(JSON.stringify(await payouts.status(id),null,2));
      else if (action === "execute") {
        if (ref !== id) throw new Error("Exact sandbox approval UUID required");
        console.log(JSON.stringify(await transfers.execute({approvalId:id,recipientAccountId:recipient,amountCents:cents,executionReference:"SANDBOX_EXECUTION_ONLY"},new StripeSandboxPilotTransfer(key,payer,true)),null,2));
      } else if (action === "reconcile") console.log(JSON.stringify(await transfers.reconcile(id,ref!,new StripeSandboxPilotTransfer(key,payer)),null,2));
      else if (action === "payout") console.log(JSON.stringify(await payouts.reconcile(id,ref!,new StripeSandboxPayoutReader(key,payer)),null,2));
    }
  } finally { if (!listening) await pool.end(); }
}
main(process.argv.slice(2)).catch((error: unknown)=>{
  // Known provider errors do not include response bodies. Do not print arbitrary DB/HTTP errors or credentials.
  console.error(error instanceof Error && /^(Stripe |Pilot |Wrong |No sandbox|Exact sandbox|Unexpected frozen|Only loopback|Dedicated TEST|Usage:|Transfer outcome|Attempt already|Insufficient|Invalid frozen|LIVE recipient|Preflight expired|Top-up|Connected account)/.test(error.message) ? error.message : "Sandbox acceptance refused or failed; inspect status before any execution");
  process.exitCode=1;
});
