import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/postgres/migrate.js";
import { OpenPayablesStore } from "../src/storage/postgres/repository.js";
import { OpenPayablesFinance } from "../src/storage/postgres/finance.js";
import type { PaymentProvider, ProviderTransfer, TransferInstruction } from "../src/payments/provider.js";

class FakeStripeTest implements PaymentProvider {
  readonly transfers = new Map<string, ProviderTransfer>();
  sends = 0;
  availableCents = 10000;
  throwAfterTransfer = false;
  async availableBalanceCents() { return this.availableCents; }
  async platformAccountId() { return "acct_platformtest"; }
  inspectTestTopup?: (id: string) => Promise<{
    topupId: string; platformAccountId: string; status: "succeeded" | "reversed";
    amountCents: number; currency: string; balanceTransactionId: string;
  }>;
  async accountReady(id: string) { return id.startsWith("acct_"); }
  async createTransfer(x: TransferInstruction): Promise<ProviderTransfer> {
    this.sends++;
    const transfer: ProviderTransfer = {
      id: `tr_${randomUUID().replace(/-/g, "")}`, amount: x.amountCents,
      currency: "usd", destination: x.destination, amount_reversed: 0,
      metadata: { obligation_id: x.obligationId, period_id: x.periodId, project_id: x.projectId },
    };
    this.transfers.set(x.obligationId, transfer);
    if (this.throwAfterTransfer) throw new Error("Simulated timeout after Stripe accepted transfer");
    return transfer;
  }
  async retrieveTransfer(id: string) {
    const result = [...this.transfers.values()].find((x) => x.id === id);
    if (!result) throw new Error("Unknown transfer");
    return result;
  }
  async findTransferByObligation(id: string) { return this.transfers.get(id) ?? null; }
}

const url = process.env.OPENPAYABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("Checkpoint B PostgreSQL integration (DEDICATED test DB)", () => {
  const pool = new Pool({ connectionString: url });
  const credits = new OpenPayablesStore(pool);
  const money = new OpenPayablesFinance(pool);
  const suffix = randomUUID().slice(0, 8);
  const project = `fund-${suffix}`;
  const a = `a-${suffix}`;
  const b = `b-${suffix}`;
  let periodId = "";
  let aliceObligation = "";
  let bobObligation = "";

  beforeAll(async () => {
    await migrate(pool);
    await credits.createProject(project, "Funded integration", "operator");
    await credits.createContributor(a, "Alice");
    await credits.createContributor(b, "Bob");
    await credits.joinProject(project, a);
    await credits.joinProject(project, b);
    await credits.award({projectId:project,contributorId:a,category:"development",size:"large",source:"github",sourceId:suffix,role:"author",reason:"Accepted",approvedBy:"operator"});
    await credits.award({projectId:project,contributorId:b,category:"review",size:"medium",source:"github",sourceId:suffix,role:"reviewer",reason:"Accepted",approvedBy:"operator"});
  });
  afterAll(async () => { await pool.end(); });

  it("allocates an attested $11 pool exactly and prevents over-reservation", async () => {
    await money.addFunding(project, 1100, `attested-test-${suffix}`, "operator");
    await expect(money.addFunding(project, 1100, `attested-test-${suffix}`, "operator")).rejects.toThrow();
    const period = await money.createPeriod(project, `period-${suffix}`, 1100, "operator");
    periodId = period.id;
    const approved = await money.approvePeriod(periodId, "operator");
    expect(approved.allocations.map((x) => x.amountCents)).toEqual([800, 300]);
    const info = await money.showPeriod(periodId);
    expect(info.obligations).toHaveLength(2);
    aliceObligation = info.obligations.find((x) => x.contributorId === a)!.id;
    bobObligation = info.obligations.find((x) => x.contributorId === b)!.id;
    expect(info.obligations.every((x) => x.status === "held")).toBe(true);
    expect(await money.fundingStatus(project)).toMatchObject({ remainingCents: 0, reservedCents: 1100 });
    await expect(money.approvePeriod(periodId, "operator")).rejects.toThrow(/already approved/);
    const extra = await money.createPeriod(project, `overcommit-${suffix}`, 1, "operator");
    await expect(money.approvePeriod(extra.id, "operator")).rejects.toThrow(/Insufficient/);
  });

  it("holds unconfigured payees, blocks an unfunded attempt, sends once and never blindly retries", async () => {
    const provider = new FakeStripeTest();
    await expect(money.prepareObligation(aliceObligation, provider)).rejects.toThrow(/no bound Stripe TEST platform/);
    await money.bindTestPlatform(project, provider, "operator");
    await expect(money.prepareObligation(aliceObligation, provider)).rejects.toThrow(/no Stripe/);
    await money.setDestination(project, a, "acct_alice123", "operator");
    expect((await money.prepareObligation(aliceObligation, provider)).status).toBe("ready");
    provider.availableCents = 799;
    await expect(money.submitObligation(aliceObligation, provider)).rejects.toThrow(/Insufficient available/);
    expect((await money.getObligation(aliceObligation)).status).toBe("ready");
    const noAttempts = await pool.query("SELECT COUNT(*)::INT AS n FROM openpayables.payment_attempts WHERE obligation_id=$1", [aliceObligation]);
    expect(noAttempts.rows[0].n).toBe(0);
    expect(provider.sends).toBe(0);
    provider.availableCents = 800;
    expect((await money.submitObligation(aliceObligation, provider)).status).toBe("transferred");
    expect(provider.sends).toBe(1);
    await expect(money.submitObligation(aliceObligation, provider)).rejects.toThrow(/Not sendable/);
    expect(provider.sends).toBe(1);
    expect((await money.getObligation(bobObligation)).status).toBe("held");
  });

  it("binds Stripe TEST funding to exactly one project and prevents mixing or overspending", async () => {
    // Give each integration run its own fake Stripe platform; test DB history persists.
    const platformId = `acct_verified${suffix.replace(/-/g, "")}`;
    const verifiedProject = `verified-${suffix}`;
    const competingProject = `competing-${suffix}`;
    await credits.createProject(verifiedProject, "Verified provider receipt project", "operator");
    await credits.createProject(competingProject, "Other project", "operator");
    await credits.joinProject(verifiedProject, a);
    await credits.joinProject(competingProject, a);
    await credits.award({ projectId: verifiedProject, contributorId: a, category: "development",
      size: "large", source: "github", sourceId: suffix, role: "author",
      reason: "Accepted", approvedBy: "operator" });
    const topupId = `tu_${suffix.replace(/-/g, "")}`;
    const verify = async () => ({
      topupId, platformAccountId: platformId, balanceTransactionId: "txn_123abc",
      amountCents: 1000, currency: "usd" as const,
    });
    const provider = {
      verifyTestTopup: verify,
      platformAccountId: async () => platformId,
      inspectTestTopup: async () => ({
        topupId, platformAccountId: platformId, status: "succeeded" as const,
        amountCents: 1000, currency: "usd", balanceTransactionId: "txn_123abc",
      }),
    };
    const imported = await money.importTestTopup(verifiedProject, topupId, provider, "operator");
    expect(imported.evidence_kind).toBe("stripe_test_topup");
    expect(imported.stripe_topup_id).toBe(topupId);
    expect((await money.boundTestPlatform(verifiedProject))?.stripe_platform_account_id).toBe(platformId);
    expect(await money.fundingStatus(verifiedProject)).toMatchObject({
      verifiedTestCents: 1000, attestedCents: 0, remainingCents: 1000,
    });
    await expect(money.importTestTopup(verifiedProject, topupId, provider, "operator"))
      .rejects.toThrow(/already attributed/);
    await expect(money.importTestTopup(competingProject, topupId, provider, "operator"))
      .rejects.toThrow(/already attributed/);
    await expect(money.addFunding(verifiedProject, 300, `attest-${suffix}`, "operator"))
      .rejects.toThrow(/Cannot mix/);
    await expect(money.importTestTopup(project, topupId, provider, "operator"))
      .rejects.toThrow(/Cannot mix/);
    const period = await money.createPeriod(verifiedProject, `verified-period-${suffix}`, 800, "operator");
    await money.approvePeriod(period.id, "operator", provider);
    expect(await money.fundingStatus(verifiedProject)).toMatchObject({ remainingCents: 200, reservedCents: 800 });
    const excess = await money.createPeriod(verifiedProject, `excess-period-${suffix}`, 300, "operator");
    await expect(money.approvePeriod(excess.id, "operator", provider)).rejects.toThrow(/Insufficient/);
    const obligation = (await money.showPeriod(period.id)).obligations[0]!;
    await money.setDestination(verifiedProject, a, "acct_verifiedalice", "operator");
    const correct = new FakeStripeTest();
    correct.platformAccountId = async () => platformId;
    await money.prepareObligation(obligation.id, correct);
    correct.platformAccountId = async () => "acct_different";
    await expect(money.submitObligation(obligation.id, correct)).rejects.toThrow(/do not match/);
    expect(correct.sends).toBe(0);
    const noAttempts = await pool.query(
      "SELECT COUNT(*)::INT AS n FROM openpayables.payment_attempts WHERE obligation_id=$1", [obligation.id]);
    expect(noAttempts.rows[0].n).toBe(0);
    expect((await money.getObligation(obligation.id)).status).toBe("ready");
  });

  it("binds an attested TEST project to its operator's Stripe account and refuses another account", async () => {
    const isolatedProject = `operator-scope-${suffix}`;
    await credits.createProject(isolatedProject, "Owner-scoped operator test", "operator");
    await credits.joinProject(isolatedProject, a);
    await credits.award({ projectId: isolatedProject, contributorId: a, category: "development",
      size: "large", source: "github", sourceId: suffix, role: "author",
      reason: "Accepted", approvedBy: "operator" });
    await money.addFunding(isolatedProject, 500, `owner-test-${suffix}`, "operator");
    const period = await money.createPeriod(isolatedProject, `owner-period-${suffix}`, 500, "operator");
    await money.approvePeriod(period.id, "operator");
    const obligation = (await money.showPeriod(period.id)).obligations[0]!;
    await money.setDestination(isolatedProject, a, "acct_ownedrecipient", "operator");
    const correct = new FakeStripeTest();
    const ownerAccount = `acct_owner${suffix.replace(/-/g, "")}`;
    correct.platformAccountId = async () => ownerAccount;
    const different = new FakeStripeTest();
    different.platformAccountId = async () => `acct_unrelated${suffix.replace(/-/g, "")}`;
    await expect(money.prepareObligation(obligation.id, correct)).rejects.toThrow(/no bound Stripe TEST platform/);
    const binding = await money.bindTestPlatform(isolatedProject, correct, "operator");
    expect(binding.stripe_platform_account_id).toBe(ownerAccount);
    expect((await money.boundTestPlatform(isolatedProject))?.stripe_platform_account_id).toBe(ownerAccount);
    expect((await money.bindTestPlatform(isolatedProject, correct, "operator")).stripe_platform_account_id).toBe(ownerAccount);
    await expect(money.bindTestPlatform(isolatedProject, different, "operator")).rejects.toThrow(/rebinding refused/);
    await expect(money.prepareObligation(obligation.id, different)).rejects.toThrow(/do not match/);
    expect((await money.prepareObligation(obligation.id, correct)).status).toBe("ready");
    await expect(money.submitObligation(obligation.id, different)).rejects.toThrow(/do not match/);
    const attempts = await pool.query(
      "SELECT COUNT(*)::INT AS n FROM openpayables.payment_attempts WHERE obligation_id=$1", [obligation.id]);
    expect(attempts.rows[0].n).toBe(0);
    expect(different.sends).toBe(0);
    expect((await money.getObligation(obligation.id)).status).toBe("ready");
    expect((await money.submitObligation(obligation.id, correct)).status).toBe("transferred");
    await expect(money.reconcileObligation(obligation.id, different)).rejects.toThrow(/do not match/);
    expect((await money.reconcileObligation(obligation.id, correct)).status).toBe("transferred");
    expect(correct.sends).toBe(1);
  });

  it("holds reversed TEST receipts and blocks a platform shortfall without payment attempts", async () => {
    // Isolate this case from other test receipts, including prior test runs.
    const platformId = `acct_c3${suffix.replace(/-/g, "")}`;
    const first = `c3-first-${suffix}`;
    const second = `c3-second-${suffix}`;
    const third = `c3-third-${suffix}`;
    for (const name of [first, second, third]) {
      await credits.createProject(name, name, "operator");
      await credits.joinProject(name, a);
      await credits.award({ projectId: name, contributorId: a, category: "development",
        size: "large", source: "github", sourceId: suffix, role: "author",
        reason: "Accepted", approvedBy: "operator" });
    }
    const receipts = new Map<string, {
      topupId: string; platformAccountId: string; status: "succeeded" | "reversed";
      amountCents: number; currency: string; balanceTransactionId: string;
    }>();
    for (const [i, cents] of [500, 500, 1000].entries()) {
      const id = `tu_c3${i}${suffix.replace(/-/g, "")}`;
      receipts.set(id, { topupId: id, platformAccountId: platformId,
        status: "succeeded", amountCents: cents, currency: "usd", balanceTransactionId: `txn_c3${i}${suffix}` });
    }
    const provider = {
      platformAccountId: async () => platformId,
      verifyTestTopup: async (id: string) => {
        const receipt = receipts.get(id)!;
        return { topupId: id, platformAccountId: receipt.platformAccountId,
          balanceTransactionId: receipt.balanceTransactionId, amountCents: receipt.amountCents, currency: "usd" as const };
      },
      inspectTestTopup: async (id: string) => receipts.get(id)!,
    };
    const [id1, id2, id3] = [...receipts.keys()];
    await money.importTestTopup(first, id1!, provider, "operator");
    await money.importTestTopup(second, id2!, provider, "operator");
    const firstPeriod = await money.createPeriod(first, `c3-first-period-${suffix}`, 500, "operator");
    await money.approvePeriod(firstPeriod.id, "operator", provider);
    const secondPeriod = await money.createPeriod(second, `c3-second-period-${suffix}`, 500, "operator");
    await money.approvePeriod(secondPeriod.id, "operator", provider);

    // Stripe subsequently reverses the previously succeeded FIRST receipt.
    receipts.get(id1!)!.status = "reversed";
    const check = await money.recheckProjectTestFunding(second, provider, "operator");
    expect(check).toMatchObject({ checked: 2, newlyObservedProblems: 1, blockedReceipts: 1 });
    expect(await money.fundingStatus(first)).toMatchObject({
      verifiedTestCents: 500, blockedVerifiedCents: 500, reservedCents: 500, remainingCents: -500,
    });
    const duplicateCheck = await money.recheckProjectTestFunding(second, provider, "operator");
    expect(duplicateCheck).toMatchObject({ newlyObservedProblems: 0, blockedReceipts: 1 });
    const audit = await pool.query(
      `SELECT COUNT(*)::INT AS n FROM openpayables.funding_receipt_alerts WHERE project_id=$1`, [first]);
    expect(audit.rows[0].n).toBe(1);

    // The unspent third receipt does not allow a platform-wide overcommit.
    await money.importTestTopup(third, id3!, provider, "operator");
    const thirdPeriod = await money.createPeriod(third, `c3-third-period-${suffix}`, 600, "operator");
    await expect(money.approvePeriod(thirdPeriod.id, "operator", provider))
      .rejects.toThrow(/Insufficient uncommitted verified TEST funds across Stripe platform/);
    const secondObligation = (await money.showPeriod(secondPeriod.id)).obligations[0]!;
    await money.setDestination(second, a, "acct_c3recipient", "operator");
    const sender = new FakeStripeTest();
    sender.platformAccountId = async () => platformId;
    await money.prepareObligation(secondObligation.id, sender);
    sender.inspectTestTopup = provider.inspectTestTopup;
    sender.availableCents = 400; // platform has at least 500 cents outstanding
    await expect(money.submitObligation(secondObligation.id, sender))
      .rejects.toThrow(/Insufficient available Stripe TEST platform funds/);
    expect(sender.sends).toBe(0);
    expect((await money.getObligation(secondObligation.id)).status).toBe("ready");
    const attempts = await pool.query(
      "SELECT COUNT(*)::INT AS n FROM openpayables.payment_attempts WHERE obligation_id=$1", [secondObligation.id]);
    expect(attempts.rows[0].n).toBe(0);
  });

  it("audits TEST connected-account payout status without settling individual obligations", async () => {
    const payoutProject = `payout-observer-${suffix}`;
    const account = `acct_recipient${suffix.replace(/-/g, "")}`;
    const platform = `acct_payoutowner${suffix.replace(/-/g, "")}`;
    await credits.createProject(payoutProject, "Read-only payout observer test", "operator");
    await credits.joinProject(payoutProject, a);
    await credits.award({ projectId: payoutProject, contributorId: a, category: "development",
      size: "large", source: "github", sourceId: suffix, role: "author",
      reason: "Accepted", approvedBy: "operator" });
    await money.addFunding(payoutProject, 100, `payout-observe-${suffix}`, "operator");
    const period = await money.createPeriod(payoutProject, `payout-observe-${suffix}`, 100, "operator");
    await money.approvePeriod(period.id, "operator");
    const obligationId = (await money.showPeriod(period.id)).obligations[0]!.id;
    const providerIdentity = new FakeStripeTest();
    providerIdentity.platformAccountId = async () => platform;
    await money.bindTestPlatform(payoutProject, providerIdentity, "operator");
    await money.setDestination(payoutProject, a, account, "operator");
    const payout = {
      id: `po_${suffix.replace(/-/g, "")}`, amount: 800, currency: "usd", livemode: false as const,
      status: "pending" as "pending" | "paid" | "failed", destination: "ba_testdestination",
      created: 1770000000, arrival_date: 1770172800, failure_code: null as string | null,
    };
    let lookups = 0;
    const provider = {
      platformAccountId: async () => platform,
      listConnectedPayouts: async (id: string) => {
        expect(id).toBe(account);
        lookups++;
        return [{ ...payout }];
      },
    };
    const mismatch = {
      ...provider, platformAccountId: async () => `acct_notowner${suffix.replace(/-/g, "")}`,
    };
    await expect(money.syncConnectedPayouts(payoutProject, a, mismatch, "operator"))
      .rejects.toThrow(/do not match/);
    expect(lookups).toBe(0);
    expect(await money.syncConnectedPayouts(payoutProject, a, provider, "operator"))
      .toMatchObject({ observedPayouts: 1, newPayouts: 1, newObservations: 1, individualObligationsSettled: 0 });
    expect(await money.syncConnectedPayouts(payoutProject, a, provider, "operator"))
      .toMatchObject({ newPayouts: 0, newObservations: 0 });
    payout.status = "paid";
    expect(await money.syncConnectedPayouts(payoutProject, a, provider, "operator"))
      .toMatchObject({ newObservations: 1, individualObligationsSettled: 0 });
    // 'paid' is a Stripe account-level bank payout, NOT proof about this obligation.
    expect((await money.getObligation(obligationId)).status).toBe("held");
    payout.status = "failed";
    payout.failure_code = "account_closed";
    await money.syncConnectedPayouts(payoutProject, a, provider, "operator");
    const history = await money.connectedPayoutHistory(payoutProject, a);
    expect(history.payouts).toMatchObject([{ current_status: "failed", amount_cents: 800 }]);
    expect(history.events.map((x) => x.status)).toEqual(["pending", "paid", "failed"]);
    payout.status = "pending";
    await expect(money.syncConnectedPayouts(payoutProject, a, provider, "operator"))
      .rejects.toThrow(/status regressed/);
    payout.status = "failed";
    payout.amount = 900;
    await expect(money.syncConnectedPayouts(payoutProject, a, provider, "operator"))
      .rejects.toThrow(/identity or amount changed/);
    expect((await money.connectedPayoutHistory(payoutProject, a)).events).toHaveLength(3);
    expect((await money.getObligation(obligationId)).status).toBe("held");
  });

  it("traces a TEST transfer into a completed automatic payout without changing settlement state", async () => {
    const obligation = await money.getObligation(aliceObligation);
    expect(obligation.status).toBe("transferred");
    const destination = obligation.connectedAccountId!;
    const transfer = {
      id: obligation.transferId!, amount: obligation.amountCents, currency: "usd",
      destination, livemode: false, destination_payment: "py_known123",
      amount_reversed: 0, metadata: {
        obligation_id: obligation.id, project_id: obligation.projectId, period_id: obligation.periodId,
      },
    };
    let payoutQueries = 0;
    const provider = {
      platformAccountId: async () => "acct_platformtest",
      retrieveTransfer: async () => transfer,
      inspectPayoutComposition: async (account: string, payout: string, payment: string) => {
        expect(account).toBe(destination);
        expect(payout).toBe("po_automatic123");
        expect(payment).toBe("py_known123");
        payoutQueries++;
        return {
          payoutId: payout, connectedAccountId: account, automatic: true,
          reconciliationStatus: "completed" as const, payoutStatus: "paid" as const,
          amountCents: 800, currency: "usd",
          matchingEntries: [{ id: "txn_match123", amountCents: 800, currency: "usd" }],
        };
      },
    };
    const before = await pool.query("SELECT COUNT(*)::INT AS n FROM openpayables.payment_events WHERE obligation_id=$1", [obligation.id]);
    const traced = await money.traceAutomaticPayoutForObligation(obligation.id, "po_automatic123", provider);
    expect(traced).toMatchObject({
      inclusion: "included_in_automatic_payout", bankPayoutReportedPaid: true,
      individualObligationsSettled: 0, transferId: transfer.id,
    });
    expect(payoutQueries).toBe(1);
    expect((await money.getObligation(obligation.id)).status).toBe("transferred");
    const after = await pool.query("SELECT COUNT(*)::INT AS n FROM openpayables.payment_events WHERE obligation_id=$1", [obligation.id]);
    expect(after.rows[0].n).toBe(before.rows[0].n);

    const manual = { ...provider, inspectPayoutComposition: async (account: string, payout: string) => ({
      payoutId: payout, connectedAccountId: account, automatic: false,
      reconciliationStatus: "not_applicable" as const, payoutStatus: "paid" as const,
      amountCents: 800, currency: "usd", matchingEntries: [],
    }) };
    expect((await money.traceAutomaticPayoutForObligation(obligation.id, "po_manual123", manual)).inclusion)
      .toBe("not_attributable_manual_or_unsupported");
    const mismatch = { ...provider, platformAccountId: async () => "acct_wrong" };
    await expect(money.traceAutomaticPayoutForObligation(obligation.id, "po_automatic123", mismatch))
      .rejects.toThrow(/do not match/);
    const reversed = { ...provider, retrieveTransfer: async () => ({ ...transfer, amount_reversed: 10 }) };
    await expect(money.traceAutomaticPayoutForObligation(obligation.id, "po_automatic123", reversed))
      .rejects.toThrow(/inconsistent/);
    const wrongPayout = { ...provider, inspectPayoutComposition: async () => ({
      payoutId: "po_foranother", connectedAccountId: destination, automatic: true,
      reconciliationStatus: "completed" as const, payoutStatus: "paid" as const,
      amountCents: 800, currency: "usd", matchingEntries: [],
    }) };
    await expect(money.traceAutomaticPayoutForObligation(obligation.id, "po_automatic123", wrongPayout))
      .rejects.toThrow(/inconsistent/);
    await expect(money.traceAutomaticPayoutForObligation(bobObligation, "po_automatic123", provider))
      .rejects.toThrow(/Only a non-reversed transferred/);
  });

  it("reconciles a timeout and deduplicates a signed-provider event", async () => {
    const provider = new FakeStripeTest();
    provider.throwAfterTransfer = true;
    await money.setDestination(project, b, "acct_bob123", "operator");
    await money.prepareObligation(bobObligation, provider);
    expect((await money.submitObligation(bobObligation, provider)).status).toBe("unknown");
    await expect(money.submitObligation(bobObligation, provider)).rejects.toThrow(/Not sendable/);
    expect(provider.sends).toBe(1);
    expect((await money.reconcileObligation(bobObligation, provider)).status).toBe("transferred");
    const transfer = provider.transfers.get(bobObligation)!;
    expect(await money.recordVerifiedStripeEvent(`evt-${suffix}`, "transfer.created", transfer)).toEqual({duplicate:false, updated:true});
    expect(await money.recordVerifiedStripeEvent(`evt-${suffix}`, "transfer.created", transfer)).toEqual({duplicate:true, updated:false});
    transfer.amount_reversed = transfer.amount;
    expect((await money.reconcileObligation(bobObligation, provider)).status).toBe("reversed");
  });
});
