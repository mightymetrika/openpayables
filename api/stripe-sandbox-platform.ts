import { createHostedSandboxWebhookHandler } from "../src/server/hosted-sandbox-webhook.js";

export default { fetch: createHostedSandboxWebhookHandler("platform") };
