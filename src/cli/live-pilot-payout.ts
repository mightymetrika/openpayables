#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createPool } from "../storage/postgres/connection.js";
import { LivePilotPayoutLedger } from "../storage/postgres/live-pilot-payout.js";
import { StripeLivePayoutReader } from "../payments/stripe/live-payout.js";

async function main(args: string[]) {
  const [action,id,payoutId] = args;
  if (!id || !(action === "status" && args.length === 2 || action === "reconcile" && args.length === 3 && payoutId)) throw new Error("Usage: status APPROVAL_UUID | reconcile APPROVAL_UUID po_ID");
  const url = process.env.OPENPAYABLES_LIVE_DATABASE_URL;
  if (!url) throw new Error("Dedicated LIVE database URL required");
  const pool = createPool(url);
  try {
    const ledger = new LivePilotPayoutLedger(pool);
    if (action === "status") console.log(JSON.stringify(await ledger.status(id),null,2));
    else {
      if (process.env.OPENPAYABLES_LIVE_READ_ONLY_CONFIRM !== "YES_READ_ONLY") throw new Error("Read-only confirmation required");
      const provider = new StripeLivePayoutReader(process.env.OPENPAYABLES_STRIPE_LIVE_READ_KEY,process.env.OPENPAYABLES_LIVE_EXPECTED_PLATFORM_ACCOUNT_ID);
      console.log(JSON.stringify(await ledger.reconcile(id,payoutId!,provider),null,2));
    }
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(()=>{
  console.error("LIVE payout inspection refused or failed; no payout initiated. Inspect trusted records and Workbench."); process.exitCode=1;
});
