import { describe, expect, it, vi } from "vitest";
import { GitHubPublicClient, parseMaxPages, parsePublicRepository, parseSince } from "../src/github/discovery.js";

const repo = { id: 1234, fullName: "owner/repo", private: false as const };
const githubUser = (id: number, login: string, type = "User") => ({ id, login, type });
const pull = (id: number, number: number, merged: string | null, user = githubUser(10, "author")) => ({
  id, number, title: `Feature ${number}`, updated_at: "2026-11-17T20:10:00Z",
  merged_at: merged, user,
});
const review = (id: number, state: string, user = githubUser(11, "reviewer"), at = "2026-11-16T10:00:00Z") => ({
  id, state, submitted_at: at, user,
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const client = (handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) => {
  const mock = vi.fn(handler);
  return { api: new GitHubPublicClient(mock as unknown as typeof fetch), mock };
};

const merged = "2026-11-17T18:00:00Z";

describe("C7 read-only GitHub discovery", () => {
  it("accepts owner/repo and UTC dates while rejecting URL/path injection", () => {
    expect(parsePublicRepository("owner/repo").fullName).toBe("owner/repo");
    for (const value of ["https://github.com/owner/repo", "owner/../repo", "owner/repo?foo=1", "owner/repo/extra", " owner/repo", "owner/..", "owner/a#x"]) {
      expect(() => parsePublicRepository(value)).toThrow();
    }
    expect(parseSince("2026-11-17")).toBe("2026-11-17T00:00:00.000Z");
    expect(() => parseSince("2026-02-30")).toThrow();
    expect(() => parseSince("2027-01-01")).toThrow();
    expect(() => parseSince("2026-11-17T01:00:00Z")).toThrow();
    expect(parseMaxPages(undefined)).toBe(2);
    expect(parseMaxPages("5")).toBe(5);
    for (const value of ["0", "6", "1.5", "NaN"]) expect(() => parseMaxPages(value)).toThrow();
  });

  it("verifies a public repository with a GET request and no token disclosure", async () => {
    const { api, mock } = client((_url, init) => {
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
      return ok({ id: 1234, full_name: "owner/repo", private: false });
    });
    expect(await api.repository("owner/repo")).toEqual(repo);
    expect(mock.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/owner/repo");
  });

  it("rejects private and redirected repositories, even if credentials can read them", async () => {
    const privateClient = client(() => ok({ id: 1234, full_name: "owner/repo", private: true })).api;
    await expect(privateClient.repository("owner/repo")).rejects.toThrow(/public/);
    const redirected = client(() => ok({ id: 1234, full_name: "other/new", private: false })).api;
    await expect(redirected.repository("owner/repo")).rejects.toThrow(/renamed or redirected/);
  });

  it("discovers merged PR authors and distinct human reviewers, grouped once per reviewer", async () => {
    const { api, mock } = client((url) => {
      if (url.includes("/pulls?")) return ok([
        pull(100, 7, merged),
        pull(101, 8, null),
        pull(102, 9, "2026-10-10T09:00:00Z"),
      ]);
      if (url.includes("/pulls/7/reviews")) return ok([
        review(201, "APPROVED"), review(202, "COMMENTED"),
        review(203, "PENDING"), review(204, "DISMISSED"),
        review(205, "APPROVED", githubUser(10, "author")),
        review(206, "APPROVED", githubUser(30, "ci-bot", "Bot")),
        review(207, "COMMENTED", githubUser(14, "late"), "2026-11-18T01:00:00Z"),
      ]);
      throw Error(`Unexpected URL ${url}`);
    });
    const found = await api.discover(repo, "2026-11-01T00:00:00.000Z");
    expect(found).toHaveLength(2);
    expect(found.map((x) => x.kind).sort()).toEqual(["pr_author", "pr_reviewer"]);
    const author = found.find((x) => x.kind === "pr_author")!;
    const reviewer = found.find((x) => x.kind === "pr_reviewer")!;
    expect(author).toMatchObject({ candidateKey: "pr:100:author:10", githubUserId: 10, reviewIds: [] });
    expect(reviewer).toMatchObject({ candidateKey: "pr:100:reviewer:11", githubUserId: 11, reviewIds: [201, 202] });
    expect(reviewer.sourceUrl).toBe("https://github.com/owner/repo/pull/7");
    expect(reviewer.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("uses stable numeric identities even when GitHub display names change", async () => {
    const fetcher = (login: string) => client((url) => {
      if (url.includes("/pulls?")) return ok([pull(100, 7, merged, githubUser(10, login))]);
      return ok([]);
    }).api;
    const oldEvidence = (await fetcher("old-name").discover(repo, "2026-11-01T00:00:00.000Z"))[0]!;
    const newEvidence = (await fetcher("new-name").discover(repo, "2026-11-01T00:00:00.000Z"))[0]!;
    expect(oldEvidence.candidateKey).toEqual(newEvidence.candidateKey);
    expect(oldEvidence.fingerprint).not.toEqual(newEvidence.fingerprint);
  });

  it("rejects incomplete pull pagination rather than claiming a complete scan", async () => {
    const { api } = client((url) => {
      if (url.includes("/pulls?")) return ok(Array.from({ length: 50 }, (_, i) => pull(100 + i, i + 1, null)));
      throw new Error("Review endpoint should not be requested");
    });
    await expect(api.discover(repo, "2026-11-01T00:00:00.000Z", 1)).rejects.toThrow(/pagination limit/);
  });

  it("rejects incomplete review pagination", async () => {
    const { api } = client((url) => {
      if (url.includes("/pulls?")) return ok([pull(100, 7, merged)]);
      if (url.includes("/reviews?")) {
        const page = Number(new URL(url).searchParams.get("page"));
        return ok(Array.from({ length: 100 }, (_, i) => review(1000 + (page - 1) * 100 + i, "APPROVED")));
      }
      throw new Error(url);
    });
    await expect(api.discover(repo, "2026-11-01T00:00:00.000Z")).rejects.toThrow(/review pagination limit/);
  });

  it("aborts on malformed responses and duplicate GitHub source evidence", async () => {
    const malformed = client((url) => url.includes("/pulls?") ? ok([{ id: "not-a-number" }]) : ok([])).api;
    await expect(malformed.discover(repo, "2026-11-01T00:00:00.000Z")).rejects.toThrow(/invalid pull ID/);
    const dup = client((url) => {
      if (url.includes("/pulls?")) return ok([pull(100, 7, merged)]);
      return ok([review(21, "APPROVED"), review(21, "APPROVED")]);
    }).api;
    await expect(dup.discover(repo, "2026-11-01T00:00:00.000Z")).rejects.toThrow(/Duplicate GitHub review/);
  });

  it("handles GitHub rate limiting and HTTP errors without inventing candidates", async () => {
    const { api } = client(() => new Response("rate limited", { status: 429 }));
    await expect(api.repository("owner/repo")).rejects.toThrow(/429/);
    const down = client(() => new Response("not found", { status: 404 })).api;
    await expect(down.repository("owner/repo")).rejects.toThrow(/404/);
  });

  it("optionally passes a GitHub token only in request headers, never in URLs", async () => {
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      expect(url).not.toContain("secret-token");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
      return Promise.resolve(ok({ id: 1234, full_name: "owner/repo", private: false }));
    });
    const api = new GitHubPublicClient(fetcher as unknown as typeof fetch, "secret-token");
    await api.repository("owner/repo");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
