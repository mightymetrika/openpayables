/** Stripe REST adapter: hard-locked to test API keys. No live transfer path. */
import type { PaymentProvider, ProviderTransfer, TransferInstruction, TestFundingProvider, TestTopupReceipt, TestTopupObservation, TestConnectedPayout, TestPayoutStatus } from "../provider.js";

const BASE = "https://api.stripe.com/v1";

export class StripeTestClient implements PaymentProvider, TestFundingProvider {
  constructor(private readonly secret = process.env.OPENPAYABLES_STRIPE_TEST_SECRET_KEY) {
    if (!secret?.startsWith("sk_test_")) throw new Error("Stripe TEST secret key (sk_test_...) required; live keys are forbidden");
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: URLSearchParams, idempotencyKey?: string, connectedAccountId?: string): Promise<T> {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secret}`,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...(connectedAccountId ? { "Stripe-Account": connectedAccountId } : {}),
      },
      body: body?.toString(),
      signal: AbortSignal.timeout(30000),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      // Credentials, authorization and business-rule errors might follow a request to Stripe.
      // Callers treat ALL errors during transfer creation as uncertain, never as safe-to-retry.
      throw new Error(`Stripe HTTP ${response.status}: ${JSON.stringify(result).slice(0, 450)}`);
    }
    return result as T;
  }

  /** Available funds for the authenticated TEST platform, not project-specific revenue. */
  async availableBalanceCents(currency: "usd"): Promise<number> {
    const balance = await this.request<{
      livemode: boolean;
      available: { currency: string; amount: number }[];
    }>("GET", "/balance");
    if (balance.livemode !== false || !Array.isArray(balance.available)) {
      throw new Error("Stripe balance response did not prove TEST mode with available balances");
    }
    const matches = balance.available.filter((entry) => entry?.currency === currency);
    if (matches.some((entry) => !Number.isSafeInteger(entry.amount))) {
      throw new Error("Stripe balance returned an invalid available amount");
    }
    const cents = matches.reduce((sum, entry) => sum + entry.amount, 0);
    if (!Number.isSafeInteger(cents)) throw new Error("Stripe available balance exceeds safe integer range");
    return cents;
  }

  /** This identifies the TEST platform that owns both funding receipts and transfers. */
  async platformAccountId(): Promise<string> {
    const account = await this.request<{ id: unknown }>("GET", "/account");
    if (typeof account.id !== "string" || !/^acct_[A-Za-z0-9]+$/.test(account.id)) {
      throw new Error("Stripe TEST platform identity could not be verified");
    }
    return account.id;
  }

  /** Read-only state inspection; can report a reversal without crediting it again. */
  async inspectTestTopup(topupId: string): Promise<TestTopupObservation> {
    if (!/^tu_[A-Za-z0-9]+$/.test(topupId)) throw new Error("Invalid Stripe test top-up ID");
    const topup = await this.request<{
      id: unknown; object: unknown; amount: unknown; currency: unknown;
      status: unknown; livemode: unknown; balance_transaction: unknown;
    }>("GET", `/topups/${topupId}`);
    if (topup.id !== topupId || topup.object !== "topup" || topup.livemode !== false ||
      typeof topup.currency !== "string" ||
      !["succeeded", "pending", "failed", "canceled", "reversed"].includes(String(topup.status)) ||
      typeof topup.amount !== "number" || !Number.isSafeInteger(topup.amount) || topup.amount <= 0 ||
      (topup.balance_transaction !== null && typeof topup.balance_transaction !== "string")) {
      throw new Error("Stripe TEST top-up inspection returned invalid evidence");
    }
    return {
      topupId, platformAccountId: await this.platformAccountId(),
      status: topup.status as TestTopupObservation["status"],
      currency: topup.currency, amountCents: topup.amount,
      balanceTransactionId: topup.balance_transaction,
    };
  }

  /** Read-only verification; this does NOT create a top-up or claim project ownership. */
  async verifyTestTopup(topupId: string): Promise<TestTopupReceipt> {
    if (!/^tu_[A-Za-z0-9]+$/.test(topupId)) throw new Error("Invalid Stripe test top-up ID");
    const topup = await this.request<{
      id: unknown; object: unknown; amount: unknown; currency: unknown;
      status: unknown; livemode: unknown; balance_transaction: unknown;
    }>("GET", `/topups/${topupId}`);
    if (topup.id !== topupId || topup.object !== "topup" ||
        topup.status !== "succeeded" || topup.livemode !== false ||
        topup.currency !== "usd" || typeof topup.amount !== "number" ||
        !Number.isSafeInteger(topup.amount) || topup.amount <= 0 ||
        typeof topup.balance_transaction !== "string" ||
        !/^txn_[A-Za-z0-9]+$/.test(topup.balance_transaction)) {
      throw new Error("Stripe receipt is not a succeeded USD TEST top-up with balance evidence");
    }
    return {
      topupId, platformAccountId: await this.platformAccountId(),
      balanceTransactionId: topup.balance_transaction,
      amountCents: topup.amount, currency: "usd",
    };
  }

  async accountReady(accountId: string): Promise<boolean> {
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error("Invalid Stripe connected account ID");
    const account = await this.request<{ payouts_enabled: boolean; deleted?: boolean }>("GET", `/accounts/${accountId}`);
    return !!account.payouts_enabled && !account.deleted;
  }

  /** Read Stripe TEST bank-payout status from the connected account, NEVER the platform. */
  async listConnectedPayouts(connectedAccountId: string): Promise<TestConnectedPayout[]> {
    if (!/^acct_[A-Za-z0-9]+$/.test(connectedAccountId)) throw new Error("Invalid Stripe connected account ID");
    const payouts: TestConnectedPayout[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    // Deliberately refuse incomplete history rather than treating a truncated list as complete.
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const params = new URLSearchParams({ limit: "100" });
      if (cursor) params.set("starting_after", cursor);
      const page = await this.request<{object: unknown; data: unknown; has_more: unknown}>(
        "GET", `/payouts?${params.toString()}`, undefined, undefined, connectedAccountId,
      );
      if (page.object !== "list" || !Array.isArray(page.data) || typeof page.has_more !== "boolean") {
        throw new Error("Stripe connected payout list response is malformed");
      }
      for (const raw of page.data) {
        if (!raw || typeof raw !== "object") throw new Error("Invalid Stripe connected payout evidence");
        const p = raw as Record<string, unknown>;
        const permitted: TestPayoutStatus[] = ["pending", "in_transit", "paid", "failed", "canceled"];
        if (p.object !== "payout" || typeof p.id !== "string" || !/^po_[A-Za-z0-9]+$/.test(p.id) ||
          seen.has(p.id) || p.livemode !== false ||
          !Number.isSafeInteger(p.amount) || (p.amount as number) <= 0 ||
          typeof p.currency !== "string" || !/^[a-z]{3}$/.test(p.currency) ||
          !permitted.includes(p.status as TestPayoutStatus) ||
          !Number.isSafeInteger(p.created) || (p.created as number) < 0 ||
          (p.arrival_date !== null && p.arrival_date !== undefined &&
            (!Number.isSafeInteger(p.arrival_date) || (p.arrival_date as number) < 0)) ||
          (p.destination !== null && p.destination !== undefined &&
            (typeof p.destination !== "string" || !/^[A-Za-z0-9_]+$/.test(p.destination))) ||
          (p.failure_code !== null && p.failure_code !== undefined &&
            (typeof p.failure_code !== "string" || p.failure_code.length > 128))) {
          throw new Error("Invalid Stripe TEST connected payout evidence; no results accepted");
        }
        seen.add(p.id);
        payouts.push({
          id: p.id, amount: p.amount as number, currency: p.currency,
          status: p.status as TestPayoutStatus, livemode: false,
          destination: (p.destination as string | null | undefined) ?? null,
          created: p.created as number,
          arrival_date: (p.arrival_date as number | null | undefined) ?? null,
          failure_code: (p.failure_code as string | null | undefined) ?? null,
        });
      }
      if (!page.has_more) return payouts;
      const last = payouts.at(-1);
      if (!last) throw new Error("Stripe payout pagination ended unexpectedly");
      cursor = last.id;
    }
    throw new Error("Stripe connected payout history exceeds 1000 records; synchronization refused");
  }

  async createExpressAccount(email: string): Promise<{ id: string }> {
    const p = new URLSearchParams({ type: "express", country: "US", email });
    return this.request("POST", "/accounts", p);
  }

  async onboardingLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<{ url: string }> {
    for (const url of [refreshUrl, returnUrl]) {
      const parsed = new URL(url);
      if (!(["http:", "https:"].includes(parsed.protocol))) throw new Error("Onboarding URLs must use HTTP(S)");
    }
    return this.request("POST", "/account_links", new URLSearchParams({
      account: accountId, type: "account_onboarding", refresh_url: refreshUrl, return_url: returnUrl,
    }));
  }

  async createTransfer(x: TransferInstruction): Promise<ProviderTransfer> {
    const p = new URLSearchParams({
      amount: String(x.amountCents), currency: "usd", destination: x.destination,
      transfer_group: `openpayables_${x.periodId}`,
      "metadata[obligation_id]": x.obligationId,
      "metadata[period_id]": x.periodId,
      "metadata[project_id]": x.projectId,
    });
    return this.request("POST", "/transfers", p, x.idempotencyKey);
  }

  async retrieveTransfer(transferId: string): Promise<ProviderTransfer> {
    if (!/^tr_[A-Za-z0-9]+$/.test(transferId)) throw new Error("Invalid Stripe transfer ID");
    return this.request("GET", `/transfers/${transferId}`);
  }

  async findTransferByObligation(obligationId: string): Promise<ProviderTransfer | null> {
    // Search metadata across all available transfers. Failure/incomplete search MUST NOT
    // be interpreted as permission to initiate another transfer.
    let startingAfter: string | undefined;
    for (;;) {
      const params = new URLSearchParams({ limit: "100" });
      if (startingAfter) params.set("starting_after", startingAfter);
      const page = await this.request<{ data: ProviderTransfer[]; has_more: boolean }>("GET", `/transfers?${params.toString()}`);
      const found = page.data.find((x) => x.metadata?.obligation_id === obligationId);
      if (found) return found;
      if (!page.has_more) return null;
      const last = page.data.at(-1);
      if (!last) throw new Error("Stripe transfer pagination ended unexpectedly");
      startingAfter = last.id;
    }
  }
}
