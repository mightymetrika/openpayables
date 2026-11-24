import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { StripeLivePayoutReader } from "../src/payments/stripe/live-payout.js";
import { parsePilotEvent } from "../src/server/live-pilot-events.js";
import { pilotIdempotencyKey, type PilotTransferInstruction } from "../src/payments/stripe/live-transfer.js";
const i: PilotTransferInstruction = { approvalId:"afc27cd6-2b3e-4c41-b1e7-9220e268cf02", platformAccountId:"acct_payer", recipientAccountId:"acct_payee", topupId:"tu_receipt", amountCents:500 };
const transfer = { id:"tr_demo", object:"transfer", livemode:true, currency:"usd", amount:500, destination:i.recipientAccountId, destination_payment:"py_demo",
  transfer_group:pilotIdempotencyKey(i.approvalId), metadata:{openpayables_approval_id:i.approvalId}, amount_reversed:0, reversed:false };
const payout = { id:"po_demo", object:"payout", livemode:true, currency:"usd", automatic:true, method:"standard", type:"bank_account", reconciliation_status:"completed", amount:900, status:"paid", reversed_by:null };
const tx = { id:"txn_demo", object:"balance_transaction", source:"py_demo", currency:"usd", status:"available", type:"payment", amount:500, fee:5, net:495 };
const list = { object:"list", has_more:false, data:[tx] };
function mock(p: unknown=payout, l: unknown=list, t: unknown=transfer, payer: unknown={id:i.platformAccountId}) {
  const f = vi.fn();
  for (const value of [payer,{object:"balance",livemode:true},t,p,l]) f.mockResolvedValueOnce(new Response(JSON.stringify(value),{status:200}));
  vi.stubGlobal("fetch",f); return f;
}
function reader() { return new StripeLivePayoutReader("rk_live_"+"synthetic",i.platformAccountId); }
const now=1234567890;
const secret="whsec_"+"synthetic_platform";
const otherSecret="whsec_"+"synthetic_connected";
const event={id:"evt_demo",object:"event",livemode:true,type:"transfer.created",data:{object:transfer}};
function sign(value: unknown, key=secret, at=now) {
  const raw=Buffer.from(JSON.stringify(value));
  return {raw,header:`t=${at},v1=${createHmac("sha256",key).update(`${at}.`).update(raw).digest("hex")}`};
}
afterEach(()=>vi.unstubAllGlobals());
describe("LIVE payout trace (mocked HTTP)",()=>{
  it("matches exact destination payment membership on the frozen recipient account with GET only",async()=>{
    const f=mock();
    const result=await reader().inspect(i,"tr_demo","po_demo");
    expect(result.trace).toMatchObject({payoutId:"po_demo",balanceTransactionId:"txn_demo",netCents:495,payoutCents:900,status:"paid"});
    expect(f).toHaveBeenCalledTimes(5);
    for(const call of f.mock.calls) expect(call[1].method).toBe("GET");
    expect(f.mock.calls[3]![1].headers["Stripe-Account"]).toBe(i.recipientAccountId);
    const url=new URL(f.mock.calls[4]![0]);
    expect(url.searchParams.get("payout")).toBe("po_demo");
    expect(url.searchParams.get("source")).toBe("py_demo");
  });
  it("does not infer membership from equal amount, incomplete reconciliation, or manual payout",async()=>{
    mock(payout,{...list,data:[]}); expect((await reader().inspect(i,"tr_demo","po_demo")).trace).toBeNull();
    const f=mock({...payout,automatic:false}); expect((await reader().inspect(i,"tr_demo","po_demo")).trace).toBeNull(); expect(f).toHaveBeenCalledTimes(4);
    mock({...payout,reconciliation_status:"in_progress"}); expect((await reader().inspect(i,"tr_demo","po_demo")).trace).toBeNull();
  });
  it("rejects wrong payer, TEST payout, mismatched membership and incomplete pagination",async()=>{
    mock(payout,list,transfer,{id:"acct_wrong"}); await expect(reader().inspect(i,"tr_demo","po_demo")).rejects.toThrow(/Wrong LIVE payer/);
    mock({...payout,livemode:false}); await expect(reader().inspect(i,"tr_demo","po_demo")).rejects.toThrow(/Wrong recipient/);
    mock(payout,{...list,data:[{...tx,source:"py_wrong"}]}); await expect(reader().inspect(i,"tr_demo","po_demo")).rejects.toThrow(/transaction mismatch/);
    mock(payout,{...list,has_more:true}); await expect(reader().inspect(i,"tr_demo","po_demo")).rejects.toThrow(/Incomplete/);
  });
  it("preserves prior exact membership on failure or reversal even if membership is no longer available",async()=>{
    mock(); const known=(await reader().inspect(i,"tr_demo","po_demo")).trace!;
    const f=mock({...payout,status:"failed",reconciliation_status:"in_progress"});
    expect((await reader().inspect(i,"tr_demo","po_demo",known)).trace).toEqual({...known,status:"failed"}); expect(f).toHaveBeenCalledTimes(4);
    mock({...payout,reversed_by:"po_reverse"}); expect((await reader().inspect(i,"tr_demo","po_demo",known)).trace?.status).toBe("reversed");
  });
});
describe("Signed LIVE event routing",()=>{
  it("accepts the exact platform transfer routing and connected payout routing",()=>{
    const a=sign(event); expect(parsePilotEvent(a.raw,a.header,secret,"platform",now)).toEqual({id:"evt_demo",kind:"transfer",approvalId:i.approvalId,transferId:"tr_demo"});
    const b=sign({...event,type:"payout.paid",account:i.recipientAccountId,data:{object:payout}},otherSecret);
    expect(parsePilotEvent(b.raw,b.header,otherSecret,"connected",now)).toEqual({id:"evt_demo",kind:"payout",accountId:i.recipientAccountId,payoutId:"po_demo"});
  });
  it("rejects tampering, wrong endpoint secret, stale signatures and duplicate timestamps",()=>{
    const a=sign(event); expect(()=>parsePilotEvent(Buffer.concat([a.raw,Buffer.from(" ")]),a.header,secret,"platform",now)).toThrow(/signature/);
    expect(()=>parsePilotEvent(a.raw,a.header,otherSecret,"platform",now)).toThrow(/signature/);
    expect(()=>parsePilotEvent(a.raw,a.header,secret,"platform",now+301)).toThrow(/timestamp/);
    expect(()=>parsePilotEvent(a.raw,a.header+`,t=${now}`,secret,"platform",now)).toThrow(/timestamp/);
  });
  it("rejects TEST events, crossed account scope and incorrect metadata; ignores unrelated transfers",()=>{
    const a=sign({...event,livemode:false}); expect(()=>parsePilotEvent(a.raw,a.header,secret,"platform",now)).toThrow(/LIVE snapshot/);
    const b=sign({...event,account:i.recipientAccountId}); expect(()=>parsePilotEvent(b.raw,b.header,secret,"platform",now)).toThrow(/Connected event/);
    const c=sign({...event,data:{object:{...transfer,transfer_group:"wrong"}}}); expect(()=>parsePilotEvent(c.raw,c.header,secret,"platform",now)).toThrow(/routing metadata/);
    const d=sign({...event,data:{object:{...transfer,metadata:{}}}}); expect(parsePilotEvent(d.raw,d.header,secret,"platform",now)).toBeNull();
  });
});
