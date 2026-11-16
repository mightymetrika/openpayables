/** Pure contribution scoring rules. Project policy versions are a Checkpoint B concern. */
export const AWARD_POINTS = Object.freeze({ small: 1, medium: 3, large: 8 } as const);
export type AwardSize = keyof typeof AWARD_POINTS;

export interface CreditEvent {
  contributorId: string;
  pointsDelta: number;
}

export interface CreditBalance {
  contributorId: string;
  points: number;
}

export function pointsForSize(size: AwardSize): number {
  const points = AWARD_POINTS[size];
  if (points === undefined) throw new Error(`Invalid award size: ${String(size)}`);
  return points;
}

export function accumulateCredits(events: readonly CreditEvent[]): CreditBalance[] {
  const totals = new Map<string, number>();
  for (const event of events) {
    if (!event.contributorId.trim() || !Number.isSafeInteger(event.pointsDelta) || event.pointsDelta === 0) {
      throw new Error("Credit events require a contributor ID and a nonzero integer adjustment");
    }
    const next = (totals.get(event.contributorId) ?? 0) + event.pointsDelta;
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new Error(`Invalid cumulative credit for ${event.contributorId}`);
    }
    totals.set(event.contributorId, next);
  }
  return [...totals.entries()]
    .map(([contributorId, points]) => ({ contributorId, points }))
    .sort((a, b) => a.contributorId.localeCompare(b.contributorId));
}
