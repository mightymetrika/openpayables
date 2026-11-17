/** Stripe REST adapter: hard-locked to test API keys. No live transfer path. */
import type { PaymentProvider, ProviderTransfer, TransferInstruction } from "../provider.js";

const BASE = "https://api.stripe.com/v1";

export class StripeTestClient implements PaymentProvider {
  constructor(private readonly secret = process.env.OPENPAYABLES_STRIPE_TEST_SECRET_KEY) {
    if (!secret?.startsWith("sk_test_")) throw new Error("Stripe TEST secret key (sk_test_...) required; live keys are forbidden");
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: URLSearchParams, idempotencyKey?: string): Promise<T> {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secret}`,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
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

  async accountReady(accountId: string): Promise<boolean> {
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error("Invalid Stripe connected account ID");
    const account = await this.request<{ payouts_enabled: boolean; deleted?: boolean }>("GET", `/accounts/${accountId}`);
    return !!account.payouts_enabled && !account.deleted;
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
