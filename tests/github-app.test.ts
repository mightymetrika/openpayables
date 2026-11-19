import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GitHubAppClient } from "../src/github/app.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const appId = 7654;
const installationId = 8765;
const repo = { id: 1234, fullName: "owner/repo", private: false as const };
const now = Date.parse("2026-11-18T23:00:00Z");
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function responseFor(url: string, init?: RequestInit) {
  if (url.endsWith("/installation")) {
    expect(init?.method).toBe("GET");
    return ok({ id: installationId, app_id: appId, suspended_at: null, permissions: { pull_requests: "read" } });
  }
  if (url.endsWith("/access_tokens")) {
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      repository_ids: [1234], permissions: { pull_requests: "read" },
    });
    return ok({ token: "ephemeral-installation-secret", expires_at: "2026-11-18T23:40:00Z",
      permissions: { pull_requests: "read" }, repositories: [{ id: 1234 }] });
  }
  if (url.endsWith("/repos/owner/repo")) {
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer ephemeral-installation-secret");
    return ok({ id: 1234, full_name: "owner/repo", private: false });
  }
  throw new Error(`Unexpected GitHub API path: ${url}`);
}

function mockClient(fn = responseFor) {
  const fetcher = vi.fn((url: string, init?: RequestInit) => Promise.resolve(fn(url, init)));
  return { api: new GitHubAppClient(appId, pem, fetcher as unknown as typeof fetch, () => now), fetcher };
}

describe("C9 least-privilege GitHub App installation authentication", () => {
  it("creates an RSA-signed JWT and mints a read-only, single-repository token", async () => {
    const { api, fetcher } = mockClient();
    const session = await api.authorizeRepository(repo);
    expect(session).toEqual({ appId, installationId, token: "ephemeral-installation-secret" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const first = fetcher.mock.calls[0]!;
    expect(first[0]).toBe("https://api.github.com/repos/owner/repo/installation");
    const jwt = (first[1]?.headers as Record<string, string>).Authorization.slice("Bearer ".length);
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    expect(claims).toEqual({ iat: Math.floor(now / 1000) - 60, exp: Math.floor(now / 1000) + 540, iss: String(appId) });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
    const tokenCall = fetcher.mock.calls[1]!;
    expect(tokenCall[0]).toBe(`https://api.github.com/app/installations/${installationId}/access_tokens`);
    expect((tokenCall[1]?.headers as Record<string, string>).Authorization).toBe(`Bearer ${jwt}`);
  });

  it("refuses installations belonging to another App or suspended installations without minting a token", async () => {
    for (const data of [
      { id: installationId, app_id: 9000, permissions: { pull_requests: "read" } },
      { id: installationId, app_id: appId, suspended_at: "2026-11-18T22:00:00Z", permissions: { pull_requests: "read" } },
      { id: installationId, app_id: appId, permissions: { pull_requests: "none" } },
    ]) {
      const { api, fetcher } = mockClient(() => ok(data));
      await expect(api.authorizeRepository(repo)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses a changed installation binding before minting a token", async () => {
    const { api, fetcher } = mockClient();
    await expect(api.authorizeRepository(repo, { appId, installationId: 99999 })).rejects.toThrow(/changed/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const { api: same } = mockClient();
    await expect(same.authorizeRepository(repo, { appId, installationId })).resolves.toMatchObject({ installationId });
  });

  it("rejects expired, over-privileged, or incorrectly scoped installation tokens", async () => {
    const base = { token: "ephemeral-installation-secret", expires_at: "2026-11-18T23:40:00Z",
      permissions: { pull_requests: "read" }, repositories: [{ id: repo.id }] };
    const bad = [
      { ...base, expires_at: "2026-11-18T22:59:00Z" },
      { ...base, permissions: { pull_requests: "write" } },
      { ...base, repositories: [{ id: 5555 }] },
      { ...base, token: "" },
    ];
    for (const altered of bad) {
      const { api, fetcher } = mockClient((url, init) => url.endsWith("/access_tokens") ? ok(altered) : responseFor(url, init));
      await expect(api.authorizeRepository(repo)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });

  it("rejects a token that actually resolves to another repository or a private repository", async () => {
    for (const altered of [
      { id: 7777, full_name: "owner/repo", private: false },
      { id: 1234, full_name: "owner/renamed", private: false },
      { id: 1234, full_name: "owner/repo", private: true },
    ]) {
      const { api } = mockClient((url, init) => url.endsWith("/repos/owner/repo") ? ok(altered) : responseFor(url, init));
      await expect(api.authorizeRepository(repo)).rejects.toThrow(/different repository|unsupported private/);
    }
  });

  it("rejects non-RSA keys, invalid IDs, and malformed API responses", async () => {
    expect(() => new GitHubAppClient(0, pem)).toThrow();
    expect(() => new GitHubAppClient(appId, "bad-key")).toThrow(/valid GitHub App RSA/i);
    const { api } = mockClient(() => ok({ error: "unexpected" }));
    await expect(api.authorizeRepository(repo)).rejects.toThrow(/installation ID/);
    await expect(mockClient().api.authorizeRepository({ ...repo, private: true as false })).rejects.toThrow(/public/);
    await expect(mockClient().api.authorizeRepository({ ...repo, fullName: "bad/path/extra" })).rejects.toThrow();
  });

  it("C10 checks the Device Flow Client ID against the actual signed GitHub App identity", async () => {
    const valid = mockClient((url) => {
      expect(url).toBe("https://api.github.com/app");
      return ok({ id: appId, client_id: "Iv23ThisAppClient" });
    });
    await expect(valid.api.assertClientId("Iv23ThisAppClient")).resolves.toBeUndefined();
    expect(valid.fetcher).toHaveBeenCalledTimes(1);
    const bad = mockClient(() => ok({ id: appId, client_id: "Iv23DifferentApp" }));
    await expect(bad.api.assertClientId("Iv23ThisAppClient")).rejects.toThrow(/does not match/);
    const wrongId = mockClient(() => ok({ id: 222222, client_id: "Iv23ThisAppClient" }));
    await expect(wrongId.api.assertClientId("Iv23ThisAppClient")).rejects.toThrow(/does not match/);
  });

  it("fails closed on GitHub errors and never includes secrets in error messages", async () => {
    const { api } = mockClient(() => new Response("secret-token-in-body", { status: 403 }));
    await expect(api.authorizeRepository(repo)).rejects.toThrow(/403/);
    await expect(api.authorizeRepository(repo)).rejects.not.toThrow(/secret-token-in-body/);
  });
});
