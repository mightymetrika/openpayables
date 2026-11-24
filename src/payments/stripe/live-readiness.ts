/**
 * Read-only LIVE Stripe preflight for a single operator-owned first-payout pilot.
 * This file contains no POST/PUT/PATCH/DELETE method and no money-movement API.
 * Its results are observations, not authority to make a LIVE payment.
 */
const API = "https://api.stripe.com/v1";
const ACCOUNT = /^acct_[A-Za-z0-9]+$/;
const TOPUP = /^tu_[A-Za-z0-9]+$/;
const TRANSACTION = /^txn_[A-Za-z0-9]+$/;

export interface LiveReadinessSummary {
  platformAccountId: string;
  country: "US";
  transfersCapability: "active" | "sandbox_not_required";
  usdAvailableCents: number;
  recipient: null | {
    accountId: string;
    country: string;
    transfersCapability: string;
    payoutsEnabled: boolean;
    transfersAndPayoutsAppearEnabled: boolean;
  };
  topup: null | {
    id: string;
    amountCents: number;
    currency: "usd";
    balanceTransactionId: string;
    status: "succeeded";
  };
  safeToExecuteTransfer: false;
  note: string;
}

export interface LivePilotEvidence extends LiveReadinessSummary {
  receiptNetCents: number;
}

/** An intentionally limited subset of the Stripe REST API with GET-only access. */
class StripePilotReadiness {
  constructor(
    private readonly key: string | undefined,
    private readonly expectedAccount: string | undefined,
    confirmation: string | undefined,
    private readonly live: boolean,
  ) {
    if (confirmation !== (live ? "YES_READ_ONLY" : "YES_SANDBOX_ONLY")) {
      throw new Error(live ? "Explicit YES_READ_ONLY confirmation required for LIVE account inspection" : "Explicit YES_SANDBOX_ONLY confirmation required");
    }
    if (!key || !(live ? /^rk_live_.+$/.test(key) : /^(sk|rk)_test_.+$/.test(key))) {
      throw new Error(live ? "A Stripe LIVE restricted read key (rk_live_...) is required" : "Stripe TEST key required");
    }
    if (!expectedAccount || !ACCOUNT.test(expectedAccount)) {
      throw new Error("Set the expected LIVE platform acct_... ID before inspection");
    }
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    // Paths are constructed only from constants or validated Stripe IDs below.
    const res = await fetch(`${API}${path}`, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${this.key}`, "Stripe-Version": "2026-11-18.endive" },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      // Never print Stripe error bodies: they can include account information.
      throw new Error(`Stripe ${this.live ? "LIVE" : "TEST"} read-only inspection failed (HTTP ${res.status})`);
    }
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Stripe LIVE response is malformed");
    }
    return body as Record<string, unknown>;
  }

  async inspect(recipientId?: string, topupId?: string): Promise<LiveReadinessSummary> {
    if (recipientId !== undefined && !ACCOUNT.test(recipientId)) {
      throw new Error("Invalid connected recipient account ID");
    }
    if (topupId !== undefined && !TOPUP.test(topupId)) {
      throw new Error("Invalid Stripe top-up ID");
    }
    const platform = await this.get("/account");
    if (platform.id !== this.expectedAccount || platform.country !== "US" ||
        (this.live && (platform.capabilities as Record<string, unknown> | undefined)?.transfers !== "active")) {
      throw new Error(this.live ? "Wrong LIVE platform, non-US platform, or transfers capability inactive" : "Wrong TEST platform or non-US platform");
    }
    const requirements = platform.requirements as Record<string, unknown> | undefined;
    if (this.live && (!requirements || !Array.isArray(requirements.currently_due) ||
        !Array.isArray(requirements.past_due))) {
      throw new Error("LIVE platform requirements were not available for inspection");
    }
    if (this.live && requirements && (requirements.disabled_reason || (requirements.currently_due as unknown[]).length > 0 ||
        (requirements.past_due as unknown[]).length > 0)) {
      throw new Error("LIVE platform has outstanding requirements; inspection refused");
    }
    const balance = await this.get("/balance");
    if (balance.object !== "balance" || balance.livemode !== this.live || !Array.isArray(balance.available)) {
      throw new Error(`Stripe response did not prove a ${this.live ? "LIVE" : "TEST"} available balance`);
    }
    let available = 0;
    for (const raw of balance.available) {
      if (!raw || typeof raw !== "object") throw new Error("Malformed Stripe balance entry");
      const line = raw as Record<string, unknown>;
      if (typeof line.currency !== "string" || !Number.isSafeInteger(line.amount)) {
        throw new Error("Invalid Stripe available balance");
      }
      if (line.currency === "usd") {
        available += line.amount as number;
        if (!Number.isSafeInteger(available)) throw new Error("Stripe balance exceeds integer precision");
      }
    }

    let recipient: LiveReadinessSummary["recipient"] = null;
    if (recipientId) {
      const account = await this.get(`/accounts/${recipientId}`);
      if (account.id !== recipientId || account.object !== "account") {
        throw new Error("Connected account identity mismatch");
      }
      const capability = (account.capabilities as Record<string, unknown> | undefined)?.transfers;
      const country = typeof account.country === "string" ? account.country : "unknown";
      const payoutsEnabled = account.payouts_enabled === true;
      recipient = {
        accountId: recipientId, country,
        transfersCapability: typeof capability === "string" ? capability : "unknown",
        payoutsEnabled,
        transfersAndPayoutsAppearEnabled: country === "US" && capability === "active" && payoutsEnabled &&
          account.details_submitted === true && account.deleted !== true,
      };
    }

    let topup: LiveReadinessSummary["topup"] = null;
    if (topupId) {
      const entry = await this.get(`/topups/${topupId}`);
      if (entry.object !== "topup" || entry.id !== topupId || entry.livemode !== this.live ||
          entry.status !== "succeeded" || entry.currency !== "usd" ||
          !Number.isSafeInteger(entry.amount) || (entry.amount as number) <= 0 ||
          typeof entry.balance_transaction !== "string" || !TRANSACTION.test(entry.balance_transaction)) {
        throw new Error(`Top-up is not a verified succeeded ${this.live ? "LIVE" : "TEST"} USD receipt`);
      }
      topup = {
        id: topupId, amountCents: entry.amount as number, currency: "usd",
        balanceTransactionId: entry.balance_transaction, status: "succeeded",
      };
    }
    return {
      platformAccountId: this.expectedAccount!, country: "US", transfersCapability: this.live ? "active" : "sandbox_not_required",
      usdAvailableCents: available, recipient, topup, safeToExecuteTransfer: false,
      note: this.live ? "READ ONLY. No project allocation, recipient consent, tax review, balance reservation, or LIVE transfer is authorized by this result." : "TEST ONLY. Sandbox payer capability and KYC are not evidence of LIVE readiness.",
    };
  }

  /** Additional receipt evidence for a frozen pilot approval; not a transfer preflight. */
  async inspectPilot(recipientId: string, topupId: string): Promise<LivePilotEvidence> {
    const summary = await this.inspect(recipientId, topupId);
    const receipt = summary.topup;
    if (!receipt || !summary.recipient?.transfersAndPayoutsAppearEnabled) {
      throw new Error("Pilot requires a succeeded receipt and eligible recipient");
    }
    const entry = await this.get(`/balance_transactions/${receipt.balanceTransactionId}`);
    if (entry.object !== "balance_transaction" || entry.id !== receipt.balanceTransactionId ||
        entry.source !== receipt.id || entry.type !== "topup" || entry.currency !== "usd" ||
        entry.status !== "available" || entry.amount !== receipt.amountCents ||
        !Number.isSafeInteger(entry.net) || (entry.net as number) <= 0 ||
        (entry.net as number) > receipt.amountCents) {
      throw new Error("Top-up balance transaction is not matching, available USD funding evidence");
    }
    return { ...summary, receiptNetCents: entry.net as number };
  }

}

/** Public LIVE entry point retains the restricted LIVE key and all readiness requirements. */
export class StripeLiveReadiness extends StripePilotReadiness {
  constructor(key = process.env.OPENPAYABLES_STRIPE_LIVE_READ_KEY, expectedAccount = process.env.OPENPAYABLES_LIVE_EXPECTED_PLATFORM_ACCOUNT_ID, confirmation = process.env.OPENPAYABLES_LIVE_READ_ONLY_CONFIRM) {
    super(key, expectedAccount, confirmation, true);
  }
}
/** Separate TEST-only path; no LIVE credentials or responses accepted. */
export class StripeSandboxReadiness extends StripePilotReadiness {
  constructor(key: string | undefined, expectedAccount: string, confirmation: string) {
    super(key, expectedAccount, confirmation, false);
  }
}
