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
      topupId, platformAccountId: "acct_platformtest", balanceTransactionId: "txn_123abc",
      amountCents: 1000, currency: "usd" as const,
    });
    const provider = { verifyTestTopup: verify };
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
    await money.approvePeriod(period.id, "operator");
    expect(await money.fundingStatus(verifiedProject)).toMatchObject({ remainingCents: 200, reservedCents: 800 });
    const excess = await money.createPeriod(verifiedProject, `excess-period-${suffix}`, 300, "operator");
    await expect(money.approvePeriod(excess.id, "operator")).rejects.toThrow(/Insufficient/);
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
