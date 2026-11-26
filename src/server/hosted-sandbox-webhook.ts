import { Pool } from "pg";
import { pilotIdempotencyKey } from "../payments/stripe/live-transfer.js";
import { LivePilotTransferLedger } from "../storage/postgres/live-pilot-transfer.js";
import { handleSandboxPilotEvent } from "./live-pilot-webhook.js";
import type { EventScope } from "./live-pilot-events.js";
import { createSandboxWebhookHandler } from "./sandbox-webhook.js";

interface HostedSandboxConfig {
  databaseUrl: string;
  key: string;
  payer: string;
  recipient: string;
  approval: string;
  transfer: string;
  payout: string;
  secret: string;
}

/** Separate reference deployment. No LIVE configuration, migrations or payment
 * execution. Require a dedicated named TEST database and restricted login.
 */
export function readHostedSandboxConfig(scope: EventScope, env: NodeJS.ProcessEnv): HostedSandboxConfig {
  const databaseUrl = env.OPENPAYABLES_HOSTED_SANDBOX_DATABASE_URL;
  const key = env.OPENPAYABLES_HOSTED_SANDBOX_STRIPE_READ_KEY;
  const payer = env.OPENPAYABLES_HOSTED_SANDBOX_PLATFORM_ACCOUNT_ID;
  const recipient = env.OPENPAYABLES_HOSTED_SANDBOX_RECIPIENT_ACCOUNT_ID;
  const approval = env.OPENPAYABLES_HOSTED_SANDBOX_APPROVAL_ID;
  const transfer = env.OPENPAYABLES_HOSTED_SANDBOX_TRANSFER_ID;
  const payout = env.OPENPAYABLES_HOSTED_SANDBOX_PAYOUT_ID;
  const platform = env.OPENPAYABLES_HOSTED_SANDBOX_PLATFORM_WEBHOOK_SECRET;
  const connected = env.OPENPAYABLES_HOSTED_SANDBOX_CONNECTED_WEBHOOK_SECRET;
  const secret = scope === "platform" ? platform : connected;
  if (env.OPENPAYABLES_HOSTED_SANDBOX_CONFIRM !== "YES_HOSTED_SANDBOX_ONLY" || !databaseUrl ||
      !key || !/^rk_test_.+$/.test(key) || !payer || !/^acct_[A-Za-z0-9]+$/.test(payer) ||
      !recipient || !/^acct_[A-Za-z0-9]+$/.test(recipient) || recipient === payer ||
      !approval || !transfer || !/^tr_[A-Za-z0-9]+$/.test(transfer) || !payout || !/^po_[A-Za-z0-9]+$/.test(payout) ||
      !secret || !/^whsec_.+$/.test(secret) || (platform && connected && platform === connected)) {
    throw new Error("Dedicated hosted TEST reconciliation configuration required");
  }
  pilotIdempotencyKey(approval);
  const url = new URL(databaseUrl);
  // No URL query parameters: they could override the explicitly verified TLS settings.
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname ||
      url.pathname !== "/openpayables_test" || url.username !== "openpayables_test_webhook" ||
      !url.password || url.search || url.hash) throw new Error("Dedicated hosted TEST database URL required");
  return { databaseUrl, key, payer, recipient, approval, transfer, payout, secret };
}

/** Check actual server identity and privileges before touching a ledger. */
export async function assertHostedSandboxDatabase(pool: Pool): Promise<void> {
  const { rows } = await pool.query(`SELECT current_database() AS db, session_user AS actor, current_user AS active_actor,
    (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=session_user) AS elevated,
    has_schema_privilege(session_user, 'openpayables', 'CREATE') AS schema_create,
    has_table_privilege(session_user, 'openpayables.live_pilot_approvals', 'INSERT,UPDATE,DELETE,TRUNCATE') AS approval_write,
    has_table_privilege(session_user, 'openpayables.live_pilot_attempts', 'INSERT,UPDATE,DELETE,TRUNCATE') AS attempt_write,
    has_table_privilege(session_user, 'openpayables.live_pilot_transfer_observations', 'UPDATE,DELETE,TRUNCATE') AS transfer_mutate,
    has_table_privilege(session_user, 'openpayables.live_pilot_payout_observations', 'UPDATE,DELETE,TRUNCATE') AS payout_mutate`);
  const row = rows[0];
  if (row?.db !== "openpayables_test" || row.actor !== "openpayables_test_webhook" || row.active_actor !== row.actor ||
      row.elevated !== false || row.schema_create !== false || row.approval_write !== false || row.attempt_write !== false ||
      row.transfer_mutate !== false || row.payout_mutate !== false) throw new Error("Dedicated restricted hosted TEST database required");
}

/** Reference handler for the already executed sandbox pilot. Open a bounded
 * connection only after authenticating a relevant event; close it before ACK.
 * A read-only Stripe key and observation-only DB grants are deployment requirements.
 */
export function createHostedSandboxWebhookHandler(scope: EventScope, env = process.env): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    let config: HostedSandboxConfig;
    try { config = readHostedSandboxConfig(scope, env); }
    catch { return new Response("TEST webhook not configured", { status: 503 }); }
    return createSandboxWebhookHandler({
      scope, secret: config.secret, log: (message) => console.log(message),
      reconcile: async (event) => {
        if (event.kind === "transfer" ? event.approvalId !== config.approval || event.transferId !== config.transfer
          : event.accountId !== config.recipient || event.payoutId !== config.payout) return false;
        const pool = new Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: true }, max: 1,
          connectionTimeoutMillis: 5000, statement_timeout: 10000, application_name: "openpayables-hosted-test-webhook" });
        // pg may emit an idle-client error between queries. Do not leak provider details.
        pool.on("error", () => console.error("Hosted TEST database connection failed"));
        try {
          await assertHostedSandboxDatabase(pool);
          const snapshot = await new LivePilotTransferLedger(pool, "pilot_test").status(config.approval);
          if (snapshot.instruction.platformAccountId !== config.payer || snapshot.instruction.recipientAccountId !== config.recipient ||
              !snapshot.attempt || snapshot.observation?.transfer_id !== config.transfer) throw new Error("Frozen sandbox pilot mismatch");
          return Boolean(await handleSandboxPilotEvent(pool, config.payer, config.key, event));
        } finally { await pool.end(); }
      },
    })(request);
  };
}
