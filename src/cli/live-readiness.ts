#!/usr/bin/env node
/** Independent read-only LIVE check. Never imports the TEST operator CLI or connects to PostgreSQL. */
import { StripeLiveReadiness } from "../payments/stripe/live-readiness.js";

export function parseLiveReadinessArgs(args: string[]): { recipientId?: string; topupId?: string } {
  const result: { recipientId?: string; topupId?: string } = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!value || !["--recipient", "--topup"].includes(flag ?? "")) {
      throw new Error("Usage: openpayables-live-readiness [--recipient acct_...] [--topup tu_...]");
    }
    if (flag === "--recipient") {
      if (result.recipientId) throw new Error("Duplicate --recipient argument");
      result.recipientId = value;
    } else {
      if (result.topupId) throw new Error("Duplicate --topup argument");
      result.topupId = value;
    }
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseLiveReadinessArgs(process.argv.slice(2));
  const result = await new StripeLiveReadiness().inspect(args.recipientId, args.topupId);
  console.log(JSON.stringify(result, null, 2));
}

// Do not inadvertently run when imported by unit tests.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/live-readiness.ts") ||
    process.argv[1]?.replace(/\\/g, "/").endsWith("/live-readiness.js")) {
  main().catch((err: unknown) => {
    // Generic error messages only; Stripe HTTP response bodies and secrets are not logged.
    console.error(err instanceof Error ? err.message : "LIVE read-only inspection failed");
    process.exitCode = 1;
  });
}
