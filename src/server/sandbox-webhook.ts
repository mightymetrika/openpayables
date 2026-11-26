import { parseSandboxPilotEvent, type EventScope, type PilotEvent } from "./live-pilot-events.js";

export const sandboxWebhookBodyLimit = 1024 * 1024;

/** Only authenticated TEST events reach the caller's reconciliation callback. */
export interface SandboxWebhookOptions {
  scope: EventScope;
  secret: string;
  reconcile: (event: PilotEvent) => Promise<boolean>;
  log?: (message: string) => void;
}

export interface SandboxWebhookResult {
  status: number;
  body: string;
}

/** Transport-independent verification and dispatch; never initiates a payment. */
export async function handleSandboxWebhook(
  raw: Buffer, signature: string | null, options: SandboxWebhookOptions,
): Promise<SandboxWebhookResult> {
  if (raw.length > sandboxWebhookBodyLimit) return { status: 413, body: "Payload too large" };
  let event: PilotEvent | null;
  try {
    if (!signature) throw new Error("Missing signature");
    event = parseSandboxPilotEvent(raw, signature, options.secret, options.scope);
  } catch { return { status: 400, body: "Invalid TEST event" }; }
  try {
    if (event) {
      const matched = await options.reconcile(event);
      options.log?.(`SIGNED TEST ${options.scope} ${event.id}: ${matched ? "reconciled" : "no matching pilot"}`);
    }
    return { status: 200, body: "OK" };
  } catch {
    options.log?.("TEST event processing failed; retry or reconcile manually");
    return { status: 503, body: "Retry later" };
  }
}

/** Standard Web API adapter for Node.js serverless functions and app routes.
 * The caller owns the restricted database/provider configuration. Do not parse
 * or reserialize the request before passing it here.
 */
export function createSandboxWebhookHandler(options: SandboxWebhookOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    const signature = request.headers.get("stripe-signature");
    if (!signature || signature.length > 8192) return new Response("Invalid TEST event", { status: 400 });
    const declared = request.headers.get("content-length");
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > sandboxWebhookBodyLimit) {
      return new Response("Payload too large", { status: 413 });
    }
    let reader;
    try { reader = request.body?.getReader(); }
    catch { return new Response("Invalid TEST event", { status: 400 }); }
    const chunks: Buffer[] = [];
    let length = 0;
    if (reader) {
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > sandboxWebhookBodyLimit) {
            await reader.cancel();
            return new Response("Payload too large", { status: 413 });
          }
          chunks.push(Buffer.from(part.value));
        }
      } catch { return new Response("Invalid TEST event", { status: 400 }); }
      finally { reader.releaseLock(); }
    }
    const result = await handleSandboxWebhook(Buffer.concat(chunks), signature, options);
    return new Response(result.body, { status: result.status });
  };
}
