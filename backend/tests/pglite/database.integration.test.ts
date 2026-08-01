import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEMO_ANCHOR, demoSeedDataset } from "../../../fixtures/demo/index.js";
import {
  ClientRepository,
  ContextRepository,
  DatabaseInvariantError,
  DrizzleUnitOfWork,
  PgliteDatabaseAdapter,
  PublishProgrammeTransaction,
  contextTraces,
  migratePgliteDatabase,
  programmes,
  seedDemoDatabase,
} from "../../src/infrastructure/database/index.js";

const COACH_ID = "00000000-0000-0000-0000-000000000001";
const BLOCKED_CLIENT_ID = "00000000-0000-0000-0000-000000000102";
const EXPIRED_CLIENT_ID = "00000000-0000-0000-0000-000000000103";
const SUPERSEDED_CLIENT_ID = "00000000-0000-0000-0000-000000000104";
const BLOCKED_PROGRAMME_ID = "00000000-0000-0000-0000-000000000602";

async function expectDatabaseError(
  operation: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await operation;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DatabaseInvariantError);
    if (!(error instanceof DatabaseInvariantError)) return;
    expect(error.code).toBe(expectedCode);
    return;
  }
  throw new Error(`Expected database error ${expectedCode}`);
}

describe("PGlite database parity foundation", () => {
  let adapter: PgliteDatabaseAdapter;

  beforeEach(async () => {
    adapter = await PgliteDatabaseAdapter.create();
    await migratePgliteDatabase(adapter, "migrations");
    await seedDemoDatabase(adapter.database, demoSeedDataset);
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("migrates, loads pgvector, and seeds idempotently", async () => {
    await migratePgliteDatabase(adapter, "migrations");
    await seedDemoDatabase(adapter.database, demoSeedDataset);

    const health = await adapter.healthCheck();
    const [clientCount] = await adapter.database.select({ value: count() }).from(programmes);
    const clients = await new ClientRepository(adapter.database).listActiveSynthetic();

    expect(health.ok).toBe(true);
    expect(health.vectorVersion).not.toBeNull();
    expect(clientCount?.value).toBe(7);
    expect(clients).toHaveLength(7);
    expect(await new ClientRepository(adapter.database).hasActiveNonSyntheticData()).toBe(false);
  });

  it("filters expired and superseded context before relevance work", async () => {
    const repository = new ContextRepository(adapter.database);

    expect(await repository.findActiveHardConstraints(BLOCKED_CLIENT_ID, DEMO_ANCHOR)).toHaveLength(
      1,
    );
    expect(await repository.findActiveHardConstraints(EXPIRED_CLIENT_ID, DEMO_ANCHOR)).toHaveLength(
      0,
    );
    const notes = await repository.findEligibleNotes(SUPERSEDED_CLIENT_ID, DEMO_ANCHOR);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toContain("Current synthetic preference");
  });

  it("requires an explicit reasoned override for a blocked publication and replays safely", async () => {
    const publisher = new PublishProgrammeTransaction(new DrizzleUnitOfWork(adapter));
    const baseCommand = {
      actionId: "00000000-0000-0000-0000-000000009001",
      approvedAt: DEMO_ANCHOR,
      candidateProgrammeId: BLOCKED_PROGRAMME_ID,
      coachId: COACH_ID,
      idempotencyKey: "publish-blocked-standard",
      idempotencyRecordId: "00000000-0000-0000-0000-000000009002",
      requestHash: "sha256:blocked-standard",
      requestId: "request-blocked-standard",
      sessions: [],
    } as const;

    await expectDatabaseError(
      publisher.execute({ ...baseCommand, approval: "standard" }),
      "blocked_requires_override",
    );

    const overrideCommand = {
      ...baseCommand,
      actionId: "00000000-0000-0000-0000-000000009003",
      approval: "override" as const,
      idempotencyKey: "publish-blocked-override",
      idempotencyRecordId: "00000000-0000-0000-0000-000000009004",
      reason: "Coach reviewed the synthetic exception and accepts the constrained alternative.",
      requestHash: "sha256:blocked-override",
      requestId: "request-blocked-override",
    };
    const first = await publisher.execute(overrideCommand);
    const replay = await publisher.execute(overrideCommand);
    const published = await adapter.database.query.programmes.findFirst({
      where: eq(programmes.id, BLOCKED_PROGRAMME_ID),
    });

    expect(first).toEqual(replay);
    expect(published?.status).toBe("published");
    expect(published?.approvalKind).toBe("override");
  });

  it("keeps context trace evidence append-only", async () => {
    const traceId = "00000000-0000-0000-0000-000000000201";
    const before = await adapter.database.query.contextTraces.findFirst({
      where: eq(contextTraces.id, traceId),
    });
    expect(before).toBeDefined();

    await expect(
      adapter.database
        .update(contextTraces)
        .set({ tokenCount: 999 })
        .where(eq(contextTraces.id, traceId)),
    ).rejects.toThrow();

    const trace = await adapter.database.query.contextTraces.findFirst({
      where: eq(contextTraces.id, traceId),
    });
    expect(trace?.tokenCount).toBe(before?.tokenCount);
  });
});
