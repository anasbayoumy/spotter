import { PGlite, type PGliteOptions } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import type {
  DatabaseAdapter,
  DatabaseCapabilities,
  DatabaseHealth,
  DatabaseSession,
  DemoDatabase,
} from "../database-types.js";
import { schema } from "../schema.js";

interface VersionRow extends Record<string, unknown> {
  readonly pg_version: string;
  readonly vector_version: string | null;
  readonly migration_version: string | null;
}

export class PgliteDatabaseAdapter implements DatabaseAdapter {
  readonly capabilities: DatabaseCapabilities = {
    advisoryLocks: false,
    authoritative: false,
    concurrentTransactions: false,
    hnswVectorIndex: false,
  };

  readonly database: DatabaseSession;
  readonly demoDatabase: DemoDatabase;
  readonly client: PGlite;

  constructor(client: PGlite) {
    this.client = client;
    this.demoDatabase = drizzle(client, { schema });
    this.database = this.demoDatabase as unknown as DatabaseSession;
  }

  static async create(
    dataDir: string | undefined = undefined,
    options: PGliteOptions = {},
  ): Promise<PgliteDatabaseAdapter> {
    const client = await PGlite.create(dataDir, {
      ...options,
      extensions: { ...options.extensions, vector },
    });

    return new PgliteDatabaseAdapter(client);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async healthCheck(): Promise<DatabaseHealth> {
    const result = await this.demoDatabase.execute<VersionRow>(sql`
      SELECT
        current_setting('server_version') AS pg_version,
        (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS vector_version,
        (SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1) AS migration_version
    `);
    const row = result.rows[0];

    return {
      dialect: "pglite",
      migrationVersion: row?.migration_version ?? null,
      ok: row !== undefined && row.vector_version !== null,
      pgVersion: row?.pg_version ?? "unknown",
      vectorVersion: row?.vector_version ?? null,
    };
  }

  async transaction<T>(work: (database: DatabaseSession) => Promise<T>): Promise<T> {
    return this.demoDatabase.transaction(async (transaction) =>
      work(transaction as unknown as DatabaseSession),
    );
  }
}
