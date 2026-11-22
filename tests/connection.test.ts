import { afterEach, describe, expect, it, vi } from "vitest";
import { createPool } from "../src/storage/postgres/connection.js";

const localUrl = "postgresql://local:pass@127.0.0.1:5432/openpayables";

function configuredMax(pool: ReturnType<typeof createPool>): number {
  return (pool as unknown as { options: { max: number } }).options.max;
}

afterEach(() => vi.unstubAllEnvs());

describe("generic PostgreSQL connection pool configuration", () => {
  it("retains the existing five-connection default", async () => {
    vi.stubEnv("OPENPAYABLES_POOL_MAX", undefined);
    const pool = createPool(localUrl);
    try { expect(configuredMax(pool)).toBe(5); } finally { await pool.end(); }
  });

  it("supports a single connection for a serverless hosted reader", async () => {
    vi.stubEnv("OPENPAYABLES_POOL_MAX", "1");
    const pool = createPool(localUrl);
    try { expect(configuredMax(pool)).toBe(1); } finally { await pool.end(); }
  });

  it("refuses invalid limits without making database connections", () => {
    for (const value of ["0", "21", "-1", "1.2", "unlimited", " 5", "", "01"]) {
      vi.stubEnv("OPENPAYABLES_POOL_MAX", value);
      expect(() => createPool(localUrl)).toThrow(/OPENPAYABLES_POOL_MAX/);
    }
  });

  it("continues to require an explicit PostgreSQL URL", () => {
    vi.stubEnv("OPENPAYABLES_POOL_MAX", "1");
    expect(() => createPool("https://example.com")).toThrow(/dedicated PostgreSQL/);
    expect(() => createPool("")).toThrow(/dedicated PostgreSQL/);
  });
});
