import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { OpenPayablesOperatorSetup } from "../src/operator/setup.js";
import type { OperatorGitHubAccess } from "../src/operator/setup.js";

const valid = { id: 1460710596, fullName: "mightymetrika/openpayables", private: false as const };
function fixture() {
  const access: OperatorGitHubAccess = {
    repository: vi.fn(async () => valid),
    authorizeRepository: vi.fn(async () => ({ appId: 5825297, installationId: 183507524, token: "ephemeral" })),
  };
  const pool = { connect: vi.fn(() => { throw new Error("Database must not be used before remote validation"); }) } as unknown as Pool;
  return { setup: new OpenPayablesOperatorSetup(pool), access, pool };
}

describe("C11 operator setup preflight (no network or DB)", () => {
  it("rejects malformed repository names without calling GitHub", async () => {
    const { setup, access } = fixture();
    await expect(setup.setup("p", "Project", "https://github.com/o/r", "operator", access))
      .rejects.toThrow(/owner\/repo|Repository must/);
    expect(access.repository).not.toHaveBeenCalled();
  });
  it("refuses a renamed or unexpected public repository before authentication or writes", async () => {
    const { setup, access, pool } = fixture();
    access.repository = vi.fn(async () => ({ ...valid, fullName: "another/repo" }));
    await expect(setup.setup("p", "Project", "mightymetrika/openpayables", "operator", access))
      .rejects.toThrow(/identity differs/);
    expect(access.authorizeRepository).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("refuses missing GitHub installation authorization without persisting a project", async () => {
    const { setup, access, pool } = fixture();
    access.authorizeRepository = vi.fn(async () => { throw new Error("App not installed"); });
    await expect(setup.setup("p", "Project", "mightymetrika/openpayables", "operator", access))
      .rejects.toThrow(/App not installed/);
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it("refuses malformed app credentials or token before opening a DB transaction", async () => {
    const { setup, access, pool } = fixture();
    access.authorizeRepository = vi.fn(async () => ({ appId: 0, installationId: 183507524, token: "bad" }));
    await expect(setup.setup("p", "Project", "mightymetrika/openpayables", "operator", access))
      .rejects.toThrow(/Invalid GitHub App ID/);
    access.authorizeRepository = vi.fn(async () => ({ appId: 5825297, installationId: 183507524, token: "" }));
    await expect(setup.setup("p", "Project", "mightymetrika/openpayables", "operator", access))
      .rejects.toThrow(/did not return an access token/);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
