import { Pool } from "pg";

/** Explicitly require a dedicated development DSN; never silently reuse a host app's DATABASE_URL. */
export function createPool(url = process.env.OPENPAYABLES_DATABASE_URL): Pool {
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    throw new Error("Set OPENPAYABLES_DATABASE_URL to a dedicated PostgreSQL database");
  }
  return new Pool({ connectionString: url, max: 5, application_name: "openpayables" });
}
