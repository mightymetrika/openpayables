import { Pool } from "pg";

/**
 * Each deployment owns its PostgreSQL database. This accepts standard PostgreSQL
 * URLs, including TLS-verifying Supabase direct and pooler connection strings.
 */
export function createPool(url = process.env.OPENPAYABLES_DATABASE_URL): Pool {
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    throw new Error("Set OPENPAYABLES_DATABASE_URL to a dedicated PostgreSQL database");
  }
  // Small serverless instances should set 1. Preserve the existing 5 default
  // for local/long-running operators; never silently accept an invalid limit.
  const configured = process.env.OPENPAYABLES_POOL_MAX;
  const max = configured === undefined ? 5 : Number(configured);
  if (configured !== undefined && (!/^[1-9][0-9]*$/.test(configured) ||
      !Number.isSafeInteger(max) || max > 20)) {
    throw new Error("OPENPAYABLES_POOL_MAX must be an integer from 1 to 20");
  }
  return new Pool({ connectionString: url, max, application_name: "openpayables" });
}
