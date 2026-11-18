import { describe, expect, it } from "vitest";
import { githubAwardMetadata, positiveGitHubId } from "../src/github/approval.js";

describe("C8 immutable GitHub candidate award metadata", () => {
  it("maps a merged PR author to the existing development category and 8-point rubric", () => {
    expect(githubAwardMetadata(1234, "pr:900:author:11", "pr_author", "large")).toEqual({
      source: "github", sourceId: "repo:1234:pr:900:author:11", category: "development",
      role: "author", points: 8,
    });
  });

  it("maps reviewer evidence to the review category without scoring every review separately", () => {
    expect(githubAwardMetadata(1234, "pr:900:reviewer:12", "pr_reviewer", "medium")).toMatchObject({
      category: "review", role: "reviewer", points: 3,
    });
  });

  it("rejects mismatched candidate type, malformed identity and invalid award sizes", () => {
    expect(() => githubAwardMetadata(1234, "pr:900:author:11", "pr_reviewer", "large")).toThrow(/disagrees/);
    expect(() => githubAwardMetadata(1234, "pr:900:reviewer:11:extra", "pr_reviewer", "large")).toThrow(/identity/);
    expect(() => githubAwardMetadata(1234, "pr:900:author:11", "pr_author", "huge" as "large")).toThrow(/Invalid award size/);
    expect(() => githubAwardMetadata(Number.MAX_SAFE_INTEGER + 1, "pr:900:author:11", "pr_author", "large")).toThrow(/safe integer/);
    expect(() => positiveGitHubId(0, "GitHub ID")).toThrow(/positive/);
  });
});
