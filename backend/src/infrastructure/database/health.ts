import type { DatabaseAdapter, DatabaseHealth } from "./database-types.js";

export async function checkDatabaseHealth(adapter: DatabaseAdapter): Promise<DatabaseHealth> {
  return adapter.healthCheck();
}

export async function requireHealthyDatabase(adapter: DatabaseAdapter): Promise<DatabaseHealth> {
  const health = await adapter.healthCheck();
  if (!health.ok) {
    throw new Error(
      `Database is not ready (${health.dialect}, pg=${health.pgVersion}, vector=${health.vectorVersion ?? "missing"}).`,
    );
  }

  return health;
}
