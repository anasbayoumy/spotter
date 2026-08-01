import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";

import type { PgliteDatabaseAdapter } from "./adapters/pglite-adapter.js";
import type { PostgresDatabaseAdapter } from "./adapters/postgres-adapter.js";

export async function migratePostgresDatabase(
  adapter: PostgresDatabaseAdapter,
  migrationsFolder: string,
): Promise<void> {
  await migratePostgres(adapter.database, { migrationsFolder });
}

export async function migratePgliteDatabase(
  adapter: PgliteDatabaseAdapter,
  migrationsFolder: string,
): Promise<void> {
  await adapter.client.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL UNIQUE,
      created_at bigint NOT NULL
    );
  `);

  const files = (await readdir(migrationsFolder))
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const source = await readFile(path.join(migrationsFolder, file), "utf8");
    const hash = createHash("sha256").update(source).digest("hex");
    const applied = await adapter.client.query<{ readonly hash: string }>(
      "SELECT hash FROM __drizzle_migrations WHERE hash = $1",
      [hash],
    );
    if (applied.rows.length > 0) continue;

    await adapter.client.transaction(async (transaction) => {
      await transaction.exec(source);
      await transaction.query(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)",
        [hash, Date.now()],
      );
    });
  }
}
