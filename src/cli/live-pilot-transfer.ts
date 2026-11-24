#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createPool } from "../storage/postgres/connection.js";
import { LivePilotTransferLedger } from "../storage/postgres/live-pilot-transfer.js";
import { StripeLivePilotTransfer } from "../payments/stripe/live-transfer.js";

// Release gate: enable only in a separately reviewed patch after signed webhook,
// sandbox acceptance and bank-payout tracing support. No environment override.
const LIVE_EXECUTION_RELEASED = false;
async function main(args: string[]) {
  const [action, id, recipientOrTransfer, cents, reference] = args;
  if (!id || !(action === "status" && args.length === 2 || action === "reconcile" && args.length === 3 || action === "execute" && args.length === 5)) {
    throw new Error("Usage: status APPROVAL_UUID | reconcile APPROVAL_UUID tr_ID | execute APPROVAL_UUID acct_RECIPIENT CENTS EXECUTION_REFERENCE");
  }
  if (action === "execute" && (!LIVE_EXECUTION_RELEASED || process.env.OPENPAYABLES_LIVE_EXECUTION_CONFIRM !== "YES_EXECUTE_ONE_LIVE_TRANSFER")) {
    throw new Error("LIVE execution disabled pending release acceptance or explicit confirmation");
  }
  const url = process.env.OPENPAYABLES_LIVE_DATABASE_URL;
  if (!url) throw new Error("Dedicated LIVE database URL required");
  const pool = createPool(url);
  try {
    const ledger = new LivePilotTransferLedger(pool);
    if (action === "status") console.log(JSON.stringify(await ledger.status(id), null, 2));
    else if (action === "execute") {
      const provider = new StripeLivePilotTransfer(process.env.OPENPAYABLES_STRIPE_LIVE_TRANSFER_KEY,
        process.env.OPENPAYABLES_LIVE_EXPECTED_PLATFORM_ACCOUNT_ID, true);
      console.log(JSON.stringify(await ledger.execute({approvalId: id, recipientAccountId: recipientOrTransfer!,
        amountCents: Number(cents), executionReference: reference!}, provider), null, 2));
    } else {
      if (process.env.OPENPAYABLES_LIVE_READ_ONLY_CONFIRM !== "YES_READ_ONLY") throw new Error("Read-only confirmation required");
      const provider = new StripeLivePilotTransfer(process.env.OPENPAYABLES_STRIPE_LIVE_READ_KEY,
        process.env.OPENPAYABLES_LIVE_EXPECTED_PLATFORM_ACCOUNT_ID);
      console.log(JSON.stringify(await ledger.reconcile(id, recipientOrTransfer!, provider), null, 2));
    }
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => {
    console.error("Pilot operation refused or failed. Do not resend any attempted transfer. Inspect trusted records and Stripe Workbench.");
    process.exitCode = 1;
  });
}
