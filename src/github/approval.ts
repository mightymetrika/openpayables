/** C8: map immutable GitHub evidence to the existing human-approved 1/3/8 rubric. */
import { pointsForSize, type AwardSize } from "../core/credits.js";
import type { CandidateKind } from "./discovery.js";

export function positiveGitHubId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

export function githubAwardMetadata(repoId: number, candidateKey: string, kind: CandidateKind, size: AwardSize) {
  positiveGitHubId(repoId, "GitHub repository ID");
  const match = /^pr:([1-9]\d*):(author|reviewer):([1-9]\d*)$/.exec(candidateKey);
  if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[3]))) {
    throw new Error("Invalid GitHub candidate identity");
  }
  if ((kind === "pr_author" ? "author" : kind === "pr_reviewer" ? "reviewer" : null) !== match[2]) {
    throw new Error("GitHub candidate kind disagrees with its immutable identity");
  }
  return {
    source: "github",
    sourceId: `repo:${repoId}:${candidateKey}`,
    category: kind === "pr_author" ? "development" : "review",
    role: match[2]!,
    points: pointsForSize(size),
  };
}
