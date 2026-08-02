import { parseServerEnvironment } from "@spotter/config";
import { eq } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";

import { demoSeedDataset } from "../../resources/demo/index.js";
import { createBackend } from "../../src/composition/create-backend.js";
import {
  PgliteDatabaseAdapter,
  clients,
  coaches,
  migratePgliteDatabase,
  seedDemoDatabase,
} from "../../src/infrastructure/database/index.js";

const migrationsFolder = new URL("../../migrations", import.meta.url).pathname;
const environment = parseServerEnvironment({
  AI_MODE: "recorded",
  APP_ENV: "test",
  DATABASE_MODE: "pglite",
  DATA_POLICY: "synthetic_only",
  MIGRATIONS_DIR: migrationsFolder,
  PGLITE_DATA_DIR: "memory://",
});
const logger = pino({ enabled: false });

async function seededAdapter(): Promise<PgliteDatabaseAdapter> {
  const adapter = await PgliteDatabaseAdapter.create();
  await migratePgliteDatabase(adapter, migrationsFolder);
  await seedDemoDatabase(adapter.database, demoSeedDataset);
  return adapter;
}

describe("backend composition fail-closed startup", () => {
  it("migrates and seeds an explicitly supplied PGlite adapter", async () => {
    const adapter = await PgliteDatabaseAdapter.create();
    const runtime = await createBackend({
      adapter,
      environment,
      logger,
      migrationsFolder,
      recordings: [],
      seed: true,
    });

    const health = await runtime.adapter.healthCheck();
    expect(health.ok).toBe(true);
    expect(typeof health.migrationVersion).toBe("string");
    await expect(
      runtime.facade.clients.list(
        { limit: 25, status: "active" },
        {
          effectiveAt: new Date("2026-08-02T12:00:00.000Z"),
          requestId: "request-composition-coverage",
        },
      ),
    ).resolves.toHaveLength(7);
    await runtime.adapter.close();
  });

  it("closes and refuses an active non-synthetic record", async () => {
    const adapter = await seededAdapter();
    await adapter.database
      .update(clients)
      .set({ dataClassification: "non_synthetic" })
      .where(eq(clients.id, "00000000-0000-4000-8000-000000000107"));

    await expect(
      createBackend({
        adapter,
        environment,
        logger,
        migrationsFolder,
        recordings: [],
        seed: false,
      }),
    ).rejects.toThrow("Synthetic-only startup refused active non-synthetic data.");
  });

  it("closes and refuses startup when the configured demo coach is unavailable", async () => {
    const adapter = await seededAdapter();
    await adapter.database
      .update(coaches)
      .set({ handle: "renamed_demo_coach" })
      .where(eq(coaches.handle, "coach_demo"));

    await expect(
      createBackend({
        adapter,
        environment,
        logger,
        migrationsFolder,
        recordings: [],
        seed: false,
      }),
    ).rejects.toThrow("The seeded demo coach is unavailable.");
  });
});
