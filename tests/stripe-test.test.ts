import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StripeTestClient } from "../src/payments/stripe/test-client.js";
import { verifyStripeSignature } from "../src/server/webhook.js";

describe("Stripe TEST-mode boundaries", () => {
  it("rejects live keys and missing keys before external calls", () => {
    expect(() => new StripeTestClient("sk_live_not_allowed")).toThrow(/TEST/);
    expect(() => new StripeTestClient("")).toThrow(/TEST/);
    expect(() => new StripeTestClient("sk_test_example")).not.toThrow();
  });
  it("accepts a recent correct webhook signature, rejects tampering and stale signatures", () => {
    const t = 1770000000;
    const raw = Buffer.from('{"id":"evt_test"}');
    const signature = createHmac("sha256", "whsec_test").update(`${t}.`).update(raw).digest("hex");
    expect(verifyStripeSignature(raw, `t=${t},v1=${signature}`, "whsec_test", t)).toBe(true);
    expect(verifyStripeSignature(Buffer.from('changed'), `t=${t},v1=${signature}`, "whsec_test", t)).toBe(false);
    expect(verifyStripeSignature(raw, `t=${t},v1=${signature}`, "whsec_test", t + 301)).toBe(false);
  });
});
