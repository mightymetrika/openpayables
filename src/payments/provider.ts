export interface ProviderTransfer {
  id: string;
  amount: number;
  currency: string;
  destination: string;
  amount_reversed: number;
  metadata: Record<string, string>;
  /** Optional on older test fakes; live trace requires explicit livemode=false. */
  livemode?: boolean;
  /** Connected-account credit (py_...) belonging to this platform transfer. */
  destination_payment?: string | null;
}
export interface TransferInstruction {
  obligationId: string;
  periodId: string;
  projectId: string;
  amountCents: number;
  destination: string;
  idempotencyKey: string;
}
export interface PaymentProvider {
  /** Live-mode implementations are prohibited until the separate release gate passes. */
  availableBalanceCents(currency: "usd"): Promise<number>;
  platformAccountId(): Promise<string>;
  accountReady(accountId: string): Promise<boolean>;
  createTransfer(instruction: TransferInstruction): Promise<ProviderTransfer>;
  retrieveTransfer(transferId: string): Promise<ProviderTransfer>;
  findTransferByObligation(obligationId: string): Promise<ProviderTransfer | null>;
}

/** Confirmed TEST top-up evidence. Project assignment is an operator decision, not a Stripe claim. */
export interface TestTopupReceipt {
  topupId: string;
  platformAccountId: string;
  balanceTransactionId: string;
  amountCents: number;
  currency: "usd";
}

/** Current provider state; unlike import evidence, a reversed receipt is returned for audit. */
export interface TestTopupObservation {
  topupId: string;
  platformAccountId: string;
  status: "succeeded" | "pending" | "failed" | "canceled" | "reversed";
  amountCents: number;
  currency: string;
  balanceTransactionId: string | null;
}

export interface TestFundingProvider {
  verifyTestTopup(topupId: string): Promise<TestTopupReceipt>;
  inspectTestTopup(topupId: string): Promise<TestTopupObservation>;
}

/** Account-level bank payout evidence. Never equate this with a specific transfer. */
export type TestPayoutStatus = "pending" | "in_transit" | "paid" | "failed" | "canceled";
export interface TestConnectedPayout {
  id: string;
  amount: number;
  currency: string;
  status: TestPayoutStatus;
  livemode: false;
  destination: string | null;
  created: number;
  arrival_date: number | null;
  failure_code: string | null;
}
export interface TestConnectedPayoutProvider {
  platformAccountId(): Promise<string>;
  listConnectedPayouts(connectedAccountId: string): Promise<TestConnectedPayout[]>;
}

/** Stripe TEST-only balance-transaction attribution for ONE named payout. */
export interface TestPayoutBalanceEntry {
  id: string;
  amountCents: number;
  currency: string;
}
export interface TestAutomaticPayoutComposition {
  payoutId: string;
  connectedAccountId: string;
  automatic: boolean;
  reconciliationStatus: "completed" | "in_progress" | "not_applicable";
  payoutStatus: TestPayoutStatus;
  amountCents: number;
  currency: string;
  matchingEntries: TestPayoutBalanceEntry[];
}
export interface TestPayoutTraceProvider {
  platformAccountId(): Promise<string>;
  retrieveTransfer(transferId: string): Promise<ProviderTransfer>;
  inspectPayoutComposition(
    connectedAccountId: string, payoutId: string, destinationPaymentId: string,
  ): Promise<TestAutomaticPayoutComposition>;
}
