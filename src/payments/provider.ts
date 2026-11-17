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
  accountReady(accountId: string): Promise<boolean>;
  createTransfer(instruction: TransferInstruction): Promise<ProviderTransfer>;
  retrieveTransfer(transferId: string): Promise<ProviderTransfer>;
  findTransferByObligation(obligationId: string): Promise<ProviderTransfer | null>;
}
