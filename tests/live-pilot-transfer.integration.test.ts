import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { migrate } from "../src/storage/postgres/migrate.js";
import { OpenPayablesStore } from "../src/storage/postgres/repository.js";
import { LivePilotLedger } from "../src/storage/postgres/live-pilot.js";
import { LivePilotTransferLedger } from "../src/storage/postgres/live-pilot-transfer.js";
import type { LivePilotEvidence } from "../src/payments/stripe/live-readiness.js";

const url = process.env.OPENPAYABLES_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("One-shot pilot transfer (synthetic evidence only)", () => {
  const pool = new Pool({ connectionString: url });
  const credits = new OpenPayablesStore(pool);
  const ledger = new LivePilotLedger(pool, "pilot_test");
  const suffix = randomUUID().replace(/-/g, "");
  const projectId = `pilot-${suffix}`;
  const contributorId = `contributor-${suffix}`;
  const recipientId = `acct_recipient${suffix}`;
  const topupId = `tu_${suffix}`;
  const platformAccountId = `acct_platform${suffix}`;
  const input = { projectId, contributorId, recipientId, topupId, amountCents: 500, authorizationReference: "synthetic-approval" };
  const evidence: LivePilotEvidence = {
    platformAccountId, country: "US", transfersCapability: "active", usdAvailableCents: 1000,
    receiptNetCents: 900, safeToExecuteTransfer: false, note: "synthetic only",
    recipient: { accountId: recipientId, country: "US", transfersCapability: "active", payoutsEnabled: true, transfersAndPayoutsAppearEnabled: true },
    topup: { id: topupId, currency: "usd", amountCents: 1000, balanceTransactionId: `txn_${suffix}`, status: "succeeded" },
  };
  const provider = { inspectPilot: vi.fn(async () => evidence) };
  const transfers = new LivePilotTransferLedger(pool, "pilot_test");
  let approvalId: string;
  const transferId = `tr_${suffix}`;
  const fake = { mode: "pilot_test" as const, preflight: vi.fn(async () => evidence), sendOnce: vi.fn(async () => { throw new Error("simulated lost response"); }),
    retrieve: vi.fn(async () => ({ transferId, amountReversedCents: 0 })) };
  const execution = () => ({ approvalId, recipientAccountId: recipientId, amountCents:500, executionReference:"synthetic-execution" });
  beforeAll(async () => {
    // Do not migrate or write to any database except the dedicated local test database.
    const result = await pool.query("SELECT current_database() AS db");
    if (result.rows[0].db !== "openpayables_test") throw new Error("Dedicated openpayables_test required");
    await migrate(pool);
    await credits.createProject(projectId, "Synthetic pilot", "operator");
    await credits.createContributor(contributorId, "Synthetic contributor");
    await credits.joinProject(projectId, contributorId);
    await credits.award({projectId, contributorId, category:"development", size:"large", source:"github", sourceId:suffix, role:"author", reason:"Synthetic fixture", approvedBy:"operator"});
    approvalId = (await ledger.approve(input, provider)).id;
  });
  afterAll(async () => { await pool.end(); });

  it("blocks LIVE access to TEST records, amount changes, stale funding, and early reconciliation", async () => {
    await expect(new LivePilotTransferLedger(pool).execute(execution(),fake)).rejects.toThrow(/Dedicated pilot database/);
    await expect(transfers.execute(execution(),{...fake,mode:"live"})).rejects.toThrow(/provider mode mismatch/);
    await expect(transfers.execute({...execution(),amountCents:499},fake)).rejects.toThrow(/Exact approved/);
    await expect(transfers.execute({...execution(),executionReference:input.authorizationReference},fake)).rejects.toThrow(/separate execution/);
    await expect(transfers.execute(execution(),{...fake,preflight:async()=>({...evidence,usdAvailableCents:499})})).rejects.toThrow(/Fresh LIVE funding/);
    await expect(transfers.execute(execution(),{...fake,preflight:async()=>({...evidence,receiptNetCents:901})})).rejects.toThrow(/Fresh LIVE funding/);
    await expect(transfers.reconcile(approvalId,transferId,fake)).rejects.toThrow(/No durable attempt/);
    expect(fake.sendOnce).not.toHaveBeenCalled();
    expect((await transfers.status(approvalId)).state).toBe("approved_not_attempted");
  });
  it("commits one attempt before POST, including under concurrency and lost response; never retries", async () => {
    const sendOnce = vi.fn(async()=> {
      expect((await transfers.status(approvalId)).state).toBe("outcome_unknown_no_retry");
      throw new Error("simulated lost response after external execution");
    });
    const lost={...fake,sendOnce};
    const results=await Promise.allSettled([transfers.execute(execution(),lost),transfers.execute(execution(),lost)]);
    expect(results.every(r=>r.status==="rejected")).toBe(true);
    expect(sendOnce).toHaveBeenCalledTimes(1);
    expect((await transfers.status(approvalId)).state).toBe("outcome_unknown_no_retry");
    await expect(transfers.execute(execution(),lost)).rejects.toThrow(/never resend/);
    expect(sendOnce).toHaveBeenCalledTimes(1);
    await expect(pool.query("DELETE FROM openpayables.live_pilot_attempts WHERE approval_id=$1",[approvalId])).rejects.toThrow(/immutable/);
  });
  it("recovers exact transfer through read-only evidence, persists reversal and cannot erase it with stale evidence", async () => {
    await expect(transfers.reconcile(approvalId,"tr_wrong",fake)).rejects.toThrow(/Transfer ID mismatch/);
    expect((await transfers.reconcile(approvalId,transferId,fake)).state).toBe("transfer_observed");
    const reversed={...fake,retrieve:async()=>({transferId,amountReversedCents:500})};
    expect((await transfers.reconcile(approvalId,transferId,reversed)).state).toBe("transfer_reversal_observed");
    expect(await transfers.reconcile(approvalId,transferId,fake)).toMatchObject({state:"transfer_reversal_observed",bankPayoutVerified:false});
    const conflict={...fake,retrieve:async()=>({transferId:"tr_conflict",amountReversedCents:0})};
    await expect(transfers.reconcile(approvalId,"tr_conflict",conflict)).rejects.toThrow(/Conflicting transfer IDs/);
    await expect(pool.query("UPDATE openpayables.live_pilot_transfer_observations SET amount_reversed_cents=1 WHERE approval_id=$1",[approvalId])).rejects.toThrow(/immutable/);
  });
  it("records successful transfer once, without claiming a bank payout", async () => {
    const otherProject = `success-${suffix}`;
    const otherPayer = `acct_success${suffix}`;
    await credits.createProject(otherProject,"Synthetic success","operator");
    await credits.joinProject(otherProject,contributorId);
    await credits.award({projectId:otherProject,contributorId,category:"development",size:"large",source:"github",sourceId:suffix,role:"author",reason:"Synthetic success",approvedBy:"operator"});
    const otherTopup=`tu_success${suffix}`;
    const otherEvidence={...evidence,platformAccountId:otherPayer,topup:{...evidence.topup!,id:otherTopup,balanceTransactionId:`txn_success${suffix}`}};
    const approval=await ledger.approve({...input,projectId:otherProject,topupId:otherTopup},{inspectPilot:async()=>otherEvidence});
    const success={...fake,preflight:async()=>otherEvidence,sendOnce:vi.fn(async()=>({transferId:`tr_success${suffix}`,amountReversedCents:0}))};
    const request={...execution(),approvalId:approval.id};
    expect(await transfers.execute(request,success)).toMatchObject({state:"transfer_observed",bankPayoutVerified:false});
    await expect(transfers.execute(request,success)).rejects.toThrow(/never resend/);
    expect(success.sendOnce).toHaveBeenCalledTimes(1);
  });
});
