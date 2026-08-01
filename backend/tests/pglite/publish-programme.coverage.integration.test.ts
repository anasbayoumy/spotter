import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEMO_ANCHOR, demoSeedDataset } from "../../../fixtures/demo/index.js";
import {
  DatabaseInvariantError,
  DrizzleUnitOfWork,
  PgliteDatabaseAdapter,
  PublishProgrammeTransaction,
  coachActions,
  idempotencyRecords,
  isUniqueViolation,
  migratePgliteDatabase,
  programmes,
  seedDemoDatabase,
  sessions,
  type DatabaseCapabilities,
  type DatabaseSession,
  type PublishProgrammeCommand,
  type UnitOfWork,
} from "../../src/infrastructure/database/index.js";

const COACH_ID = "00000000-0000-4000-8000-000000000001";
const HEALTHY_CLIENT_ID = "00000000-0000-4000-8000-000000000101";
const BLOCKED_PROGRAMME_ID = "00000000-0000-4000-8000-000000000602";
const ATTENTION_PROGRAMME_ID = "00000000-0000-4000-8000-000000000606";
const PUBLISHED_PROGRAMME_ID = "00000000-0000-4000-8000-000000000601";
const CANDIDATE_ID = "00000000-0000-4000-8000-000000009101";
const SESSION_ID = "00000000-0000-4000-8000-000000009102";

interface CauseNode {
  cause?: unknown;
  code?: unknown;
}

async function expectDatabaseError(
  operation: Promise<unknown>,
  expectedCode: string,
): Promise<DatabaseInvariantError> {
  try {
    await operation;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DatabaseInvariantError);
    if (error instanceof DatabaseInvariantError) {
      expect(error.code).toBe(expectedCode);
      return error;
    }
    throw error;
  }
  throw new Error(`Expected database error ${expectedCode}`);
}

function command(overrides: Partial<PublishProgrammeCommand> = {}): PublishProgrammeCommand {
  return {
    actionId: "00000000-0000-4000-8000-000000009201",
    approval: "standard",
    approvedAt: DEMO_ANCHOR,
    candidateProgrammeId: BLOCKED_PROGRAMME_ID,
    coachId: COACH_ID,
    idempotencyKey: "publish-coverage",
    idempotencyRecordId: "00000000-0000-4000-8000-000000009202",
    requestHash: "sha256:publish-coverage",
    requestId: "request-publish-coverage",
    sessions: [],
    ...overrides,
  };
}

class AdvisoryPgliteUnitOfWork implements UnitOfWork {
  public readonly capabilities: DatabaseCapabilities = {
    advisoryLocks: true,
    authoritative: false,
    concurrentTransactions: false,
    hnswVectorIndex: false,
  };

  public constructor(private readonly adapter: PgliteDatabaseAdapter) {}

  public run<T>(work: (database: DatabaseSession) => Promise<T>): Promise<T> {
    return this.adapter.transaction(work);
  }
}

describe("database unique-violation classification", () => {
  it("recognizes direct and wrapped SQLSTATE while terminating cycles and deep chains", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(isUniqueViolation(null)).toBe(false);

    const cycle: CauseNode = {};
    cycle.cause = cycle;
    expect(isUniqueViolation(cycle)).toBe(false);

    const root: CauseNode = {};
    let cursor = root;
    for (let depth = 0; depth < 8; depth += 1) {
      const next: CauseNode = {};
      cursor.cause = next;
      cursor = next;
    }
    cursor.code = "23505";
    expect(isUniqueViolation(root)).toBe(false);
  });
});

describe("PGlite programme publication coverage", () => {
  let adapter: PgliteDatabaseAdapter;

  beforeEach(async () => {
    adapter = await PgliteDatabaseAdapter.create();
    await migratePgliteDatabase(adapter, "migrations");
    await seedDemoDatabase(adapter.database, demoSeedDataset);
  });

  afterEach(async () => {
    await adapter.close();
  });

  async function insertHealthyCandidate(): Promise<void> {
    await adapter.database.insert(programmes).values({
      clientId: HEALTHY_CLIENT_ID,
      id: CANDIDATE_ID,
      mesocycle: 1,
      payload: { days: [{ focus: "coverage" }] },
      reviewBand: "clear",
      status: "queued",
      version: 2,
      week: 1,
      weekStart: "2026-08-03",
    });
  }

  it("rejects both malformed shapes of a completed idempotency response", async () => {
    const publisher = new PublishProgrammeTransaction(new DrizzleUnitOfWork(adapter));
    const records = [
      {
        id: "00000000-0000-4000-8000-000000009211",
        key: "missing-programme-id",
        response: { status: "published" },
      },
      {
        id: "00000000-0000-4000-8000-000000009212",
        key: "wrong-status",
        response: { programmeId: BLOCKED_PROGRAMME_ID, status: "failed" },
      },
    ] as const;

    for (const record of records) {
      await adapter.database.insert(idempotencyRecords).values({
        actorScope: COACH_ID,
        completedAt: DEMO_ANCHOR,
        id: record.id,
        key: record.key,
        operationScope: "programme.publish",
        requestHash: `sha256:${record.key}`,
        response: record.response,
        responseStatus: 200,
        state: "completed",
      });

      await expectDatabaseError(
        publisher.execute(
          command({
            idempotencyKey: record.key,
            idempotencyRecordId: record.id,
            requestHash: `sha256:${record.key}`,
          }),
        ),
        "dependency_unavailable",
      );
    }
  });

  it("rolls back the idempotency claim for a missing candidate", async () => {
    const publisher = new PublishProgrammeTransaction(new DrizzleUnitOfWork(adapter));
    const missingId = "00000000-0000-4000-8000-000000009299";

    await expectDatabaseError(
      publisher.execute(command({ candidateProgrammeId: missingId })),
      "not_found",
    );
    expect(
      await adapter.database.query.idempotencyRecords.findFirst({
        where: eq(idempotencyRecords.id, command().idempotencyRecordId),
      }),
    ).toBeUndefined();
  });

  it("rejects a stale candidate that is no longer queued", async () => {
    const publisher = new PublishProgrammeTransaction(new DrizzleUnitOfWork(adapter));

    await expectDatabaseError(
      publisher.execute(command({ candidateProgrammeId: PUBLISHED_PROGRAMME_ID })),
      "invalid_state_transition",
    );
  });

  it("requires override for blocked candidates and rejects override elsewhere", async () => {
    const publisher = new PublishProgrammeTransaction(new DrizzleUnitOfWork(adapter));

    await expectDatabaseError(publisher.execute(command()), "blocked_requires_override");
    await expectDatabaseError(
      publisher.execute(
        command({
          actionId: "00000000-0000-4000-8000-000000009221",
          approval: "override",
          candidateProgrammeId: ATTENTION_PROGRAMME_ID,
          idempotencyKey: "override-attention",
          idempotencyRecordId: "00000000-0000-4000-8000-000000009222",
          reason: "A reason cannot make a non-blocked override valid.",
          requestHash: "sha256:override-attention",
        }),
      ),
      "invalid_state_transition",
    );
  });

  it("rejects both absent and whitespace-only blocked override reasons", async () => {
    const publisher = new PublishProgrammeTransaction(new DrizzleUnitOfWork(adapter));

    await expectDatabaseError(
      publisher.execute(command({ approval: "override" })),
      "override_reason_required",
    );
    await expectDatabaseError(
      publisher.execute(
        command({
          actionId: "00000000-0000-4000-8000-000000009231",
          approval: "override",
          idempotencyKey: "blank-override",
          idempotencyRecordId: "00000000-0000-4000-8000-000000009232",
          reason: "   ",
          requestHash: "sha256:blank-override",
        }),
      ),
      "override_reason_required",
    );
  });

  it("publishes with an advisory lock, supersedes atomically, materializes, audits, and replays", async () => {
    await insertHealthyCandidate();
    const publisher = new PublishProgrammeTransaction(new AdvisoryPgliteUnitOfWork(adapter));
    const publish = command({
      candidateProgrammeId: CANDIDATE_ID,
      sessions: [
        {
          id: SESSION_ID,
          planned: { sets: 4 },
          scheduledFor: "2026-08-04",
          sessionKey: "coverage-day-1",
        },
      ],
    });

    const first = await publisher.execute(publish);
    const replay = await publisher.execute(publish);
    const previous = await adapter.database.query.programmes.findFirst({
      where: eq(programmes.id, PUBLISHED_PROGRAMME_ID),
    });
    const candidate = await adapter.database.query.programmes.findFirst({
      where: eq(programmes.id, CANDIDATE_ID),
    });
    const materialized = await adapter.database.query.sessions.findFirst({
      where: eq(sessions.id, SESSION_ID),
    });
    const action = await adapter.database.query.coachActions.findFirst({
      where: eq(coachActions.id, publish.actionId),
    });
    const idempotency = await adapter.database.query.idempotencyRecords.findFirst({
      where: eq(idempotencyRecords.id, publish.idempotencyRecordId),
    });

    expect(first).toEqual({ programmeId: CANDIDATE_ID, status: "published" });
    expect(replay).toEqual(first);
    expect(previous).toMatchObject({ status: "superseded", supersededBy: CANDIDATE_ID });
    expect(candidate).toMatchObject({
      approvalKind: "standard",
      approvedBy: COACH_ID,
      status: "published",
    });
    expect(materialized).toMatchObject({
      clientId: HEALTHY_CLIENT_ID,
      programmeId: CANDIDATE_ID,
      sessionKey: "coverage-day-1",
    });
    expect(action).toMatchObject({ action: "approved", reason: null });
    expect(idempotency).toMatchObject({ responseStatus: 200, state: "completed" });
  });

  it("trims and audits a valid blocked override without sessions", async () => {
    const publisher = new PublishProgrammeTransaction(new DrizzleUnitOfWork(adapter));
    const publish = command({
      approval: "override",
      reason: "  Coach accepted the constrained alternative.  ",
    });

    await expect(publisher.execute(publish)).resolves.toEqual({
      programmeId: BLOCKED_PROGRAMME_ID,
      status: "published",
    });
    await expect(publisher.execute(publish)).resolves.toEqual({
      programmeId: BLOCKED_PROGRAMME_ID,
      status: "published",
    });
    expect(
      await adapter.database.query.coachActions.findFirst({
        where: eq(coachActions.id, publish.actionId),
      }),
    ).toMatchObject({
      action: "overrode_block",
      reason: "Coach accepted the constrained alternative.",
    });
  });

  it("maps a unique audit failure and rolls back every preceding write", async () => {
    await insertHealthyCandidate();
    const publisher = new PublishProgrammeTransaction(new DrizzleUnitOfWork(adapter));
    const publish = command({
      actionId: "00000000-0000-4000-8000-000000001301",
      candidateProgrammeId: CANDIDATE_ID,
      idempotencyKey: "rollback-on-audit-conflict",
      idempotencyRecordId: "00000000-0000-4000-8000-000000009242",
      requestHash: "sha256:rollback-on-audit-conflict",
      sessions: [
        {
          id: SESSION_ID,
          planned: { sets: 4 },
          scheduledFor: "2026-08-04",
          sessionKey: "rollback-day-1",
        },
      ],
    });

    await expectDatabaseError(publisher.execute(publish), "publication_conflict");

    const previous = await adapter.database.query.programmes.findFirst({
      where: eq(programmes.id, PUBLISHED_PROGRAMME_ID),
    });
    const candidate = await adapter.database.query.programmes.findFirst({
      where: eq(programmes.id, CANDIDATE_ID),
    });
    const materialized = await adapter.database.query.sessions.findFirst({
      where: eq(sessions.id, SESSION_ID),
    });
    const idempotency = await adapter.database.query.idempotencyRecords.findFirst({
      where: and(
        eq(idempotencyRecords.operationScope, "programme.publish"),
        eq(idempotencyRecords.key, publish.idempotencyKey),
      ),
    });

    expect(previous).toMatchObject({ status: "published", supersededBy: null });
    expect(candidate).toMatchObject({ status: "queued", supersededBy: null });
    expect(materialized).toBeUndefined();
    expect(idempotency).toBeUndefined();
  });
});
