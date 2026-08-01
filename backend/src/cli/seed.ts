import { parseServerEnvironment } from "@spotter/config";

import { demoSeedDataset } from "../../../fixtures/demo/index.js";
import {
  PgliteDatabaseAdapter,
  PostgresDatabaseAdapter,
  seedDemoDatabase,
} from "../infrastructure/database/index.js";

const environment = parseServerEnvironment(process.env);

if (environment.DATA_POLICY !== "synthetic_only") {
  throw new Error("The V1 seed command refuses non-synthetic data policies.");
}

const adapter =
  environment.DATABASE_MODE === "pglite"
    ? await PgliteDatabaseAdapter.create(environment.PGLITE_DATA_DIR)
    : PostgresDatabaseAdapter.connect(environment.DATABASE_URL);

try {
  const summary = await seedDemoDatabase(adapter.database, demoSeedDataset);
  process.stdout.write(`${JSON.stringify({ event: "demo_seed_complete", ...summary })}\n`);
} finally {
  await adapter.close();
}
