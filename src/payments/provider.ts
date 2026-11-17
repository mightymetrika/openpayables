export interface ProviderTransfer {
  id: string;
  amount: number;
  currency: string;
  destination: string;
  amount_reversed: number;
  metadata: Record<string, string>;
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

export interface TestFundingProvider {
  verifyTestTopup(topupId: string): Promise<TestTopupReceipt>;
}
