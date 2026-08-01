import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEMO_ANCHOR, DEMO_COACH_ID, demoSeedDataset } from "../../../fixtures/demo/index.js";
import {
  ClientRepository,
  PostgresDatabaseAdapter,
  coaches,
  contextTraces,
  migratePostgresDatabase,
  programmes,
  seedDemoDatabase,
} from "../../src/infrastructure/database/index.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

describe("authoritative PostgreSQL database", () => {
  let adapter: PostgresDatabaseAdapter;

  beforeAll(async () => {
    adapter = PostgresDatabaseAdapter.connect(databaseUrl, { max: 4 });
    await migratePostgresDatabase(adapter, "migrations");
    await seedDemoDatabase(adapter.database, demoSeedDataset);
  });

  afterAll(async () => {
    await adapter.close();
  });

  it("is healthy with pgvector and exactly one applied migration", async () => {
    const health = await adapter.healthCheck();
    const migrationRows = await adapter.client<{ total: number }[]>`
      SELECT count(*)::int AS total FROM drizzle.__drizzle_migrations
    `;
    const vectorIndexes = await adapter.client<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM pg_indexes
      WHERE indexname = 'client_notes_embedding_hnsw_idx'
    `;

    expect(health.ok).toBe(true);
    expect(health.dialect).toBe("postgres");
    expect(health.vectorVersion).not.toBeNull();
    expect(migrationRows[0]?.total).toBe(1);
    expect(vectorIndexes[0]?.total).toBe(1);
  });

  it("keeps repeated synthetic seeding stable", async () => {
    await seedDemoDatabase(adapter.database, demoSeedDataset);
    const [programmeCount] = await adapter.database.select({ value: count() }).from(programmes);
    const clients = new ClientRepository(adapter.database);

    expect(programmeCount?.value).toBe(7);
    expect(await clients.listActiveSynthetic()).toHaveLength(7);
    expect(await clients.hasActiveNonSyntheticData()).toBe(false);
  });

  it("enforces publication approval metadata in PostgreSQL", async () => {
    await expect(
      adapter.database.insert(programmes).values({
        clientId: "00000000-0000-0000-0000-000000000105",
        generatedBy: "00000000-0000-0000-0000-000000000215",
        id: "00000000-0000-0000-0000-000000009101",
        mesocycle: 2,
        payload: { days: [] },
        reviewBand: "clear",
        status: "published",
        version: 1,
        week: 2,
        weekStart: "2026-08-10",
      }),
    ).rejects.toThrow();
  });

  it("rolls back partial writes and protects append-only evidence", async () => {
    const temporaryCoach = "00000000-0000-0000-0000-000000009201";
    await expect(
      adapter.transaction(async (database) => {
        await database.insert(coaches).values({ handle: "rollback_probe", id: temporaryCoach });
        throw new Error("rollback probe");
      }),
    ).rejects.toThrow();

    expect(
      await adapter.database.query.coaches.findFirst({ where: eq(coaches.id, temporaryCoach) }),
    ).toBeUndefined();

    const traceId = "00000000-0000-0000-0000-000000000201";
    const before = await adapter.database.query.contextTraces.findFirst({
      where: eq(contextTraces.id, traceId),
    });
    await expect(
      adapter.database
        .update(contextTraces)
        .set({ effectiveAt: new Date(DEMO_ANCHOR.getTime() + 1_000) })
        .where(eq(contextTraces.id, traceId)),
    ).rejects.toThrow();
    const after = await adapter.database.query.contextTraces.findFirst({
      where: eq(contextTraces.id, traceId),
    });
    expect(after?.effectiveAt).toEqual(before?.effectiveAt);
  });

  it("attributes all seeded approvals to the single demo coach", async () => {
    const published = await adapter.database.query.programmes.findMany({
      where: eq(programmes.status, "published"),
    });
    expect(published.length).toBeGreaterThan(0);
    expect(published.every((programme) => programme.approvedBy === DEMO_COACH_ID)).toBe(true);
  });
});
