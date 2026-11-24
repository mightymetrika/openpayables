import { afterEach, describe, expect, it, vi } from "vitest";
import { StripeLiveReadiness } from "../src/payments/stripe/live-readiness.js";
import { parseLiveReadinessArgs } from "../src/cli/live-readiness.js";

const acct = "acct_1R72guAS9QZRyQE2";
const restricted = "rk_live_fake_read_only";
function client(confirm = "YES_READ_ONLY", key = restricted, expected = acct) {
  return new StripeLiveReadiness(key, expected, confirm);
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
const platform = {
  id: acct, object: "account", country: "US", capabilities: { transfers: "active" },
  requirements: { disabled_reason: null, currently_due: [], past_due: [] },
};
const balance = {
  object: "balance", livemode: true,
  available: [{ currency: "usd", amount: 1200 }, { currency: "eur", amount: 800 }],
  pending: [{ currency: "usd", amount: 99999 }],
};

afterEach(() => vi.unstubAllGlobals());

describe("LIVE read-only preflight", () => {
  it("rejects missing confirmation and non-restricted keys before any network operation", () => {
    expect(() => client("NO")).toThrow(/YES_READ_ONLY/);
    for (const key of ["", "sk_test_example", "sk_live_example", "rk_test_example"]) {
      expect(() => client("YES_READ_ONLY", key)).toThrow(/restricted read key/);
    }
    expect(() => client("YES_READ_ONLY", restricted, "bad")).toThrow(/expected LIVE platform/);
  });

  it("reads live account and balance with GET only; no funding or payment action", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(platform)).mockResolvedValueOnce(json(balance));
    vi.stubGlobal("fetch", fetchMock);
    const result = await client().inspect();
    expect(result).toEqual({
      platformAccountId: acct, country: "US", transfersCapability: "active",
      usdAvailableCents: 1200, recipient: null, topup: null, safeToExecuteTransfer: false,
      note: expect.stringContaining("READ ONLY"),
    });
    expect(fetchMock.mock.calls.map(x => x[0])).toEqual([
      "https://api.stripe.com/v1/account", "https://api.stripe.com/v1/balance",
    ]);
    expect(fetchMock.mock.calls.every(x => x[1].method === "GET")).toBe(true);
    expect(fetchMock.mock.calls.every(x => x[1].headers.Authorization === `Bearer ${restricted}`)).toBe(true);
  });

  it("fails closed on wrong platform, country, capabilities, or disabled requirements", async () => {
    for (const override of [
      { id: "acct_another" }, { country: "CA" }, { capabilities: { transfers: "inactive" } },
      { requirements: { currently_due: [], past_due: [], disabled_reason: "requirements.pending_verification" } },
      { requirements: { currently_due: ["company.tax_id"], past_due: [], disabled_reason: null } },
    ]) {
      const fetchMock = vi.fn().mockResolvedValueOnce(json({ ...platform, ...override }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(client().inspect()).rejects.toThrow(/Wrong LIVE platform|outstanding requirements/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects test balances, malformed balances and unsafe amounts", async () => {
    for (const wrong of [
      { ...balance, livemode: false },
      { ...balance, available: "fake" },
      { ...balance, available: [{ currency: "usd", amount: "1200" }] },
      { ...balance, available: [{ currency: "usd", amount: Number.MAX_SAFE_INTEGER }, { currency: "usd", amount: 1 }] },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(platform)).mockResolvedValueOnce(json(wrong)));
      await expect(client().inspect()).rejects.toThrow(/LIVE available|invalid|exceeds/i);
    }
  });

  it("checks only the named recipient and refuses to treat non-US or incomplete recipients as pilot ready", async () => {
    const recipient = { id: "acct_payee123", object: "account", country: "US", payouts_enabled: true,
      details_submitted: true, capabilities: { transfers: "active" } };
    const mock = vi.fn().mockResolvedValueOnce(json(platform)).mockResolvedValueOnce(json(balance))
      .mockResolvedValueOnce(json(recipient));
    vi.stubGlobal("fetch", mock);
    const observed = await client().inspect(recipient.id);
    expect(observed.recipient?.transfersAndPayoutsAppearEnabled).toBe(true);
    expect(observed.safeToExecuteTransfer).toBe(false);
    expect(mock.mock.calls[2]?.[0]).toBe("https://api.stripe.com/v1/accounts/acct_payee123");
    for (const override of [{ country: "GB" }, { payouts_enabled: false }, { details_submitted: false },
      { capabilities: { transfers: "pending" } }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(platform))
        .mockResolvedValueOnce(json(balance)).mockResolvedValueOnce(json({ ...recipient, ...override })));
      expect((await client().inspect(recipient.id)).recipient?.transfersAndPayoutsAppearEnabled).toBe(false);
    }
  });

  it("does not accept a spoofed recipient response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(platform)).mockResolvedValueOnce(json(balance))
      .mockResolvedValueOnce(json({ id: "acct_wrong", object: "account" })));
    await expect(client().inspect("acct_payee123")).rejects.toThrow(/identity mismatch/);
  });

  it("verifies a succeeded LIVE top-up but never creates or attributes funds", async () => {
    const topup = { id: "tu_real123", object: "topup", livemode: true, status: "succeeded",
      amount: 2500, currency: "usd", balance_transaction: "txn_real123" };
    const mock = vi.fn().mockResolvedValueOnce(json(platform)).mockResolvedValueOnce(json(balance))
      .mockResolvedValueOnce(json(topup));
    vi.stubGlobal("fetch", mock);
    const result = await client().inspect(undefined, "tu_real123");
    expect(result.topup?.amountCents).toBe(2500);
    expect(result.usdAvailableCents).toBe(1200);
    expect(result.safeToExecuteTransfer).toBe(false);
    expect(mock.mock.calls[2]?.[0]).toBe("https://api.stripe.com/v1/topups/tu_real123");
    expect(mock.mock.calls.every(x => x[1].method === "GET")).toBe(true);
  });

  it("rejects pending, reversed, test, malformed, or unfunded top-up claims", async () => {
    const valid = { id: "tu_real123", object: "topup", livemode: true, status: "succeeded",
      amount: 2500, currency: "usd", balance_transaction: "txn_real123" };
    for (const override of [
      { livemode: false }, { status: "pending" }, { status: "reversed" }, { amount: 0 },
      { balance_transaction: null }, { currency: "eur" }, { id: "tu_fake" },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(platform)).mockResolvedValueOnce(json(balance))
        .mockResolvedValueOnce(json({ ...valid, ...override })));
      await expect(client().inspect(undefined, "tu_real123")).rejects.toThrow(/not a verified/);
    }
  });

  it("rejects malformed Stripe IDs before any API request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().inspect("acct_a/../bad")).rejects.toThrow(/Invalid connected/);
    await expect(client().inspect(undefined, "tu_a?x=y")).rejects.toThrow(/Invalid Stripe top-up/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not echo any Stripe error response or credentials", async () => {
    const mock = vi.fn().mockResolvedValue(json({ error: { message: restricted } }, 403));
    vi.stubGlobal("fetch", mock);
    await expect(client().inspect()).rejects.toThrow(/HTTP 403/);
    await expect(client().inspect()).rejects.not.toThrow(/rk_live/);
  });
});

describe("independent LIVE-readiness command arguments", () => {
  it("permits zero or one of each explicit identifier", () => {
    expect(parseLiveReadinessArgs([])).toEqual({});
    expect(parseLiveReadinessArgs(["--topup", "tu_one", "--recipient", "acct_two"]))
      .toEqual({ topupId: "tu_one", recipientId: "acct_two" });
  });
  it("refuses unrelated CLI commands and duplicate flags", () => {
    expect(() => parseLiveReadinessArgs(["payment", "send"])).toThrow(/Usage/);
    expect(() => parseLiveReadinessArgs(["--topup"])).toThrow(/Usage/);
    expect(() => parseLiveReadinessArgs(["--topup", "tu_a", "--topup", "tu_b"]))
      .toThrow(/Duplicate/);
  });
});
