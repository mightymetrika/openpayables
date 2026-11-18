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


describe("Stripe TEST top-up receipt verification", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("verifies a succeeded USD TEST top-up and platform identity without creating funds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      id: "tu_test123", object: "topup", status: "succeeded", livemode: false,
      amount: 1100, currency: "usd", balance_transaction: "txn_123456",
    }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({
      id: "acct_platform123", object: "account",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await new StripeTestClient("sk_test_example").verifyTestTopup("tu_test123")).toEqual({
      topupId: "tu_test123", platformAccountId: "acct_platform123",
      balanceTransactionId: "txn_123456", amountCents: 1100, currency: "usd",
    });
    expect(fetchMock.mock.calls.map((x) => x[0])).toEqual([
      "https://api.stripe.com/v1/topups/tu_test123", "https://api.stripe.com/v1/account",
    ]);
    expect(fetchMock.mock.calls.every((x) => x[1]?.method === "GET")).toBe(true);
  });

  it.each([
    { status: "pending" }, { status: "reversed" }, { livemode: true },
    { currency: "eur" }, { amount: "1100" }, { balance_transaction: null },
    { object: "charge" },
  ])("rejects unconfirmed or malformed top-up evidence: %o", async (override) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "tu_test123", object: "topup", status: "succeeded", livemode: false,
      amount: 1100, currency: "usd", balance_transaction: "txn_123456", ...override,
    }), { status: 200 })));
    await expect(new StripeTestClient("sk_test_example").verifyTestTopup("tu_test123"))
      .rejects.toThrow(/not a succeeded/);
  });

  it("rejects malformed Stripe platform identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      id: "tu_test123", object: "topup", status: "succeeded", livemode: false,
      amount: 1100, currency: "usd", balance_transaction: "txn_123456",
    }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({
      id: "invalid-platform",
    }), { status: 200 })));
    await expect(new StripeTestClient("sk_test_example").verifyTestTopup("tu_test123"))
      .rejects.toThrow(/identity/);
  });
});


describe("Stripe TEST top-up reversal inspection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a reversed receipt without regarding it as new funding", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      id: "tu_reversed123", object: "topup", status: "reversed", livemode: false,
      amount: 500, currency: "usd", balance_transaction: null,
    }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({
      id: "acct_platform123", object: "account",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const observation = await new StripeTestClient("sk_test_example").inspectTestTopup("tu_reversed123");
    expect(observation).toEqual({
      topupId: "tu_reversed123", platformAccountId: "acct_platform123",
      status: "reversed", amountCents: 500, currency: "usd", balanceTransactionId: null,
    });
    expect(fetchMock.mock.calls.every((x) => x[1]?.method === "GET")).toBe(true);
  });

  it("rejects a live-mode receipt during inspection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      id: "tu_reversed123", object: "topup", status: "reversed", livemode: true,
      amount: 500, currency: "usd", balance_transaction: null,
    }), { status: 200 })));
    await expect(new StripeTestClient("sk_test_example").inspectTestTopup("tu_reversed123"))
      .rejects.toThrow(/invalid evidence/);
  });
});


describe("Stripe TEST connected bank-payout observation (read-only)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const payout = {
    id: "po_example123", object: "payout", livemode: false,
    amount: 800, currency: "usd", status: "pending", destination: "ba_example123",
    created: 1770000000, arrival_date: 1770172800, failure_code: null,
  };

  it("reads payout data from the connected account header, never the platform", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      object: "list", data: [payout], has_more: false,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new StripeTestClient("sk_test_example").listConnectedPayouts("acct_recipient123");
    expect(result).toMatchObject([{ id: "po_example123", status: "pending", livemode: false }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.stripe.com/v1/payouts?limit=100");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET", headers: { "Stripe-Account": "acct_recipient123" },
    });
  });

  it("paginates across connected-account payout pages without writing to Stripe", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: "list", data: [payout], has_more: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: "list", data: [{ ...payout, id: "po_second456", status: "paid" }], has_more: false,
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new StripeTestClient("sk_test_example").listConnectedPayouts("acct_recipient123");
    expect(result.map((p) => p.id)).toEqual(["po_example123", "po_second456"]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.stripe.com/v1/payouts?limit=100&starting_after=po_example123");
    expect(fetchMock.mock.calls.every((c) => c[1]?.method === "GET" &&
      c[1]?.headers["Stripe-Account"] === "acct_recipient123")).toBe(true);
  });

  it.each([
    { livemode: true }, { object: "transfer" }, { amount: 0 }, { amount: "800" },
    { id: "not_a_payout" }, { status: "unrecognized" }, { currency: "invalid" },
    { arrival_date: "tomorrow" },
  ])("refuses invalid or LIVE payout evidence: %o", async (override) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      object: "list", data: [{ ...payout, ...override }], has_more: false,
    }), { status: 200 })));
    await expect(new StripeTestClient("sk_test_example").listConnectedPayouts("acct_recipient123"))
      .rejects.toThrow(/Invalid Stripe TEST connected payout evidence/);
  });

  it("refuses a duplicate payout or an invalid connected account ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      object: "list", data: [payout, payout], has_more: false,
    }), { status: 200 })));
    const client = new StripeTestClient("sk_test_example");
    await expect(client.listConnectedPayouts("acct_recipient123")).rejects.toThrow(/Invalid Stripe TEST/);
    await expect(client.listConnectedPayouts("not_an_account")).rejects.toThrow(/Invalid Stripe connected/);
  });
});
