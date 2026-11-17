import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
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


describe("Stripe TEST available-balance preflight", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads only the available USD test balance, not pending funds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      object: "balance", livemode: false,
      available: [{ currency: "usd", amount: 800 }, { currency: "eur", amount: 9999 }],
      pending: [{ currency: "usd", amount: 50000 }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await new StripeTestClient("sk_test_example").availableBalanceCents("usd")).toBe(800);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.stripe.com/v1/balance");
  });

  it("rejects a live-mode balance response even with a test-prefixed key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      object: "balance", livemode: true, available: [{ currency: "usd", amount: 10000 }],
    }), { status: 200 })));
    await expect(new StripeTestClient("sk_test_example").availableBalanceCents("usd")).rejects.toThrow(/TEST mode/);
  });

  it("treats absent USD as zero and rejects malformed available balances", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      object: "balance", livemode: false, available: [{ currency: "eur", amount: 800 }],
    }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({
      object: "balance", livemode: false, available: [{ currency: "usd", amount: "800" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new StripeTestClient("sk_test_example");
    expect(await client.availableBalanceCents("usd")).toBe(0);
    await expect(client.availableBalanceCents("usd")).rejects.toThrow(/invalid/);
  });
});
