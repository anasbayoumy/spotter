import { parseServerEnvironment } from "@spotter/config";

import { demoSeedDataset } from "../../resources/demo/index.js";
import {
  PgliteDatabaseAdapter,
  migratePgliteDatabase,
  seedDemoDatabase,
} from "../infrastructure/database/index.js";

const environment = parseServerEnvironment({
  ...process.env,
  SPOTTER_MODEL_MODE: "recorded",
  ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
  APP_ENV: "demo",
  DATABASE_MODE: "pglite",
  DATA_POLICY: "synthetic_only",
});

const adapter = await PgliteDatabaseAdapter.create(environment.PGLITE_DATA_DIR);
try {
  await migratePgliteDatabase(adapter, environment.MIGRATIONS_DIR);
  const summary = await seedDemoDatabase(adapter.database, demoSeedDataset);
  const health = await adapter.healthCheck();
  process.stdout.write(`${JSON.stringify({ event: "demo_ready", health, seed: summary })}\n`);
} finally {
  await adapter.close();
}
