import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { Schema } from "./schema.js";

export type PostgresDatabase = PostgresJsDatabase<Schema>;
export type DemoDatabase = PgliteDatabase<Schema>;

/**
 * Both adapters use Drizzle's PostgreSQL query builders. The structural cast is intentionally
 * isolated here; release-only locking/vector guarantees remain exposed through capabilities.
 */
export type DatabaseSession = PostgresDatabase;

export interface DatabaseCapabilities {
  readonly advisoryLocks: boolean;
  readonly concurrentTransactions: boolean;
  readonly authoritative: boolean;
  readonly hnswVectorIndex: boolean;
}

export interface DatabaseHealth {
  readonly ok: boolean;
  readonly dialect: "pglite" | "postgres";
  readonly pgVersion: string;
  readonly vectorVersion: string | null;
  readonly migrationVersion: string | null;
}

export interface DatabaseAdapter {
  readonly capabilities: DatabaseCapabilities;
  readonly database: DatabaseSession;
  close(): Promise<void>;
  healthCheck(): Promise<DatabaseHealth>;
  transaction<T>(work: (database: DatabaseSession) => Promise<T>): Promise<T>;
}
