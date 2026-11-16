import { describe, expect, it } from "vitest";
import { accumulateCredits, pointsForSize } from "../src/core/credits.js";
import { snapshotVotingWeights, tallyVotes } from "../src/core/voting.js";

describe("credit scoring and accumulation", () => {
  it("uses the MVP 1/3/8 rubric", () => {
    expect(pointsForSize("small")).toBe(1);
    expect(pointsForSize("medium")).toBe(3);
    expect(pointsForSize("large")).toBe(8);
  });

  it("rejects unsupported sizes instead of silently assigning zero", () => {
    expect(() => pointsForSize("enormous" as "large")).toThrow(/Invalid award size/);
  });

  it("accumulates lifetime credit for active and inactive contributors", () => {
    expect(accumulateCredits([
      { contributorId: "alice", pointsDelta: 8 },
      { contributorId: "bob", pointsDelta: 3 },
      { contributorId: "alice", pointsDelta: 1 },
    ])).toEqual([
      { contributorId: "alice", points: 9 },
      { contributorId: "bob", points: 3 },
    ]);
  });

  it("handles immutable reversal events rather than rewriting awards", () => {
    expect(accumulateCredits([
      { contributorId: "alice", pointsDelta: 8 },
      { contributorId: "alice", pointsDelta: -8 },
    ])).toEqual([{ contributorId: "alice", points: 0 }]);
  });

  it("rejects negative totals and noninteger awards", () => {
    expect(() => accumulateCredits([{ contributorId: "a", pointsDelta: -1 }])).toThrow();
    expect(() => accumulateCredits([{ contributorId: "a", pointsDelta: 1.5 }])).toThrow();
  });
});

describe("governance", () => {
  const weights = [
    { contributorId: "alice", weight: 8 },
    { contributorId: "bob", weight: 3 },
    { contributorId: "charlie", weight: 0 },
  ];

  it("snapshots eligible contributors only and never mutates inputs", () => {
    const frozen = snapshotVotingWeights(weights);
    expect(frozen).toEqual([
      { contributorId: "alice", weight: 8 },
      { contributorId: "bob", weight: 3 },
    ]);
    weights[0]!.weight = 12;
    expect(frozen[0]!.weight).toBe(8);
  });

  it("tallies yes, no, abstain and uncast weights", () => {
    expect(tallyVotes([
      { contributorId: "a", weight: 8 },
      { contributorId: "b", weight: 3 },
      { contributorId: "c", weight: 1 },
      { contributorId: "d", weight: 2 },
    ], [
      { contributorId: "a", choice: "yes" },
      { contributorId: "b", choice: "no" },
      { contributorId: "c", choice: "abstain" },
    ])).toEqual({ yes: 8, no: 3, abstain: 1, uncast: 2, eligibleWeight: 14, castWeight: 12, voterCount: 3 });
  });

  it("rejects duplicate ballots and votes from ineligible people", () => {
    expect(() => tallyVotes([{ contributorId: "a", weight: 8 }], [
      { contributorId: "a", choice: "yes" },
      { contributorId: "a", choice: "no" },
    ])).toThrow(/Invalid or duplicate/);
    expect(() => tallyVotes([{ contributorId: "a", weight: 8 }], [
      { contributorId: "b", choice: "yes" },
    ])).toThrow(/Invalid or duplicate/);
  });

  it("rejects invalid snapshot weights", () => {
    expect(() => snapshotVotingWeights([
      { contributorId: "a", weight: 5 },
      { contributorId: "a", weight: 7 },
    ])).toThrow();
    expect(() => snapshotVotingWeights([{ contributorId: "a", weight: -1 }])).toThrow();
  });
});
