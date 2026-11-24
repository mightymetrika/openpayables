#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createPool } from "../storage/postgres/connection.js";
import { LivePilotLedger } from "../storage/postgres/live-pilot.js";
import { StripeLiveReadiness } from "../payments/stripe/live-readiness.js";

async function main(args: string[]) {
  const [action, project, contributor, recipient, topup, cents, reference] = args;
  if (!project || !(action === "show" && args.length === 2 || action === "approve" && args.length === 7)) {
    throw new Error("Usage: live:pilot -- show PROJECT | approve PROJECT CONTRIBUTOR acct_... tu_... CENTS AUTHORIZATION_REFERENCE");
  }
  if (process.env.OPENPAYABLES_LIVE_PILOT_CONFIRM !== "YES_APPROVE_PILOT_NO_TRANSFER") {
    throw new Error("Explicit YES_APPROVE_PILOT_NO_TRANSFER confirmation required");
  }
  const url = process.env.OPENPAYABLES_LIVE_DATABASE_URL;
  if (!url) throw new Error("Dedicated OPENPAYABLES_LIVE_DATABASE_URL required; no default database fallback");
  const pool = createPool(url);
  try {
    const ledger = new LivePilotLedger(pool);
    const record = action === "show" ? await ledger.show(project) : await ledger.approve({
      projectId: project, contributorId: contributor!, recipientId: recipient!, topupId: topup!,
      amountCents: Number(cents), authorizationReference: reference!,
    }, new StripeLiveReadiness());
    console.log(JSON.stringify({ record, safeToExecuteTransfer: false }, null, 2));
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => {
    // Do not emit raw PostgreSQL/Stripe errors, credentials, or private references.
    console.error("LIVE pilot operation refused or failed. Inspect configuration and trusted local database logs; no transfer was attempted.");
    process.exitCode = 1;
  });
}
