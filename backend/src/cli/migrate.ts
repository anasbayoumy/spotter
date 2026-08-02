import { parseServerEnvironment } from "@spotter/config";

import {
  PgliteDatabaseAdapter,
  PostgresDatabaseAdapter,
  migratePgliteDatabase,
  migratePostgresDatabase,
} from "../infrastructure/database/index.js";

const environment = parseServerEnvironment(process.env);

if (environment.DATABASE_MODE === "pglite") {
  const adapter = await PgliteDatabaseAdapter.create(environment.PGLITE_DATA_DIR);
  try {
    await migratePgliteDatabase(adapter, environment.MIGRATIONS_DIR);
  } finally {
    await adapter.close();
  }
} else {
  const adapter = PostgresDatabaseAdapter.connect(environment.DATABASE_URL);
  try {
    await migratePostgresDatabase(adapter, environment.MIGRATIONS_DIR);
  } finally {
    await adapter.close();
  }
}
