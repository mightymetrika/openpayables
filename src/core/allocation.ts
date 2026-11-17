/** Deterministic allocation of integer cents by lifetime contribution credits. */
export interface ContributorShare { contributorId: string; points: number }
export interface MoneyAllocation extends ContributorShare { amountCents: number }

export function allocateCents(poolCents: number, shares: readonly ContributorShare[]): MoneyAllocation[] {
  if (!Number.isSafeInteger(poolCents) || poolCents <= 0) throw new Error("Pool must be a positive safe integer of cents");
  const seen = new Set<string>();
  const positive = shares.filter(({ contributorId, points }) => {
    if (!contributorId?.trim() || seen.has(contributorId) || !Number.isSafeInteger(points) || points < 0) {
      throw new Error("Invalid or duplicate contributor credit");
    }
    seen.add(contributorId);
    return points > 0;
  });
  if (positive.length === 0) throw new Error("Cannot allocate without positive contribution credits");
  const total = positive.reduce((sum, x) => sum + BigInt(x.points), 0n);
  const draft = positive.map((s) => {
    const numerator = BigInt(poolCents) * BigInt(s.points);
    return { ...s, cents: numerator / total, remainder: numerator % total };
  });
  const floorSum = draft.reduce((sum, x) => sum + x.cents, 0n);
  const extra = Number(BigInt(poolCents) - floorSum);
  const ranked = [...draft].sort((a, b) => a.remainder === b.remainder
    ? (a.contributorId < b.contributorId ? -1 : a.contributorId > b.contributorId ? 1 : 0)
    : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < extra; i++) ranked[i]!.cents += 1n;
  return draft.map(({ contributorId, points, cents }) => ({
    contributorId, points, amountCents: Number(cents),
  })).sort((a, b) => (a.contributorId < b.contributorId ? -1 : a.contributorId > b.contributorId ? 1 : 0));
}
