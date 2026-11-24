#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createPool } from "./connection.js";

const migrations = [
  { version: "001_checkpoint_a", url: new URL("../../../sql/001_checkpoint_a.sql", import.meta.url) },
  { version: "002_checkpoint_b", url: new URL("../../../sql/002_checkpoint_b.sql", import.meta.url) },
  { version: "003_checkpoint_c2", url: new URL("../../../sql/003_checkpoint_c2.sql", import.meta.url) },
  { version: "004_checkpoint_c3", url: new URL("../../../sql/004_checkpoint_c3.sql", import.meta.url) },
  { version: "005_checkpoint_c4", url: new URL("../../../sql/005_checkpoint_c4.sql", import.meta.url) },
  { version: "006_checkpoint_c5", url: new URL("../../../sql/006_checkpoint_c5.sql", import.meta.url) },
  { version: "007_checkpoint_c7", url: new URL("../../../sql/007_checkpoint_c7.sql", import.meta.url) },
  { version: "008_checkpoint_c8", url: new URL("../../../sql/008_checkpoint_c8.sql", import.meta.url) },
  { version: "009_checkpoint_c9", url: new URL("../../../sql/009_checkpoint_c9.sql", import.meta.url) },
  { version: "010_checkpoint_c10", url: new URL("../../../sql/010_checkpoint_c10.sql", import.meta.url) },
  { version: "011_checkpoint_c13", url: new URL("../../../sql/011_checkpoint_c13.sql", import.meta.url) },
  { version: "012_live_pilot_approval", url: new URL("../../../sql/012_live_pilot_approval.sql", import.meta.url) },
];

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize migration runners sharing this database.
    await client.query("SELECT pg_advisory_xact_lock(68514321)");
    await client.query("CREATE SCHEMA IF NOT EXISTS openpayables");
    await client.query(`CREATE TABLE IF NOT EXISTS openpayables.schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    for (const { version, url } of migrations) {
      const existing = await client.query("SELECT 1 FROM openpayables.schema_migrations WHERE version=$1", [version]);
      if (existing.rowCount === 0) {
        await client.query(await readFile(fileURLToPath(url), "utf8"));
        await client.query("INSERT INTO openpayables.schema_migrations(version) VALUES ($1)", [version]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Execute only when directly invoked by the migration npm script.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool();
  migrate(pool)
    .then(() => console.log("OpenPayables database migrations complete."))
    .catch((error: unknown) => { console.error(error); process.exitCode = 1; })
    .finally(() => pool.end());
}
