import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Options, type Sql } from "postgres";

import type {
  DatabaseAdapter,
  DatabaseCapabilities,
  DatabaseHealth,
  DatabaseSession,
  PostgresDatabase,
} from "../database-types";
import { schema } from "../schema";

interface VersionRow extends Record<string, unknown> {
  readonly pg_version: string;
  readonly vector_version: string | null;
  readonly migration_version: string | null;
}

const defaultMaximumConnections = 32;

export class PostgresDatabaseAdapter implements DatabaseAdapter {
  readonly capabilities: DatabaseCapabilities = {
    advisoryLocks: true,
    authoritative: true,
    concurrentTransactions: true,
    hnswVectorIndex: true,
  };

  readonly database: PostgresDatabase;
  readonly client: Sql;

  constructor(client: Sql) {
    this.client = client;
    this.database = drizzle(client, { schema });
  }

  static connect(
    connectionString: string,
    options: Options<Record<string, never>> = {},
  ): PostgresDatabaseAdapter {
    const client = postgres(connectionString, {
      connect_timeout: 10,
      idle_timeout: 20,
      max: defaultMaximumConnections,
      max_lifetime: 60 * 30,
      prepare: false,
      ...options,
    });

    return new PostgresDatabaseAdapter(client);
  }

  async close(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }

  async healthCheck(): Promise<DatabaseHealth> {
    const result = await this.database.execute<VersionRow>(sql`
      SELECT
        current_setting('server_version') AS pg_version,
        (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS vector_version,
        (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1) AS migration_version
    `);
    const row = result[0];

    return {
      dialect: "postgres",
      migrationVersion: row?.migration_version ?? null,
      ok: row !== undefined && row.vector_version !== null,
      pgVersion: row?.pg_version ?? "unknown",
      vectorVersion: row?.vector_version ?? null,
    };
  }

  async transaction<T>(work: (database: DatabaseSession) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => work(transaction as DatabaseSession));
  }
}
