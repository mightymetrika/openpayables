/** Pure integer-cent calculation of an operator-attested project revenue-sharing pool. */
export interface RevenuePoolInputs {
  grossReceiptsCents: number;
  feeCents: number;
  costCents: number;
  reserveCents: number;
  contributorShareBasisPoints: number;
}

export interface RevenuePoolCalculation extends RevenuePoolInputs {
  netCents: number;
  poolCents: number;
}

export function calculateRevenuePool(input: RevenuePoolInputs): RevenuePoolCalculation {
  for (const [name, cents] of [
    ["grossReceiptsCents", input.grossReceiptsCents],
    ["feeCents", input.feeCents],
    ["costCents", input.costCents],
    ["reserveCents", input.reserveCents],
  ] as const) {
    if (!Number.isSafeInteger(cents) || cents < 0) {
      throw new Error(`${name} must be nonnegative safe integer cents`);
    }
  }
  const bps = input.contributorShareBasisPoints;
  if (!Number.isSafeInteger(bps) || bps <= 0 || bps > 10000) {
    throw new Error("contributorShareBasisPoints must be an integer between 1 and 10000");
  }
  const net = BigInt(input.grossReceiptsCents) - BigInt(input.feeCents) -
    BigInt(input.costCents) - BigInt(input.reserveCents);
  if (net <= 0n) throw new Error("Receipts must exceed fees, costs, and reserves");
  // Round down at the pool stage: never commit fractional cents or exceed the declared percentage.
  const pool = net * BigInt(bps) / 10000n;
  if (pool <= 0n || pool > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Calculated distribution pool must be positive safe integer cents");
  }
  return { ...input, netCents: Number(net), poolCents: Number(pool) };
}
