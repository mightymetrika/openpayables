import { describe, expect, it } from "vitest";
import { calculateRevenuePool } from "../src/core/pool.js";

const example = {
  grossReceiptsCents: 10000, feeCents: 300, costCents: 1200,
  reserveCents: 500, contributorShareBasisPoints: 2500,
};

describe("C13 deterministic operator-declared revenue pool", () => {
  it("calculates available net receipts and a deterministic integer-cent pool", () => {
    expect(calculateRevenuePool(example)).toMatchObject({ netCents: 8000, poolCents: 2000 });
  });
  it("rounds downward on fractional-cent pools", () => {
    expect(calculateRevenuePool({ grossReceiptsCents: 101, feeCents: 0, costCents: 0,
      reserveCents: 0, contributorShareBasisPoints: 3333 }).poolCents).toBe(33);
  });
  it("uses bigint arithmetic for large safe-cent inputs", () => {
    expect(calculateRevenuePool({ grossReceiptsCents: Number.MAX_SAFE_INTEGER,
      feeCents: 0, costCents: 0, reserveCents: 0,
      contributorShareBasisPoints: 10000 }).poolCents).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("rejects invalid values, loss-making periods and zero-cent resulting pools", () => {
    for (const changed of [
      { feeCents: -1 }, { grossReceiptsCents: 1.5 }, { reserveCents: Number.MAX_SAFE_INTEGER + 1 },
      { contributorShareBasisPoints: 0 }, { contributorShareBasisPoints: 10001 },
      { contributorShareBasisPoints: 5.5 }, { feeCents: 10000 },
      { grossReceiptsCents: 1, feeCents: 0, costCents: 0,
        reserveCents: 0, contributorShareBasisPoints: 1 },
    ]) {
      expect(() => calculateRevenuePool({ ...example, ...changed })).toThrow();
    }
  });
});
