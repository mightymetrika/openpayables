import { describe, expect, it } from "vitest";
import { previewFromBalances } from "../src/operator/review.js";

describe("C12 read-only compensation preview", () => {
  it("shows the 8:3 -> $8/$3 example without creating obligations", () => {
    const result = previewFromBalances("project", 1100, [
      { contributorId: "alice", displayName: "Alice", points: 8 },
      { contributorId: "bob", displayName: "Bob", points: 3 },
    ]);
    expect(result).toMatchObject({ currency: "usd", hypotheticalPoolCents: 1100,
      totalPoints: 11, allocatedCents: 1100, hypothetical: true, fundingVerified: false,
      creditsConsumed: false, paymentObligationsCreated: 0 });
    expect(result.allocations).toMatchObject([
      { contributorId: "alice", amountCents: 800, amountUsd: "8.00" },
      { contributorId: "bob", amountCents: 300, amountUsd: "3.00" },
    ]);
  });

  it("uses deterministic largest-remainder cents and leaves the input untouched", () => {
    const balances = [
      { contributorId: "z", displayName: "Z", points: 1 },
      { contributorId: "a", displayName: "A", points: 1 },
    ];
    const before = JSON.stringify(balances);
    const result = previewFromBalances("p", 3, balances);
    expect(result.allocations).toMatchObject([
      { contributorId: "a", amountCents: 2 },
      { contributorId: "z", amountCents: 1 },
    ]);
    expect(JSON.stringify(balances)).toBe(before);
  });

  it("refuses invalid pools and projects", () => {
    const rows = [{ contributorId: "alice", displayName: "Alice", points: 8 }];
    expect(() => previewFromBalances("", 1100, rows)).toThrow(/project ID/);
    for (const cents of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
      expect(() => previewFromBalances("p", cents, rows)).toThrow(/positive safe integer/);
    }
  });

  it("refuses an unfunded-looking preview without any approved positive credits", () => {
    expect(() => previewFromBalances("p", 100, [])).toThrow(/positive contribution credits/);
    expect(() => previewFromBalances("p", 100, [
      { contributorId: "alice", displayName: "Alice", points: 0 },
    ])).toThrow(/positive contribution credits/);
  });
});
