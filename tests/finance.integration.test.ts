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
    await money.prepareObligation(obligation.id, correct);
    correct.platformAccountId = async () => "acct_different";
    await expect(money.submitObligation(obligation.id, correct)).rejects.toThrow(/does not match/);
    expect(correct.sends).toBe(0);
    const noAttempts = await pool.query(
      "SELECT COUNT(*)::INT AS n FROM openpayables.payment_attempts WHERE obligation_id=$1", [obligation.id]);
    expect(noAttempts.rows[0].n).toBe(0);
    expect((await money.getObligation(obligation.id)).status).toBe("ready");
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
    await money.prepareObligation(secondObligation.id, sender);
    sender.platformAccountId = async () => platformId;
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
