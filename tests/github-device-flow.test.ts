import { describe, expect, it, vi } from "vitest";
import { GitHubDeviceFlowClient } from "../src/github/device-flow.js";

const starter = { device_code: "d".repeat(40), user_code: "ABCD-EFGH",
  verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 };
const token = { access_token: "ghu_testtemporarybearertoken", token_type: "bearer",
  refresh_token: "ghr_testshouldneverbesaved" };
const identity = { id: 12345, login: "human-contributor", type: "User" };
const json = (data: unknown, status = 200) => Response.json(data, { status });

type Handler = (url: string, init: RequestInit | undefined, index: number) => Response;
function harness(handler: Handler) {
  let time = 0;
  const sleeps: number[] = [];
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const req = { url: String(url), init };
    requests.push(req);
    return handler(req.url, init, requests.length);
  }) as unknown as typeof fetch;
  return { requests, sleeps, client: new GitHubDeviceFlowClient("Iv23ExampleClientABC", {
    fetchFn, now: () => time, sleep: async (ms) => { sleeps.push(ms); time += ms; },
  }) };
}

describe("C10 GitHub App contributor-controlled authorization", () => {
  it("completes the GitHub device flow and returns only numeric user ID and login", async () => {
    const h = harness((_url, _opts, i) => [json(starter), json({ error: "authorization_pending" }),
      json(token), json(identity)][i - 1]!);
    const prompt = vi.fn();
    const outcome = await h.client.authenticate(prompt);
    expect(outcome).toEqual({ githubUserId: 12345, githubLogin: "human-contributor" });
    expect(prompt).toHaveBeenCalledWith({ verificationUri: starter.verification_uri,
      userCode: starter.user_code, expiresInSeconds: 900 });
    expect(h.sleeps).toEqual([5000, 5000]);
    expect(h.requests.map((r) => r.url)).toEqual([
      "https://github.com/login/device/code", "https://github.com/login/oauth/access_token",
      "https://github.com/login/oauth/access_token", "https://api.github.com/user",
    ]);
    const first = h.requests[0]!.init!;
    expect(String(first.body)).toContain("client_id=Iv23ExampleClientABC");
    expect(String(h.requests[1]!.init!.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code");
    const bearer = (h.requests[3]!.init!.headers as Record<string, string>).Authorization;
    expect(bearer).toBe(`Bearer ${token.access_token}`);
    expect(JSON.stringify(outcome)).not.toMatch(/ghu_|ghr_|device_code|access_token|refresh_token/);
  });

  it("respects slow_down backoff without excessive polling", async () => {
    const h = harness((_u, _o, i) => [json(starter), json({ error: "slow_down", interval: 12 }),
      json(token), json(identity)][i - 1]!);
    expect(await h.client.authenticate(() => {})).toMatchObject({ githubUserId: 12345 });
    expect(h.sleeps).toEqual([5000, 12000]);
  });

  it("refuses an app not enabled for Device Flow", async () => {
    const h = harness(() => json({ error: "device_flow_disabled" }));
    await expect(h.client.authenticate(() => {})).rejects.toThrow(/Enable Device Flow/);
    expect(h.requests).toHaveLength(1);
  });

  it("fails closed if the contributor denies authorization", async () => {
    const h = harness((_u, _o, i) => i === 1 ? json(starter) : json({ error: "access_denied" }));
    await expect(h.client.authenticate(() => {})).rejects.toThrow(/access_denied/);
    expect(h.requests).toHaveLength(2);
  });

  it("refuses invalid Client IDs and malformed device sessions", async () => {
    expect(() => new GitHubDeviceFlowClient("5825297")).toThrow(/Client ID/);
    const h = harness(() => json({ ...starter, verification_uri: "https://untrusted.example/device" }));
    await expect(h.client.authenticate(() => {})).rejects.toThrow(/invalid device/);
  });

  it("refuses invalid or unexpected access token types", async () => {
    const h = harness((_u, _o, i) => i === 1 ? json(starter) : json({ access_token: "gho_other", token_type: "bearer" }));
    await expect(h.client.authenticate(() => {})).rejects.toThrow(/valid App user access token/);
  });

  it("fails closed if authenticated /user is malformed or unauthorized", async () => {
    const h = harness((_u, _o, i) => [json(starter), json(token), json({ login: "someone" })][i - 1]!);
    await expect(h.client.authenticate(() => {})).rejects.toThrow(/authenticated-user identity/);
    const unauthorized = harness((_u, _o, i) => i === 1 ? json(starter) :
      i === 2 ? json(token) : json({ message: "Bad credentials" }, 401));
    await expect(unauthorized.client.authenticate(() => {})).rejects.toThrow(/HTTP 401/);
  });

  it("does not continue polling after code expiration", async () => {
    const h = harness((_u, _o, i) => i === 1 ? json({ ...starter, expires_in: 10 }) :
      json({ error: "authorization_pending" }));
    await expect(h.client.authenticate(() => {})).rejects.toThrow(/expired/);
    expect(h.requests).toHaveLength(2);
  });
});
