import { describe, expect, it } from "vitest";
import { allocateCents } from "../src/core/allocation.js";

describe("deterministic integer-cent allocation", () => {
  it("distributes $11 at 8:3 points exactly", () => {
    expect(allocateCents(1100, [
      { contributorId: "alice", points: 8 }, { contributorId: "bob", points: 3 },
    ])).toEqual([
      { contributorId: "alice", points: 8, amountCents: 800 },
      { contributorId: "bob", points: 3, amountCents: 300 },
    ]);
  });
  it("distributes remainder cents with a stable ID tie-breaker", () => {
    expect(allocateCents(2, [
      { contributorId: "charlie", points: 1 },
      { contributorId: "bob", points: 1 },
      { contributorId: "alice", points: 1 },
    ])).toEqual([
      { contributorId: "alice", points: 1, amountCents: 1 },
      { contributorId: "bob", points: 1, amountCents: 1 },
      { contributorId: "charlie", points: 1, amountCents: 0 },
    ]);
  });
  it("preserves exact total even with large inputs", () => {
    const shares = allocateCents(9007199254740991, [
      { contributorId: "a", points: 8000000000 }, { contributorId: "b", points: 3000000000 },
    ]);
    expect(shares.reduce((sum, s) => sum + BigInt(s.amountCents), 0n)).toBe(9007199254740991n);
  });
  it("rejects invalid pools and duplicate/negative/noninteger credits", () => {
    expect(() => allocateCents(0, [{ contributorId: "a", points: 1 }])).toThrow();
    expect(() => allocateCents(3, [{ contributorId: "a", points: 0 }])).toThrow();
    expect(() => allocateCents(3, [{ contributorId: "a", points: -1 }])).toThrow();
    expect(() => allocateCents(3, [{ contributorId: "a", points: 1.5 }])).toThrow();
    expect(() => allocateCents(3, [{ contributorId: "a", points: 1 }, { contributorId: "a", points: 1 }])).toThrow();
  });
});
