import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { StripeLiveReadiness, StripeSandboxReadiness } from "../src/payments/stripe/live-readiness.js";
import { StripeLivePilotTransfer, StripeSandboxPilotTransfer, pilotIdempotencyKey, type PilotTransferInstruction } from "../src/payments/stripe/live-transfer.js";
import { StripeLivePayoutReader, StripeSandboxPayoutReader } from "../src/payments/stripe/live-payout.js";
import { parsePilotEvent, parseSandboxPilotEvent } from "../src/server/live-pilot-events.js";
const i: PilotTransferInstruction = { approvalId:"afc27cd6-2b3e-4c41-b1e7-9220e268cf02",platformAccountId:"acct_testpayer",recipientAccountId:"acct_testrecipient",topupId:"tu_testreceipt",amountCents:500 };
const testKey = "rk_test_" + "synthetic";
const liveKey = "rk_live_" + "synthetic";
const payer = {id:i.platformAccountId,country:"US",capabilities:{},requirements:{disabled_reason:"requirements.pending_verification"}};
const balance = {object:"balance",livemode:false,available:[{currency:"usd",amount:1700}]};
const recipient = {id:i.recipientAccountId,object:"account",country:"US",capabilities:{transfers:"active"},payouts_enabled:true,details_submitted:true};
const topup = {object:"topup",id:i.topupId,livemode:false,status:"succeeded",currency:"usd",amount:500,balance_transaction:"txn_receipt"};
const tx = {object:"balance_transaction",id:"txn_receipt",source:i.topupId,type:"topup",currency:"usd",status:"available",amount:500,net:500};
const v2 = {id:i.recipientAccountId,object:"v2.core.account",configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:"active"}}}}}};
const transfer = {id:"tr_demo",object:"transfer",livemode:false,currency:"usd",amount:500,destination:i.recipientAccountId,destination_payment:"py_demo",transfer_group:pilotIdempotencyKey(i.approvalId),metadata:{openpayables_approval_id:i.approvalId},amount_reversed:0,reversed:false};
function mock(...values: unknown[]) {const f=vi.fn();for(const value of values) f.mockResolvedValueOnce(new Response(JSON.stringify(value),{status:200}));vi.stubGlobal("fetch",f);return f;}
afterEach(()=>vi.unstubAllGlobals());
describe("Sandbox pilot provider isolation (mocked HTTP)",()=>{
  it("refuses LIVE keys in sandbox and TEST keys in LIVE entry points",()=>{
    const f=mock();
    expect(()=>new StripeSandboxReadiness(liveKey,i.platformAccountId,"YES_SANDBOX_ONLY")).toThrow();
    expect(()=>new StripeSandboxPilotTransfer(liveKey,i.platformAccountId,true)).toThrow();
    expect(()=>new StripeSandboxPayoutReader(liveKey,i.platformAccountId)).toThrow();
    expect(()=>new StripeLiveReadiness(testKey,i.platformAccountId,"YES_READ_ONLY")).toThrow();
    expect(()=>new StripeLivePilotTransfer(testKey,i.platformAccountId,true)).toThrow();
    expect(()=>new StripeLivePayoutReader(testKey,i.platformAccountId)).toThrow();
    expect(f).not.toHaveBeenCalled();
  });
  it("allows the known sandbox payer exception only with exact TEST balance and receipt",async()=>{
    mock(payer,balance,recipient,topup,tx);
    const r=new StripeSandboxReadiness(testKey,i.platformAccountId,"YES_SANDBOX_ONLY");
    expect(await r.inspectPilot(i.recipientAccountId,i.topupId)).toMatchObject({transfersCapability:"sandbox_not_required",receiptNetCents:500,safeToExecuteTransfer:false});
    mock(payer,{...balance,livemode:true});await expect(r.inspect()).rejects.toThrow(/TEST available/);
    mock({...payer,id:"acct_wrong"});await expect(r.inspect()).rejects.toThrow(/Wrong TEST platform/);
    mock(payer);await expect(new StripeLiveReadiness(liveKey,i.platformAccountId,"YES_READ_ONLY").inspect()).rejects.toThrow(/Wrong LIVE platform/);
  });
  it("uses the same one-shot transfer path and checks mode before and after POST",async()=>{
    const p=new StripeSandboxPilotTransfer(testKey,i.platformAccountId,true);
    const f=mock(payer,balance,recipient,topup,tx,v2,transfer);
    await p.preflight(i);expect(await p.sendOnce(i)).toEqual({transferId:"tr_demo",amountReversedCents:0});
    expect(f.mock.calls.filter(c=>c[1].method==="POST")).toHaveLength(1);
    expect(f.mock.calls[6]![1].headers["Idempotency-Key"]).toBe(pilotIdempotencyKey(i.approvalId));
    await expect(p.sendOnce(i)).rejects.toThrow(/fresh preflight/);
    mock(payer,balance,recipient,topup,tx,v2,{...transfer,livemode:true});
    await p.preflight(i);await expect(p.sendOnce(i)).rejects.toThrow(/mismatched/);
  });
  it("traces actual-shape TEST payout membership without inferring bank receipt",async()=>{
    const payout={object:"payout",id:"po_demo",livemode:false,automatic:true,method:"standard",type:"bank_account",currency:"usd",amount:500,status:"paid",reconciliation_status:"completed"};
    const list={object:"list",has_more:false,data:[{...tx,id:"txn_debit",source:"po_demo",amount:-500,net:-500,type:"payout",fee:0},{...tx,id:"txn_payment",source:"py_demo",type:"payment",fee:0}]};
    const f=mock(payer,balance,transfer,payout,list);
    const p=new StripeSandboxPayoutReader(testKey,i.platformAccountId);
    expect((await p.inspect(i,"tr_demo","po_demo")).trace).toMatchObject({status:"paid",balanceTransactionId:"txn_payment",netCents:500});
    expect(new URL(f.mock.calls[4]![0]).searchParams.has("source")).toBe(false);
    mock(payer,balance,transfer,{...payout,livemode:true});await expect(p.inspect(i,"tr_demo","po_demo")).rejects.toThrow(/Wrong recipient/);
  });
  it("authenticates TEST events without accepting them in LIVE routing",()=>{
    const now=1234567890;const secret="whsec_"+"synthetic";
    const event={object:"event",id:"evt_demo",livemode:false,type:"transfer.created",data:{object:transfer}};
    const raw=Buffer.from(JSON.stringify(event));const sig=`t=${now},v1=${createHmac("sha256",secret).update(`${now}.`).update(raw).digest("hex")}`;
    expect(parseSandboxPilotEvent(raw,sig,secret,"platform",now)).toMatchObject({kind:"transfer",approvalId:i.approvalId});
    expect(()=>parsePilotEvent(raw,sig,secret,"platform",now)).toThrow(/LIVE snapshot/);
    expect(()=>parseSandboxPilotEvent(raw,sig,secret,"connected",now)).toThrow(/Connected account/);
    expect(()=>parseSandboxPilotEvent(raw,sig,"whsec_wrong","platform",now)).toThrow(/signature/);
  });
});
