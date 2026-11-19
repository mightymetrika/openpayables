/** C10: user-authenticated GitHub App Device Flow for the trusted operator CLI.
 * No access tokens, refresh tokens, or device codes are persisted or returned.
 */
export interface GitHubAuthenticatedUser {
  githubUserId: number;
  githubLogin: string;
}

export interface GitHubVerificationPrompt {
  verificationUri: string;
  userCode: string;
  expiresInSeconds: number;
}

type Dependencies = {
  fetchFn?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

type Data = Record<string, unknown>;
const API_VERSION = "2026-03-10";

function obj(value: unknown): Data {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GitHub returned a malformed authorization response");
  }
  return value as Data;
}

function bounded(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error("GitHub returned invalid device authorization timing");
  }
  return value;
}

export class GitHubDeviceFlowClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly clientId: string, deps: Dependencies = {}) {
    if (!/^[-A-Za-z0-9_]{10,128}$/.test(clientId)) {
      throw new Error("Set a valid GitHub App Client ID (not the numeric App ID)");
    }
    this.fetchFn = deps.fetchFn ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? (() => Date.now());
  }

  static fromEnv(): GitHubDeviceFlowClient {
    return new GitHubDeviceFlowClient(process.env.OPENPAYABLES_GITHUB_APP_CLIENT_ID ?? "");
  }

  private async post(url: string, body: URLSearchParams): Promise<Data> {
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch {
      throw new Error("Unable to contact GitHub device authorization endpoint");
    }
    if (!response.ok) throw new Error(`GitHub device authorization HTTP ${response.status}`);
    try { return obj(await response.json()); }
    catch { throw new Error("GitHub returned a malformed authorization response"); }
  }

  /** The user enters the code on GitHub. The CLI never displays an OAuth token. */
  async authenticate(onPrompt: (prompt: GitHubVerificationPrompt) => void): Promise<GitHubAuthenticatedUser> {
    const start = await this.post("https://github.com/login/device/code",
      new URLSearchParams({ client_id: this.clientId }));
    if (start.error === "device_flow_disabled") throw new Error("Enable Device Flow in GitHub App settings");
    if (typeof start.device_code !== "string" || !/^[A-Za-z0-9_-]{20,160}$/.test(start.device_code) ||
        typeof start.user_code !== "string" || !/^[A-Za-z0-9-]{5,20}$/.test(start.user_code) ||
        start.verification_uri !== "https://github.com/login/device") {
      throw new Error("GitHub returned invalid device authorization information");
    }
    const expirationSeconds = bounded(start.expires_in, 1, 3600);
    let intervalSeconds = bounded(start.interval, 1, 60);
    const deadline = this.now() + expirationSeconds * 1000;
    onPrompt({ verificationUri: start.verification_uri, userCode: start.user_code,
      expiresInSeconds: expirationSeconds });

    // Respect the initial interval and all slow_down responses. No busy polling.
    for (let poll = 0; poll < 360; poll++) {
      if (this.now() + intervalSeconds * 1000 >= deadline) {
        throw new Error("GitHub verification code expired; start again");
      }
      await this.sleep(intervalSeconds * 1000);
      if (this.now() >= deadline) throw new Error("GitHub verification code expired; start again");
      const reply = await this.post("https://github.com/login/oauth/access_token",
        new URLSearchParams({ client_id: this.clientId, device_code: start.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code" }));
      if (reply.error === "authorization_pending") continue;
      if (reply.error === "slow_down") {
        intervalSeconds += 5;
        if (typeof reply.interval === "number") intervalSeconds = Math.max(intervalSeconds,
          bounded(reply.interval, 1, 360));
        continue;
      }
      if (typeof reply.error === "string") {
        const known = ["access_denied", "expired_token", "device_flow_disabled", "incorrect_client_credentials"];
        if (known.includes(reply.error)) throw new Error(`GitHub authorization failed: ${reply.error}`);
        throw new Error("GitHub authorization failed; no identity recorded");
      }
      if (typeof reply.access_token !== "string" || !/^ghu_[A-Za-z0-9_]+$/.test(reply.access_token) ||
          reply.token_type !== "bearer") {
        throw new Error("GitHub did not return a valid App user access token");
      }
      // Deliberately ignore any refresh token; only resolve /user once, in memory.
      return this.authenticatedUser(reply.access_token);
    }
    throw new Error("GitHub authorization exceeded polling limit");
  }

  private async authenticatedUser(token: string): Promise<GitHubAuthenticatedUser> {
    let response: Response;
    try {
      response = await this.fetchFn("https://api.github.com/user", {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": API_VERSION },
      });
    } catch {
      throw new Error("Unable to verify authenticated GitHub user");
    }
    if (!response.ok) throw new Error(`GitHub authenticated-user lookup HTTP ${response.status}`);
    let user: Data;
    try { user = obj(await response.json()); }
    catch { throw new Error("GitHub returned malformed authenticated-user data"); }
    if (typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0 ||
        typeof user.login !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user.login) ||
        (user.type !== undefined && user.type !== "User")) {
      throw new Error("GitHub returned malformed authenticated-user identity");
    }
    return { githubUserId: user.id, githubLogin: user.login };
  }
}
