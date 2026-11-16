/** A proposal freezes weights at opening; subsequently earned points do not affect it. */
export type VoteChoice = "yes" | "no" | "abstain";
export interface VotingWeight { contributorId: string; weight: number }
export interface Ballot { contributorId: string; choice: VoteChoice }
export interface VoteTally {
  yes: number;
  no: number;
  abstain: number;
  uncast: number;
  eligibleWeight: number;
  castWeight: number;
  voterCount: number;
}

export function snapshotVotingWeights(balances: readonly VotingWeight[]): VotingWeight[] {
  const seen = new Set<string>();
  const result: VotingWeight[] = [];
  for (const { contributorId, weight } of balances) {
    if (!contributorId.trim() || seen.has(contributorId) || !Number.isSafeInteger(weight) || weight < 0) {
      throw new Error("Voting weights require unique contributor IDs and nonnegative integer points");
    }
    seen.add(contributorId);
    if (weight > 0) result.push({ contributorId, weight });
  }
  return result.sort((a, b) => a.contributorId.localeCompare(b.contributorId));
}

export function tallyVotes(weights: readonly VotingWeight[], ballots: readonly Ballot[]): VoteTally {
  const snapshot = snapshotVotingWeights(weights);
  const eligibility = new Map(snapshot.map((item) => [item.contributorId, item.weight]));
  const seen = new Set<string>();
  const tally: VoteTally = {
    yes: 0, no: 0, abstain: 0, uncast: 0,
    eligibleWeight: snapshot.reduce((sum, item) => sum + item.weight, 0),
    castWeight: 0, voterCount: 0,
  };
  for (const { contributorId, choice } of ballots) {
    const weight = eligibility.get(contributorId);
    if (weight === undefined || seen.has(contributorId) || !["yes", "no", "abstain"].includes(choice)) {
      throw new Error(`Invalid or duplicate ballot for ${contributorId}`);
    }
    seen.add(contributorId);
    tally[choice] += weight;
    tally.castWeight += weight;
    tally.voterCount++;
  }
  tally.uncast = tally.eligibleWeight - tally.castWeight;
  return tally;
}
