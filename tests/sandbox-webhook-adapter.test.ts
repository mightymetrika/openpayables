import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createSandboxWebhookHandler, handleSandboxWebhook, sandboxWebhookBodyLimit } from "../src/server/sandbox-webhook.js";
import { assertHostedSandboxDatabase, createHostedSandboxWebhookHandler, readHostedSandboxConfig } from "../src/server/hosted-sandbox-webhook.js";

const secret = "whsec_test_fixture";
const event = { object: "event", id: "evt_demo", livemode: false, type: "payout.paid", account: "acct_recipient", data: { object: { object: "payout", id: "po_demo", livemode: false } } };
const raw = Buffer.from(JSON.stringify(event, null, 2));
function signature(body: Buffer, key = secret, now = Math.floor(Date.now() / 1000)) {
  return `t=${now},v1=${createHmac("sha256", key).update(`${now}.`).update(body).digest("hex")}`;
}
function request(body = raw, sig = signature(body)) {
  return new Request("https://example.invalid/api/stripe-sandbox-connected", { method: "POST", headers: { "stripe-signature": sig }, body: new Uint8Array(body) });
}
function options() {
  return { scope: "connected" as const, secret, reconcile: vi.fn().mockResolvedValue(true), log: vi.fn() };
}
function config(): NodeJS.ProcessEnv {
  return {
    OPENPAYABLES_HOSTED_SANDBOX_CONFIRM: "YES_HOSTED_SANDBOX_ONLY",
    OPENPAYABLES_HOSTED_SANDBOX_DATABASE_URL: "postgresql://openpayables_test_webhook:fixture@db.example.invalid/openpayables_test",
    OPENPAYABLES_HOSTED_SANDBOX_STRIPE_READ_KEY: "rk_test_fixture",
    OPENPAYABLES_HOSTED_SANDBOX_PLATFORM_ACCOUNT_ID: "acct_payer",
    OPENPAYABLES_HOSTED_SANDBOX_RECIPIENT_ACCOUNT_ID: "acct_recipient",
    OPENPAYABLES_HOSTED_SANDBOX_APPROVAL_ID: "afc27cd6-2b3e-4c41-b1e7-9220e268cf02",
    OPENPAYABLES_HOSTED_SANDBOX_TRANSFER_ID: "tr_demo",
    OPENPAYABLES_HOSTED_SANDBOX_PAYOUT_ID: "po_demo",
    OPENPAYABLES_HOSTED_SANDBOX_PLATFORM_WEBHOOK_SECRET: "whsec_platform_fixture",
    OPENPAYABLES_HOSTED_SANDBOX_CONNECTED_WEBHOOK_SECRET: secret,
  };
}

describe("Shared sandbox webhook transport", () => {
  it("passes unchanged signed bytes to the same dispatcher used by the CLI", async () => {
    const opts = options();
    expect((await createSandboxWebhookHandler(opts)(request())).status).toBe(200);
    expect(await handleSandboxWebhook(raw, signature(raw), opts)).toEqual({ status: 200, body: "OK" });
    expect(opts.reconcile).toHaveBeenCalledTimes(2);
    expect(opts.reconcile).toHaveBeenCalledWith({ id: "evt_demo", kind: "payout", accountId: "acct_recipient", payoutId: "po_demo" });
    expect(opts.log).toHaveBeenCalledWith("SIGNED TEST connected evt_demo: reconciled");
  });
  it("rejects tampering, wrong secret, missing signature and stale timestamp before dispatch", async () => {
    const opts = options(); const handle = createSandboxWebhookHandler(opts);
    const tampered = Buffer.from(JSON.stringify(event));
    for (const req of [request(tampered, signature(raw)), request(raw, signature(raw, "whsec_wrong")), request(raw, ""), request(raw, signature(raw, secret, 1))]) {
      expect((await handle(req)).status).toBe(400);
    }
    expect(opts.reconcile).not.toHaveBeenCalled();
  });
  it("rejects LIVE and wrong-scope events even when correctly signed", async () => {
    const opts = options();
    const live = Buffer.from(JSON.stringify({ ...event, livemode: true }));
    expect((await createSandboxWebhookHandler(opts)(request(live))).status).toBe(400);
    expect((await createSandboxWebhookHandler({ ...opts, scope: "platform" })(request())).status).toBe(400);
    expect(opts.reconcile).not.toHaveBeenCalled();
  });
  it("rejects non-POST and oversized bodies", async () => {
    const opts = options(); const handle = createSandboxWebhookHandler(opts);
    expect((await handle(new Request("https://example.invalid"))).status).toBe(405);
    expect((await handle(request(Buffer.alloc(sandboxWebhookBodyLimit + 1)))).status).toBe(413);
    expect(opts.reconcile).not.toHaveBeenCalled();
  });
  it("returns a retryable error without leaking errors or secrets", async () => {
    const opts = options(); opts.reconcile.mockRejectedValue(new Error("private credential"));
    const response = await createSandboxWebhookHandler(opts)(request());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Retry later");
    expect(opts.log).toHaveBeenCalledWith("TEST event processing failed; retry or reconcile manually");
  });
  it("acknowledges an unrelated signed event without dispatch and distinguishes unmatched routing", async () => {
    const opts = options(); const handle = createSandboxWebhookHandler(opts);
    const unrelated = Buffer.from(JSON.stringify({ ...event, type: "account.updated" }));
    expect((await handle(request(unrelated))).status).toBe(200);
    expect(opts.reconcile).not.toHaveBeenCalled();
    opts.reconcile.mockResolvedValue(false);
    expect((await handle(request())).status).toBe(200);
    expect(opts.log).toHaveBeenCalledWith("SIGNED TEST connected evt_demo: no matching pilot");
  });
});

describe("Hosted sandbox reference boundary", () => {
  it("requires exact TEST scope, restricted key, isolated database URL and separate endpoint secrets", () => {
    expect(readHostedSandboxConfig("connected", config())).toMatchObject({ payer: "acct_payer", recipient: "acct_recipient", secret, payout: "po_demo" });
    expect(readHostedSandboxConfig("platform", config()).secret).toBe("whsec_platform_fixture");
    for (const overrides of [
      { OPENPAYABLES_HOSTED_SANDBOX_CONFIRM: "NO" },
      { OPENPAYABLES_HOSTED_SANDBOX_STRIPE_READ_KEY: "rk_live_fixture" },
      { OPENPAYABLES_HOSTED_SANDBOX_STRIPE_READ_KEY: "sk_test_fixture" },
      { OPENPAYABLES_HOSTED_SANDBOX_DATABASE_URL: "postgresql://openpayables_test_webhook:fixture@db.example.invalid/postgres" },
      { OPENPAYABLES_HOSTED_SANDBOX_DATABASE_URL: "postgresql://postgres:fixture@db.example.invalid/openpayables_test" },
      { OPENPAYABLES_HOSTED_SANDBOX_DATABASE_URL: "postgresql://openpayables_test_webhook:fixture@db.example.invalid/openpayables_test?sslmode=disable" },
      { OPENPAYABLES_HOSTED_SANDBOX_PLATFORM_WEBHOOK_SECRET: secret },
      { OPENPAYABLES_HOSTED_SANDBOX_APPROVAL_ID: "wrong" },
    ]) expect(() => readHostedSandboxConfig("connected", { ...config(), ...overrides })).toThrow();
  });
  it("fails closed when the runtime database identity or grants are inappropriate", async () => {
    const valid = { db: "openpayables_test", actor: "openpayables_test_webhook", active_actor: "openpayables_test_webhook", elevated: false, schema_create: false, approval_write: false, attempt_write: false, transfer_mutate: false, payout_mutate: false };
    const query = vi.fn().mockResolvedValue({ rows: [valid] });
    const pool = { query } as unknown as Pool;
    await expect(assertHostedSandboxDatabase(pool)).resolves.toBeUndefined();
    for (const overrides of [{ db: "openpayables_live" }, { actor: "postgres" }, { active_actor: "postgres" }, { elevated: true }, { schema_create: true }, { approval_write: true }, { attempt_write: true }, { transfer_mutate: true }, { payout_mutate: true }]) {
      query.mockResolvedValueOnce({ rows: [{ ...valid, ...overrides }] });
      await expect(assertHostedSandboxDatabase(pool)).rejects.toThrow();
    }
  });
  it("rejects unconfigured routes, rejects invalid signatures and ignores other payout IDs without a database connection", async () => {
    expect((await createHostedSandboxWebhookHandler("connected", {})(request())).status).toBe(503);
    const handle = createHostedSandboxWebhookHandler("connected", config());
    expect((await handle(request(raw, "wrong"))).status).toBe(400);
    const other = Buffer.from(JSON.stringify({ ...event, data: { object: { ...event.data.object, id: "po_other" } } }));
    expect((await handle(request(other))).status).toBe(200);
  });
});
