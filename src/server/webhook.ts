/** Local Stripe TEST webhook listener, no unauthenticated public write endpoints. */
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createPool } from "../storage/postgres/connection.js";
import { OpenPayablesFinance } from "../storage/postgres/finance.js";
import type { ProviderTransfer } from "../payments/provider.js";

export function verifyStripeSignature(raw: Buffer, header: string, secret: string, nowSeconds = Math.floor(Date.now()/1000)): boolean {
  if (!secret?.startsWith("whsec_")) throw new Error("Stripe test webhook signing secret required");
  const parts = header.split(",").map((x) => x.trim());
  const t = parts.find((x) => x.startsWith("t="))?.slice(2);
  const v1 = parts.filter((x) => x.startsWith("v1=")).map((x) => x.slice(3));
  if (!t || !/^\d+$/.test(t) || !v1.length || Math.abs(nowSeconds - Number(t)) > 300) return false;
  const digest = createHmac("sha256", secret).update(`${t}.`).update(raw).digest();
  return v1.some((hex) => {
    if (!/^[a-f0-9]{64}$/i.test(hex)) return false;
    return timingSafeEqual(digest, Buffer.from(hex, "hex"));
  });
}

export function runLocalWebhookServer() {
  const secret = process.env.OPENPAYABLES_STRIPE_TEST_WEBHOOK_SECRET;
  if (!secret) throw new Error("OPENPAYABLES_STRIPE_TEST_WEBHOOK_SECRET required");
  const port = Number(process.env.OPENPAYABLES_WEBHOOK_PORT ?? "8787");
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) throw new Error("Invalid webhook port");
  const pool = createPool();
  const finance = new OpenPayablesFinance(pool);
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/stripe") { res.writeHead(404).end(); return; }
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const part of req) {
        const chunk = Buffer.from(part);
        length += chunk.length;
        if (length > 1024 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      if (!verifyStripeSignature(raw, String(req.headers["stripe-signature"] ?? ""), secret)) {
        res.writeHead(400).end("Invalid Stripe signature"); return;
      }
      const event = JSON.parse(raw.toString("utf8")) as {
        id: string; type: string; livemode: boolean;
        data?: { object?: ProviderTransfer };
      };
      if (event.livemode !== false) { res.writeHead(400).end("Live events not accepted"); return; }
      if (!["transfer.created", "transfer.reversed", "transfer.updated"].includes(event.type)) {
        res.writeHead(200).end("Ignored"); return;
      }
      if (!event.data?.object) { res.writeHead(400).end("Missing transfer"); return; }
      await finance.recordVerifiedStripeEvent(event.id, event.type, event.data.object);
      res.writeHead(200).end("OK");
    } catch (error) {
      console.error(error);
      res.writeHead(500).end("Webhook processing failed");
    }
  });
  server.listen(port, "127.0.0.1", () => console.log(`OpenPayables TEST webhook listening on 127.0.0.1:${port}/stripe`));
  process.on("SIGINT", () => { server.close(); void pool.end(); });
}

if (process.argv[1]?.includes("webhook")) runLocalWebhookServer();
