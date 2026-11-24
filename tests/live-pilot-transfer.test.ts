import { afterEach, describe, expect, it, vi } from "vitest";
import { StripeLivePilotTransfer, pilotIdempotencyKey, type PilotTransferInstruction } from "../src/payments/stripe/live-transfer.js";
const i: PilotTransferInstruction = { approvalId:"afc27cd6-2b3e-4c41-b1e7-9220e268cf02", platformAccountId:"acct_payer", recipientAccountId:"acct_payee", topupId:"tu_receipt", amountCents:500 };
const key = pilotIdempotencyKey(i.approvalId);
const raw = { id:"tr_demo", object:"transfer", livemode:true, currency:"usd", amount:500, destination:i.recipientAccountId,
  transfer_group:key, metadata:{openpayables_approval_id:i.approvalId}, amount_reversed:0, reversed:false };
function mock(...values: unknown[]) {
  const f = vi.fn();
  for (const value of values) f.mockResolvedValueOnce(new Response(JSON.stringify(value), {status:200}));
  vi.stubGlobal("fetch",f); return f;
}
function client(write=false) { return new StripeLivePilotTransfer("rk_live_" + "synthetic", i.platformAccountId, write); }
function preflightMock(status="active") {
  const payer={id:i.platformAccountId,country:"US",capabilities:{transfers:"active"},requirements:{currently_due:[],past_due:[]}};
  const balance={object:"balance",livemode:true,available:[{currency:"usd",amount:1000}]};
  const recipient={id:i.recipientAccountId,object:"account",country:"US",capabilities:{transfers:"active"},payouts_enabled:true,details_submitted:true};
  const topup={object:"topup",id:i.topupId,livemode:true,status:"succeeded",currency:"usd",amount:1000,balance_transaction:"txn_demo"};
  const receipt={object:"balance_transaction",id:"txn_demo",source:i.topupId,type:"topup",currency:"usd",status:"available",amount:1000,net:900};
  return mock(payer,balance,recipient,topup,receipt,{id:i.recipientAccountId,object:"v2.core.account",configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status}}}}}});
}
async function prepared() { const c=client(true); preflightMock(); await c.preflight(i); return c; }
afterEach(() => vi.unstubAllGlobals());
describe("LIVE pilot transfer client (mocked HTTP only)", () => {
  it("refuses TEST keys, disabled writing, wrong payer and oversized instructions without HTTP", async () => {
    const f=mock();
    expect(() => new StripeLivePilotTransfer("rk_test_"+"synthetic", i.platformAccountId)).toThrow(/LIVE restricted/);
    await expect(client().sendOnce(i)).rejects.toThrow(/disabled/);
    await expect(client(true).sendOnce({...i,platformAccountId:"acct_other"})).rejects.toThrow(/payer differs/);
    await expect(client(true).sendOnce({...i,amountCents:2501})).rejects.toThrow(/Invalid frozen/);
    await expect(client(true).sendOnce(i)).rejects.toThrow(/fresh preflight/);
    expect(f).not.toHaveBeenCalled();
  });
  it("POSTs exact frozen integer cents, destination and durable idempotency/metadata once",async () => {
    const c=await prepared();
    const f=mock(raw);
    await expect(c.sendOnce(i)).resolves.toEqual({transferId:"tr_demo",amountReversedCents:0});
    expect(f).toHaveBeenCalledTimes(1);
    const [url,init]=f.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/transfers");
    expect(init.method).toBe("POST"); expect(init.headers["Idempotency-Key"]).toBe(key);
    expect(Object.fromEntries(init.body)).toEqual({amount:"500",currency:"usd",destination:i.recipientAccountId,transfer_group:key,"metadata[openpayables_approval_id]":i.approvalId});
    expect(init.redirect).toBe("error");
    await expect(c.sendOnce(i)).rejects.toThrow(/fresh preflight/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("never retries malformed, wrong-mode, wrong-recipient or mismatched responses", async () => {
    for(const bad of [{...raw,livemode:false},{...raw,destination:"acct_other"},{...raw,amount:501},{...raw,metadata:{}},{...raw,transfer_group:"unrelated"}]) {
      const c=await prepared(); const f=mock(bad);
      await expect(c.sendOnce(i)).rejects.toThrow(/mismatched/);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
  it("does not retry an ambiguous transport error",async () => {
    const c=await prepared();
    const f=vi.fn().mockRejectedValue(new Error("simulated timeout")); vi.stubGlobal("fetch",f);
    await expect(c.sendOnce(i)).rejects.toThrow(/timeout/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("requires fresh v2 recipient transfers capability before proceeding", async () => {
    for (const status of ["restricted","active"]) {
      const f=preflightMock(status);
      if(status==="active") await expect(client(true).preflight(i)).resolves.toMatchObject({receiptNetCents:900});
      else await expect(client(true).preflight(i)).rejects.toThrow(/v2 transfers/);
      expect(f).toHaveBeenCalledTimes(6); expect(f.mock.calls.every(call=>call[1].method==="GET")).toBe(true);
    }
  });
  it("reconciles only by exact payer, transfer ID, and frozen metadata; reports reversals", async () => {
    const payer={id:i.platformAccountId}; const balance={object:"balance",livemode:true};
    const f=mock(payer,balance,{...raw,amount_reversed:500,reversed:true});
    await expect(client().retrieve(i,"tr_demo")).resolves.toEqual({transferId:"tr_demo",amountReversedCents:500});
    expect(f.mock.calls.every(call=>call[1].method==="GET")).toBe(true);
    mock(payer,balance,{...raw,id:"tr_other"}); await expect(client().retrieve(i,"tr_demo")).rejects.toThrow(/mismatched/);
    const wrong=mock({id:"acct_other"},balance); await expect(client().retrieve(i,"tr_demo")).rejects.toThrow(/exact LIVE payer/);
    expect(wrong).toHaveBeenCalledTimes(2);
  });
});
