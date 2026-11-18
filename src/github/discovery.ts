/** Read-only GitHub REST discovery. GitHub activity is evidence, never an automatic credit award. */
import { createHash } from "node:crypto";

const API = "https://api.github.com";
const PAGE_SIZE = 50;
const REVIEW_PAGE_SIZE = 100;
const MAX_REQUESTS = 50;
const MAX_PR_PAGES = 5;
const MAX_REVIEW_PAGES = 3;

export interface GitHubRepository {
  id: number;
  fullName: string;
  private: false;
}

export type CandidateKind = "pr_author" | "pr_reviewer";

export interface GitHubCandidate {
  candidateKey: string;
  kind: CandidateKind;
  pullId: number;
  pullNumber: number;
  githubUserId: number;
  githubLogin: string;
  title: string;
  sourceUrl: string;
  mergedAt: string;
  reviewIds: number[];
  lastReviewAt: string | null;
  fingerprint: string;
}

interface GitHubUser { id: number; login: string; type?: string }
interface GitHubPull {
  id: number; number: number; title: string; updated_at: string;
  merged_at: string | null; user: GitHubUser | null;
}
interface GitHubReview {
  id: number; state: string; submitted_at: string | null;
  user: GitHubUser | null;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Malformed GitHub API response: expected an object");
  }
  return value as Record<string, unknown>;
}

function positiveId(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Malformed GitHub API response: invalid ${what}`);
  }
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 20000) {
    throw new Error(`Malformed GitHub API response: invalid ${what}`);
  }
  return value;
}

function iso(value: unknown, what: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))) {
    throw new Error(`Malformed GitHub API response: invalid ${what}`);
  }
  return value;
}

function user(value: unknown): GitHubUser | null {
  if (value === null) return null;
  const object = record(value);
  const id = positiveId(object.id, "user ID");
  const login = text(object.login, "user login");
  return { id, login, type: typeof object.type === "string" ? object.type : undefined };
}

function pull(value: unknown): GitHubPull {
  const object = record(value);
  return {
    id: positiveId(object.id, "pull ID"),
    number: positiveId(object.number, "pull number"),
    title: text(object.title, "pull title").slice(0, 512),
    updated_at: iso(object.updated_at, "pull update timestamp"),
    merged_at: object.merged_at === null ? null : iso(object.merged_at, "pull merge timestamp"),
    user: user(object.user),
  };
}

function review(value: unknown): GitHubReview {
  const object = record(value);
  return {
    id: positiveId(object.id, "review ID"),
    state: text(object.state, "review state"),
    submitted_at: object.submitted_at === null ? null : iso(object.submitted_at, "review submission timestamp"),
    user: user(object.user),
  };
}

export function parsePublicRepository(value: string): { owner: string; name: string; fullName: string } {
  if (typeof value !== "string" || value.trim() !== value) throw new Error("Repository must be owner/repo");
  // The owner/repo is never used as an absolute URL or a query argument.
  const parts = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})$/.exec(value);
  if (!parts || parts[2] === "." || parts[2] === "..") throw new Error("Repository must be owner/repo");
  return { owner: parts[1]!, name: parts[2]!, fullName: `${parts[1]}/${parts[2]}` };
}

export function parseSince(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Since must be a UTC date in YYYY-MM-DD format");
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== value) throw new Error("Invalid UTC date");
  if (d.valueOf() > Date.now()) throw new Error("Since date must not be in the future");
  return d.toISOString();
}

export function parseMaxPages(value: string | undefined): number {
  const n = value === undefined ? 2 : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_PR_PAGES) {
    throw new Error(`Maximum pull pages must be an integer from 1 to ${MAX_PR_PAGES}`);
  }
  return n;
}

function candidate(input: Omit<GitHubCandidate, "fingerprint">): GitHubCandidate {
  const data = JSON.stringify(input);
  return { ...input, fingerprint: createHash("sha256").update(data).digest("hex") };
}

/** Network is injectable for unit tests; requests are always GET-only and confined to api.github.com. */
export class GitHubPublicClient {
  private requests = 0;
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly token = process.env.OPENPAYABLES_GITHUB_TOKEN,
  ) {}

  private async get<T>(path: string): Promise<T> {
    if (!path.startsWith("/repos/") || path.includes("//") || this.requests >= MAX_REQUESTS) {
      throw new Error("GitHub discovery request budget exhausted or invalid URL; narrow the scan window");
    }
    this.requests++;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "openpayables-public-discovery",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await this.fetcher(`${API}${path}`, {
      method: "GET", headers, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        throw new Error(`GitHub API returned ${response.status} (permissions or rate limit); import aborted`);
      }
      throw new Error(`GitHub API returned HTTP ${response.status}; import aborted`);
    }
    return (await response.json()) as T;
  }

  async repository(repo: string): Promise<GitHubRepository> {
    const { owner, name } = parsePublicRepository(repo);
    const data = record(await this.get<unknown>(`/repos/${owner}/${name}`));
    const id = positiveId(data.id, "repository ID");
    const fullName = text(data.full_name, "repository full name");
    if (data.private !== false) throw new Error("Only public GitHub repositories are supported in C7");
    const actual = parsePublicRepository(fullName);
    if (actual.fullName.toLowerCase() !== repo.toLowerCase()) {
      throw new Error(`Repository has been renamed or redirected to ${actual.fullName}; register its current name explicitly`);
    }
    return { id, fullName: actual.fullName, private: false };
  }

  async discover(repo: GitHubRepository, sinceUtc: string, maxPages = 2): Promise<GitHubCandidate[]> {
    const { owner, name } = parsePublicRepository(repo.fullName);
    if (!/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(sinceUtc) ||
      !Number.isFinite(Date.parse(sinceUtc))) throw new Error("Invalid UTC scan boundary");
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_PR_PAGES) {
      throw new Error("Invalid maximum page count");
    }

    const candidates: GitHubCandidate[] = [];
    const seenPulls = new Set<number>();
    let complete = false;
    for (let page = 1; page <= maxPages; page++) {
      const data = await this.get<unknown>(`/repos/${owner}/${name}/pulls?state=closed&sort=updated&direction=desc&per_page=${PAGE_SIZE}&page=${page}`);
      if (!Array.isArray(data)) throw new Error("Malformed GitHub pull list");
      if (data.length > PAGE_SIZE) throw new Error("Malformed GitHub pull page size");
      const pulls = data.map(pull);
      // A merged PR cannot have been updated before its merge timestamp. We can stop at the UTC boundary.
      for (const pr of pulls) {
        if (seenPulls.has(pr.id)) throw new Error("Duplicate GitHub pull across pages; import aborted");
        seenPulls.add(pr.id);
        if (pr.updated_at < sinceUtc) continue;
        if (!pr.merged_at || pr.merged_at < sinceUtc) continue;
        if (pr.user?.type !== "Bot" && pr.user !== null) {
          candidates.push(candidate({
            candidateKey: `pr:${pr.id}:author:${pr.user.id}`, kind: "pr_author", pullId: pr.id,
            pullNumber: pr.number, githubUserId: pr.user.id, githubLogin: pr.user.login,
            title: pr.title, sourceUrl: `https://github.com/${repo.fullName}/pull/${pr.number}`,
            mergedAt: pr.merged_at, reviewIds: [], lastReviewAt: null,
          }));
        }
        // Reviews can be submitted before a PR merges. Group by reviewer, not by number of reviews.
        const groups = new Map<number, { login: string; ids: number[]; last: string }>();
        const seenReviews = new Set<number>();
        let reviewsComplete = false;
        for (let reviewPage = 1; reviewPage <= MAX_REVIEW_PAGES; reviewPage++) {
          const reviewData = await this.get<unknown>(`/repos/${owner}/${name}/pulls/${pr.number}/reviews?per_page=${REVIEW_PAGE_SIZE}&page=${reviewPage}`);
          if (!Array.isArray(reviewData) || reviewData.length > REVIEW_PAGE_SIZE) {
            throw new Error("Malformed GitHub review list");
          }
          for (const raw of reviewData) {
            const r = review(raw);
            if (seenReviews.has(r.id)) throw new Error("Duplicate GitHub review across pages; import aborted");
            seenReviews.add(r.id);
            if (!r.submitted_at || r.submitted_at > pr.merged_at ||
              !["APPROVED", "CHANGES_REQUESTED", "COMMENTED"].includes(r.state) ||
              !r.user || r.user.type === "Bot" || r.user.id === pr.user?.id) continue;
            const group = groups.get(r.user.id) ?? { login: r.user.login, ids: [], last: r.submitted_at };
            group.ids.push(r.id);
            if (r.submitted_at > group.last) group.last = r.submitted_at;
            groups.set(r.user.id, group);
          }
          if (reviewData.length < REVIEW_PAGE_SIZE) { reviewsComplete = true; break; }
        }
        if (!reviewsComplete) throw new Error("GitHub review pagination limit reached; import aborted without writing candidates");
        for (const [id, group] of groups) {
          candidates.push(candidate({
            candidateKey: `pr:${pr.id}:reviewer:${id}`, kind: "pr_reviewer", pullId: pr.id,
            pullNumber: pr.number, githubUserId: id, githubLogin: group.login,
            title: pr.title, sourceUrl: `https://github.com/${repo.fullName}/pull/${pr.number}`,
            mergedAt: pr.merged_at, reviewIds: group.ids.sort((a, b) => a - b), lastReviewAt: group.last,
          }));
        }
      }
      if (pulls.length < PAGE_SIZE || pulls.some((pr) => pr.updated_at < sinceUtc)) {
        complete = true;
        break;
      }
    }
    if (!complete) throw new Error("GitHub pull pagination limit reached; narrow the since date or increase max pages; no candidates imported");
    return candidates.sort((a, b) => a.candidateKey.localeCompare(b.candidateKey));
  }
}
