/** GitHub App installation authentication. Never persist private keys or installation tokens. */
import { createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { KeyObject } from "node:crypto";
import { parsePublicRepository } from "./discovery.js";
import type { GitHubRepository } from "./discovery.js";

const API = "https://api.github.com";
const VERSION = "2022-11-28";

export interface GitHubAppBinding {
  appId: number;
  installationId: number;
}

export interface GitHubAppSession extends GitHubAppBinding {
  token: string;
}

function positiveId(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid GitHub ${label}`);
  }
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Malformed GitHub App response");
  }
  return value as Record<string, unknown>;
}

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Shared App credentials belong to the running software operator, not to contributors. */
export class GitHubAppClient {
  private readonly privateKey: KeyObject;

  constructor(
    readonly appId: number,
    pem: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {
    positiveId(appId, "App ID");
    if (!pem || typeof pem !== "string") throw new Error("GitHub App private key is required");
    try {
      this.privateKey = createPrivateKey(pem);
      if (this.privateKey.asymmetricKeyType !== "rsa") throw new Error("Expected RSA private key");
    } catch {
      throw new Error("Valid GitHub App RSA private key required");
    }
  }

  static fromEnv(): GitHubAppClient {
    const rawAppId = process.env.OPENPAYABLES_GITHUB_APP_ID;
    const path = process.env.OPENPAYABLES_GITHUB_APP_PRIVATE_KEY_PATH;
    if (!rawAppId || !/^[1-9][0-9]*$/.test(rawAppId) || !Number.isSafeInteger(Number(rawAppId))) {
      throw new Error("Set OPENPAYABLES_GITHUB_APP_ID to the GitHub App numeric ID");
    }
    if (!path) throw new Error("Set OPENPAYABLES_GITHUB_APP_PRIVATE_KEY_PATH outside the repository");
    let pem: string;
    try { pem = readFileSync(path, "utf8"); }
    catch { throw new Error("Cannot read GitHub App private key at configured path"); }
    return new GitHubAppClient(Number(rawAppId), pem);
  }

  /** GitHub requires RS256, iat in the recent past, and expiry within ten minutes. */
  private jwt(): string {
    const now = Math.floor(this.clock() / 1000);
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: String(this.appId) })}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    return `${unsigned}.${signer.sign(this.privateKey).toString("base64url")}`;
  }

  private async request(path: string, auth: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("//") || path.includes("?")) {
      throw new Error("Invalid GitHub App request path");
    }
    const response = await this.fetcher(`${API}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": VERSION,
        "User-Agent": "openpayables-github-app",
        Authorization: `Bearer ${auth}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`GitHub App API returned HTTP ${response.status}; installation access refused`);
    }
    return response.json() as Promise<unknown>;
  }

  /** Verify that a public OAuth Client ID actually belongs to this RSA-authenticated App.
   *  Prevents a different GitHub App's Device Flow from producing C10 evidence.
   */
  async assertClientId(clientId: string): Promise<void> {
    if (!/^[-A-Za-z0-9_]{10,128}$/.test(clientId)) {
      throw new Error("Valid GitHub App Client ID required");
    }
    const app = object(await this.request("/app", this.jwt(), "GET"));
    if (positiveId(app.id, "App ID") !== this.appId || app.client_id !== clientId) {
      throw new Error("GitHub App Client ID does not match the authenticated GitHub App");
    }
  }

  /** Authenticate to one previously registered *public* repository, never more. */
  async authorizeRepository(repo: GitHubRepository, expected?: GitHubAppBinding): Promise<GitHubAppSession> {
    if (!Number.isSafeInteger(repo.id) || repo.id <= 0 || repo.private !== false) {
      throw new Error("C9 GitHub App sync supports registered public repositories only");
    }
    const { owner, name } = parsePublicRepository(repo.fullName);
    const jwt = this.jwt();
    const installation = object(await this.request(`/repos/${owner}/${name}/installation`, jwt, "GET"));
    const installationId = positiveId(installation.id, "installation ID");
    if (positiveId(installation.app_id, "installation App ID") !== this.appId) {
      throw new Error("GitHub installation belongs to a different App");
    }
    if (installation.suspended_at !== null && installation.suspended_at !== undefined) {
      throw new Error("GitHub App installation is suspended");
    }
    const permissions = object(installation.permissions);
    if (!(["read", "write"] as unknown[]).includes(permissions.pull_requests)) {
      throw new Error("GitHub App installation must allow Pull requests: Read");
    }
    if (expected && (expected.appId !== this.appId || expected.installationId !== installationId)) {
      throw new Error("GitHub App installation changed; refusing silent rebind or public fallback");
    }
    // GitHub deliberately issues a token restricted to this ONE repository and read-only PRs.
    const minted = object(await this.request(`/app/installations/${installationId}/access_tokens`, jwt, "POST", {
      repository_ids: [repo.id], permissions: { pull_requests: "read" },
    }));
    if (typeof minted.token !== "string" || !minted.token.trim()) {
      throw new Error("GitHub App did not return a usable installation token");
    }
    const expiry = typeof minted.expires_at === "string" ? Date.parse(minted.expires_at) : NaN;
    if (!Number.isFinite(expiry) || expiry <= this.clock() + 30000) {
      throw new Error("GitHub installation token has invalid or expired lifetime");
    }
    const granted = object(minted.permissions);
    if (granted.pull_requests !== "read") {
      throw new Error("GitHub App token is not restricted to read-only pull requests");
    }
    if (minted.repositories !== undefined) {
      if (!Array.isArray(minted.repositories) || minted.repositories.length !== 1 ||
          positiveId(object(minted.repositories[0]).id, "token repository ID") !== repo.id) {
        throw new Error("GitHub App token repository scope mismatch");
      }
    }
    // The token must actually be able to access the intended stable repository ID.
    const current = object(await this.request(`/repos/${owner}/${name}`, minted.token, "GET"));
    if (positiveId(current.id, "repository ID") !== repo.id || current.private !== false ||
        typeof current.full_name !== "string" || current.full_name.toLowerCase() !== repo.fullName.toLowerCase()) {
      throw new Error("GitHub App token resolved a different repository or unsupported private repository");
    }
    return { appId: this.appId, installationId, token: minted.token };
  }
}
