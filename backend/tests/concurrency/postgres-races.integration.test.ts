import type { ActualExercise } from "@spotter/contracts";
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEMO_COACH_ID, demoSeedDataset } from "../../../fixtures/demo/index.js";
import {
  ApplicationError,
  CreateCheckIn,
  type ExecutionContext,
  type FingerprintPort,
} from "../../src/application/index.js";
import type { RedFlagPort } from "../../src/application/ports.js";
import {
  DatabaseInvariantError,
  DrizzleUnitOfWork,
  PostgresDatabaseAdapter,
  PublishProgrammeTransaction,
  accountabilityStates,
  adjustmentTriggers,
  checkIns,
  clients,
  coachActions,
  contextTraces,
  engagementScores,
  idempotencyRecords,
  jobRuns,
  messageGuards,
  messages,
  migratePostgresDatabase,
  programmes,
  seedDemoDatabase,
  sessions,
  agentRuns,
  type PublishProgrammeCommand,
} from "../../src/infrastructure/database/index.js";
import {
  BufferedAgentAuditRepository,
  DrizzleAccountabilityRepository,
  DrizzleAdjustmentTriggerRepository,
  DrizzleApplicationIdempotencyRepository,
  DrizzleCheckInRepository,
  DrizzleJobRepository,
  DrizzleProgrammeApplicationRepository,
  DrizzleSessionRepository,
} from "../../src/infrastructure/database/repositories/application-repositories.js";

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is required for PostgreSQL concurrency tests");
}

const effectiveAt = new Date("2026-10-05T08:00:00.000Z");
const exerciseId = "10000000-0000-4000-8000-000000000001";
const plannedExercises = [
  {
    family: "horizontal_pull",
    id: exerciseId,
    muscleGroups: ["back"],
    name: "Synthetic row",
    notes: null,
    reps: 8,
    restSeconds: 90,
    rpe: 7,
    sets: 4,
  },
];
const fixtureWeekStart = "2026-10-05";
const payload = {
  days: [
    {
      dayIndex: 1,
      exercises: plannedExercises,
      focus: "Deterministic race fixture",
      scheduledDate: fixtureWeekStart,
    },
  ],
  summary: "Synthetic PostgreSQL concurrency fixture.",
};

function uuid(value: number): string {
  return `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, resolve: release };
}

type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly error: unknown; readonly ok: false };

async function outcome<T>(operation: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await operation };
  } catch (error: unknown) {
    return { error, ok: false };
  }
}

function codeOf(result: Outcome<unknown>): string | null {
  if (result.ok) return null;
  if (result.error instanceof ApplicationError || result.error instanceof DatabaseInvariantError) {
    return result.error.code;
  }
  return result.error instanceof Error ? result.error.name : "unknown_error";
}

interface Fixture {
  readonly clientId: string;
  readonly programmeId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly traceId: string;
  readonly weekStart: string;
}

describe("authoritative PostgreSQL race invariants", () => {
  let adapter: PostgresDatabaseAdapter;

  beforeAll(async () => {
    adapter = PostgresDatabaseAdapter.connect(databaseUrl, { max: 20 });
    await migratePostgresDatabase(adapter, "migrations");
    await seedDemoDatabase(adapter.database, demoSeedDataset);
  });

  afterAll(async () => {
    await adapter.close();
  });

  async function createFixture(
    fixtureNumber: number,
    status: "published" | "queued",
  ): Promise<Fixture> {
    const base = 900_000 + fixtureNumber * 100;
    const clientId = uuid(base + 1);
    const traceId = uuid(base + 2);
    const runId = uuid(base + 3);
    const programmeId = uuid(base + 4);
    const sessionId = uuid(base + 5);
    const weekStart = fixtureWeekStart;
    await adapter.database.insert(clients).values({
      coachId: DEMO_COACH_ID,
      dataClassification: "synthetic",
      goals: { primary: "Exercise concurrency safely", secondary: [], targetDate: null },
      handle: `c_${String(800 + fixtureNumber)}`,
      id: clientId,
      profile: {
        ageBand: "25_34",
        equipment: ["rower"],
        sessionsPerWeek: 1,
        sex: "not_specified",
        trainingAgeMonths: 12,
      },
      status: "active",
      syntheticLabel: `Concurrency fixture ${String(fixtureNumber)}`,
      timezone: "Africa/Cairo",
    });
    await adapter.database.insert(contextTraces).values({
      budget: 1_000,
      clientId,
      effectiveAt,
      id: traceId,
      intent: "programme",
      rendered: "Synthetic concurrency context.",
      selected: { sections: [] },
      tokenCount: 20,
      turnId: uuid(base + 6),
    });
    await adapter.database.insert(agentRuns).values({
      agent: "programme",
      attemptKey: `concurrency-fixture-${String(fixtureNumber)}`,
      id: runId,
      latencyMs: 1,
      model: "recorded/concurrency",
      output: { citations: [], payload },
      promptVersion: "concurrency-v1",
      status: "succeeded",
      traceId,
    });
    await adapter.database.insert(programmes).values({
      ...(status === "published"
        ? {
            approvalKind: "standard" as const,
            approvedAt: effectiveAt,
            approvedBy: DEMO_COACH_ID,
            validFrom: effectiveAt,
          }
        : {}),
      clientId,
      generatedBy: runId,
      id: programmeId,
      mesocycle: 1,
      payload,
      reviewBand: "clear",
      status,
      version: 1,
      week: 1,
      weekStart,
    });
    return { clientId, programmeId, runId, sessionId, traceId, weekStart };
  }

  function publicationCommand(
    fixture: Fixture,
    programmeId: string,
    discriminator: number,
  ): PublishProgrammeCommand {
    return {
      actionId: uuid(980_000 + discriminator * 10 + 1),
      approval: "standard",
      approvedAt: effectiveAt,
      candidateProgrammeId: programmeId,
      coachId: DEMO_COACH_ID,
      idempotencyKey: `publication-race-${String(discriminator)}`,
      idempotencyRecordId: uuid(980_000 + discriminator * 10 + 2),
      requestHash: `publication:${programmeId}`,
      requestId: `request-publication-${String(discriminator)}`,
      sessions: [
        {
          id: uuid(980_000 + discriminator * 10 + 3),
          planned: plannedExercises,
          scheduledFor: fixture.weekStart,
          sessionKey: "day-1",
        },
      ],
    };
  }

  async function waitForLockWaiters(minimum: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const rows = await adapter.client<{ total: number }[]>`
        SELECT count(*)::int AS total
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
      `;
      if ((rows[0]?.total ?? 0) >= minimum) return;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    }
    throw new Error(`Timed out waiting for ${String(minimum)} PostgreSQL lock waiters.`);
  }

  async function holdProgrammeRow(programmeId: string): Promise<{
    readonly done: Promise<unknown>;
    readonly release: () => void;
  }> {
    const acquired = deferred();
    const release = deferred();
    const done = adapter.client.begin(async (transaction) => {
      await transaction`SELECT id FROM programmes WHERE id = ${programmeId} FOR UPDATE`;
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;
    return { done, release: release.resolve };
  }

  async function holdSessionRow(sessionId: string): Promise<{
    readonly done: Promise<unknown>;
    readonly release: () => void;
  }> {
    const acquired = deferred();
    const release = deferred();
    const done = adapter.client.begin(async (transaction) => {
      await transaction`SELECT id FROM sessions WHERE id = ${sessionId} FOR UPDATE`;
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;
    return { done, release: release.resolve };
  }

  async function holdPublicationSlot(fixture: Fixture): Promise<{
    readonly done: Promise<unknown>;
    readonly release: () => void;
  }> {
    const acquired = deferred();
    const release = deferred();
    const slot = `${fixture.clientId}:${fixture.weekStart}`;
    const done = adapter.client.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${slot}, 0))`;
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;
    return { done, release: release.resolve };
  }

  it("QA-CON-001 publishes one action/session when two approvals hit the same draft", async () => {
    const fixture = await createFixture(1, "queued");
    const blocker = await holdProgrammeRow(fixture.programmeId);
    const publisher = new PublishProgrammeTransaction(new DrizzleUnitOfWork(adapter));
    const attempts = [
      outcome(publisher.execute(publicationCommand(fixture, fixture.programmeId, 1))),
      outcome(publisher.execute(publicationCommand(fixture, fixture.programmeId, 2))),
    ];
    await waitForLockWaiters(2);
    blocker.release();
    await blocker.done;
    const results = await Promise.all(attempts);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.map(codeOf).filter((code) => code !== null)).toEqual([
      "invalid_state_transition",
    ]);
    const [actionCount, sessionCount, completedClaims] = await Promise.all([
      adapter.database
        .select({ value: count() })
        .from(coachActions)
        .where(eq(coachActions.programmeId, fixture.programmeId)),
      adapter.database
        .select({ value: count() })
        .from(sessions)
        .where(eq(sessions.programmeId, fixture.programmeId)),
      adapter.database
        .select({ value: count() })
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.operationScope, "programme.publish"),
            eq(idempotencyRecords.state, "completed"),
          ),
        ),
    ]);
    expect(actionCount[0]?.value).toBe(1);
    expect(sessionCount[0]?.value).toBe(1);
    expect(completedClaims[0]?.value).toBeGreaterThanOrEqual(1);
  });

  it("QA-CON-002 rolls one competing draft back instead of publishing both in sequence", async () => {
    const fixture = await createFixture(2, "published");
    const firstCandidate = uuid(900_207);
    const secondCandidate = uuid(900_208);
    await adapter.database.insert(programmes).values([
      {
        clientId: fixture.clientId,
        generatedBy: fixture.runId,
        id: firstCandidate,
        mesocycle: 1,
        payload,
        reviewBand: "clear",
        status: "queued",
        version: 2,
        week: 1,
        weekStart: fixture.weekStart,
      },
      {
        clientId: fixture.clientId,
        generatedBy: fixture.runId,
        id: secondCandidate,
        mesocycle: 1,
        payload,
        reviewBand: "clear",
        status: "queued",
        version: 3,
        week: 1,
        weekStart: fixture.weekStart,
      },
    ]);
    const blocker = await holdPublicationSlot(fixture);
    const publisher = new PublishProgrammeTransaction(new DrizzleUnitOfWork(adapter));
    const attempts = [
      outcome(publisher.execute(publicationCommand(fixture, firstCandidate, 3))),
      outcome(publisher.execute(publicationCommand(fixture, secondCandidate, 4))),
    ];
    await waitForLockWaiters(2);
    blocker.release();
    await blocker.done;
    const results = await Promise.all(attempts);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.map(codeOf).filter((code) => code !== null)).toEqual(["publication_conflict"]);
    const rows = await adapter.database
      .select()
      .from(programmes)
      .where(eq(programmes.clientId, fixture.clientId));
    expect(
      rows.filter((row) => row.status === "published" && row.supersededBy === null),
    ).toHaveLength(1);
    expect(rows.filter((row) => row.status === "queued")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "superseded")).toHaveLength(1);
    const actions = await adapter.database
      .select()
      .from(coachActions)
      .where(eq(coachActions.clientId, fixture.clientId));
    expect(actions).toHaveLength(1);
  });

  it("QA-CON-003 makes approval win over a stale concurrent edit without lost lifecycle state", async () => {
    const fixture = await createFixture(3, "queued");
    const blocker = await holdProgrammeRow(fixture.programmeId);
    const repository = new DrizzleProgrammeApplicationRepository(
      adapter,
      new BufferedAgentAuditRepository(adapter.database),
    );
    const context = (suffix: string): ExecutionContext => ({
      actorId: DEMO_COACH_ID,
      effectiveAt,
      idempotencyKey: `edit-approval-${suffix}`,
      requestId: `request-edit-approval-${suffix}`,
    });
    const approval = outcome(
      repository.publish({
        approval: "standard",
        context: context("approve"),
        expectedVersion: 1,
        programmeId: fixture.programmeId,
        reason: undefined,
      }),
    );
    await waitForLockWaiters(1);
    const edit = outcome(
      repository.edit({
        band: "clear",
        context: context("edit"),
        expectedVersion: 1,
        gates: [],
        payload: { ...payload, summary: "A stale concurrent edit must not overwrite approval." },
        programmeId: fixture.programmeId,
      }),
    );
    await waitForLockWaiters(2);
    blocker.release();
    await blocker.done;
    const [approvalResult, editResult] = await Promise.all([approval, edit]);

    expect(approvalResult.ok).toBe(true);
    expect(codeOf(editResult)).toBe("version_conflict");
    const stored = await adapter.database.query.programmes.findFirst({
      where: eq(programmes.id, fixture.programmeId),
    });
    expect(stored?.status).toBe("published");
    const rows = await adapter.database
      .select({ value: count() })
      .from(programmes)
      .where(eq(programmes.clientId, fixture.clientId));
    expect(rows[0]?.value).toBe(1);
  });

  it("QA-CON-003 prevents a queued rejection from overwriting a concurrent approval", async () => {
    const fixture = await createFixture(11, "queued");
    const blocker = await holdProgrammeRow(fixture.programmeId);
    const repository = new DrizzleProgrammeApplicationRepository(
      adapter,
      new BufferedAgentAuditRepository(adapter.database),
    );
    const context = (suffix: string): ExecutionContext => ({
      actorId: DEMO_COACH_ID,
      effectiveAt,
      idempotencyKey: `reject-approval-${suffix}`,
      requestId: `request-reject-approval-${suffix}`,
    });
    const approval = outcome(
      repository.publish({
        approval: "standard",
        context: context("approve"),
        expectedVersion: 1,
        programmeId: fixture.programmeId,
        reason: undefined,
      }),
    );
    await waitForLockWaiters(1);
    const rejection = outcome(
      repository.reject({
        context: context("reject"),
        expectedVersion: 1,
        programmeId: fixture.programmeId,
        reason: "Synthetic rejection lost the race.",
      }),
    );
    await waitForLockWaiters(2);
    blocker.release();
    await blocker.done;
    const [approvalResult, rejectionResult] = await Promise.all([approval, rejection]);

    expect(approvalResult.ok).toBe(true);
    expect(codeOf(rejectionResult)).toBe("invalid_state_transition");
    const stored = await adapter.database.query.programmes.findFirst({
      where: eq(programmes.id, fixture.programmeId),
    });
    expect(stored?.status).toBe("published");
    const actions = await adapter.database
      .select()
      .from(coachActions)
      .where(eq(coachActions.programmeId, fixture.programmeId));
    expect(actions.map((action) => action.action)).toEqual(["approved"]);
  });

  it("QA-CON-004 atomically claims one idempotent operation and safely replays completion", async () => {
    const repository = new DrizzleApplicationIdempotencyRepository(adapter.database);
    const input = {
      actorId: DEMO_COACH_ID,
      key: "concurrent-generation-key",
      requestFingerprint: "sha256:concurrent-generation-input",
      scope: "programme.generate",
    };
    const gate = deferred();
    const claims = Array.from({ length: 8 }, async () => {
      await gate.promise;
      return outcome(repository.claim<{ readonly programmeId: string }>(input));
    });
    gate.resolve();
    const results = await Promise.all(claims);
    const winner = results.find((result) => result.ok && result.value.kind === "claimed");
    expect(winner?.ok).toBe(true);
    if (!winner?.ok) throw new Error("Idempotency winner is unavailable.");
    expect(results.filter((result) => codeOf(result) === "operation_in_progress")).toHaveLength(7);
    await repository.complete(winner.value.recordId, { programmeId: uuid(900_499) }, effectiveAt);
    await expect(repository.claim(input)).resolves.toMatchObject({
      kind: "completed",
      value: { programmeId: uuid(900_499) },
    });
    await expect(
      repository.claim({ ...input, requestFingerprint: "sha256:different-input" }),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
  });

  it("QA-CON-005 allows one concurrent job claimant and returns its stable completed replay", async () => {
    const repository = new DrizzleJobRepository(adapter.database);
    const runKey = "weekly-plan:2026-10-05";
    const gate = deferred();
    const claims = Array.from({ length: 8 }, async () => {
      await gate.promise;
      return outcome(repository.claim(runKey, "weekly_plan"));
    });
    gate.resolve();
    const results = await Promise.all(claims);
    expect(results.filter((result) => result.ok && result.value.kind === "claimed")).toHaveLength(
      1,
    );
    expect(results.filter((result) => codeOf(result) === "operation_in_progress")).toHaveLength(7);
    const summary = {
      failed: 0,
      processed: 7,
      runKey,
      status: "completed" as const,
      succeeded: 7,
    };
    await repository.complete(runKey, summary, effectiveAt);
    await expect(repository.claim(runKey, "weekly_plan")).resolves.toEqual({
      kind: "completed",
      value: summary,
    });
    const rows = await adapter.database
      .select({ value: count() })
      .from(jobRuns)
      .where(eq(jobRuns.stableKey, runKey));
    expect(rows[0]?.value).toBe(1);
  });

  it("QA-CON-006 serializes same-window accountability messages and reuses the winning score", async () => {
    const fixture = await createFixture(6, "published");
    const repository = new DrizzleAccountabilityRepository(
      adapter,
      new BufferedAgentAuditRepository(adapter.database),
    );
    const inputs = {
      baselineCheckInCount: 0,
      baselineCheckInLatencyHours: null,
      completedDue14d: 1,
      completedDue7d: 0,
      currentCheckInLatencyHours: null,
      daysSinceOpen: 1,
      missedDue14d: 1,
      missedDue7d: 1,
      plannedDue14d: 2,
      plannedDue7d: 1,
      rpeDrift: null,
    } as const;
    const decision = (
      suffix: string,
    ): ReturnType<DrizzleAccountabilityRepository["commitDecision"]> =>
      repository.commitDecision({
        automatedSendAllowed: true,
        clientId: fixture.clientId,
        context: {
          actorId: DEMO_COACH_ID,
          effectiveAt,
          idempotencyKey: `accountability-${suffix}`,
          requestId: `request-accountability-${suffix}`,
        },
        draftedContent: `Synthetic tier-one nudge ${suffix}.`,
        inputs,
        nextState: {
          automationPaused: false,
          churnFlagged: false,
          owner: "automation" as const,
          tier: 1 as const,
          version: 2,
        },
        runId: null,
        tier: 1,
        traceId: null,
      });
    const gate = deferred();
    const attempts = ["one", "two"].map(async (suffix) => {
      await gate.promise;
      return outcome(decision(suffix));
    });
    gate.resolve();
    const results = await Promise.all(attempts);

    expect(results.every((result) => result.ok)).toBe(true);
    const [scoreRows, messageRows, state] = await Promise.all([
      adapter.database
        .select()
        .from(engagementScores)
        .where(eq(engagementScores.clientId, fixture.clientId)),
      adapter.database.select().from(messages).where(eq(messages.clientId, fixture.clientId)),
      adapter.database.query.accountabilityStates.findFirst({
        where: eq(accountabilityStates.clientId, fixture.clientId),
      }),
    ]);
    expect(scoreRows).toHaveLength(1);
    expect(messageRows.filter((message) => message.status === "sent")).toHaveLength(1);
    expect(messageRows.filter((message) => message.status === "suppressed")).toHaveLength(1);
    expect(messageRows.every((message) => message.engagementScoreId === scoreRows[0]?.id)).toBe(
      true,
    );
    expect(state?.latestScoreId).toBe(scoreRows[0]?.id);
  });

  it("QA-CON-007 rejects losing concurrent session logs instead of returning another payload", async () => {
    const fixture = await createFixture(7, "published");
    await adapter.database.insert(sessions).values({
      clientId: fixture.clientId,
      id: fixture.sessionId,
      planned: plannedExercises,
      programmeId: fixture.programmeId,
      scheduledFor: fixture.weekStart,
      sessionKey: "day-1",
    });
    const blocker = await holdSessionRow(fixture.sessionId);
    const repository = new DrizzleSessionRepository(adapter);
    const actual = (reps: number): ActualExercise[] => [
      {
        exerciseId,
        sets: [{ completed: true, loadKg: 20, reps, rpe: 7, setIndex: 1 }],
      },
    ];
    const attempts = [8, 10].map((reps) =>
      outcome(
        repository.log({
          actual: actual(reps),
          clientId: fixture.clientId,
          context: {
            actorId: fixture.clientId,
            effectiveAt,
            idempotencyKey: `session-log-${String(reps)}`,
            requestId: `request-session-log-${String(reps)}`,
          },
          expectedVersion: 1,
          notes: null,
          sessionId: fixture.sessionId,
        }),
      ),
    );
    await waitForLockWaiters(2);
    blocker.release();
    await blocker.done;
    const results = await Promise.all(attempts);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => codeOf(result) === "version_conflict")).toHaveLength(1);
    const stored = await adapter.database.query.sessions.findFirst({
      where: eq(sessions.id, fixture.sessionId),
    });
    expect(stored?.version).toBe(2);
    expect(JSON.stringify(stored?.actual)).toMatch(/"reps":(?:8|10)/u);
  });

  it("QA-CON-007 keeps completion monotonic under different concurrent retry keys", async () => {
    const fixture = await createFixture(8, "published");
    await adapter.database.insert(sessions).values({
      actual: [
        {
          exerciseId,
          sets: [{ completed: true, loadKg: 20, reps: 8, rpe: 7, setIndex: 1 }],
        },
      ],
      clientId: fixture.clientId,
      id: fixture.sessionId,
      planned: plannedExercises,
      programmeId: fixture.programmeId,
      scheduledFor: fixture.weekStart,
      sessionKey: "day-1",
      version: 2,
    });
    const blocker = await holdSessionRow(fixture.sessionId);
    const repository = new DrizzleSessionRepository(adapter);
    const attempts = [8, 9].map((rpe) =>
      outcome(
        repository.complete({
          clientId: fixture.clientId,
          context: {
            actorId: fixture.clientId,
            effectiveAt,
            idempotencyKey: `session-complete-${String(rpe)}`,
            requestId: `request-session-complete-${String(rpe)}`,
          },
          expectedVersion: 2,
          performedAt: effectiveAt.toISOString(),
          rpe,
          sessionId: fixture.sessionId,
        }),
      ),
    );
    await waitForLockWaiters(2);
    blocker.release();
    await blocker.done;
    const results = await Promise.all(attempts);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => codeOf(result) === "version_conflict")).toHaveLength(1);
    const stored = await adapter.database.query.sessions.findFirst({
      where: eq(sessions.id, fixture.sessionId),
    });
    expect(stored).toMatchObject({ status: "completed", version: 3 });
    expect([8, 9]).toContain(stored?.rpe);
  });

  it("QA-CON-007 idempotently stores one check-in and one adjustment trigger", async () => {
    const fixture = await createFixture(9, "published");
    const idempotency = new DrizzleApplicationIdempotencyRepository(adapter.database);
    const fingerprint: FingerprintPort = { fingerprint: (value) => JSON.stringify(value) };
    const redFlags: RedFlagPort = {
      escalate: () => Promise.resolve(),
      hasRedFlag: () => false,
    };
    const useCase = new CreateCheckIn(
      new DrizzleCheckInRepository(adapter),
      redFlags,
      new DrizzleAdjustmentTriggerRepository(adapter.database),
      { fingerprint, idempotency },
    );
    const context: ExecutionContext = {
      actorId: fixture.clientId,
      effectiveAt,
      idempotencyKey: "same-check-in-retry",
      requestId: "request-check-in-race",
    };
    const input = {
      body: "Synthetic low readiness only.",
      clientId: fixture.clientId,
      readiness: 2,
      respondedAt: effectiveAt.toISOString(),
    };
    const gate = deferred();
    const attempts = Array.from({ length: 4 }, async () => {
      await gate.promise;
      return outcome(useCase.execute(input, context));
    });
    gate.resolve();
    const results = await Promise.all(attempts);
    expect(results.filter((result) => result.ok).length).toBeGreaterThanOrEqual(1);
    expect(results.every((result) => result.ok || codeOf(result) === "operation_in_progress")).toBe(
      true,
    );
    await expect(useCase.execute(input, context)).resolves.toMatchObject({ readiness: 2 });
    const [storedCheckIns, triggers] = await Promise.all([
      adapter.database
        .select({ value: count() })
        .from(checkIns)
        .where(eq(checkIns.clientId, fixture.clientId)),
      adapter.database
        .select({ value: count() })
        .from(adjustmentTriggers)
        .where(eq(adjustmentTriggers.clientId, fixture.clientId)),
    ]);
    expect(storedCheckIns[0]?.value).toBe(1);
    expect(triggers[0]?.value).toBe(1);
  });

  it("QA-CON-008 preserves coach ownership when a stale automated decision follows escalation", async () => {
    const fixture = await createFixture(10, "published");
    await adapter.database.insert(messageGuards).values({ clientId: fixture.clientId });
    await adapter.database.insert(accountabilityStates).values({
      automationPaused: false,
      churnFlagged: false,
      clientId: fixture.clientId,
      owner: "automation",
      tier: 1,
      transitionedAt: new Date(effectiveAt.getTime() - 60_000),
      version: 1,
    });
    const acquired = deferred();
    const release = deferred();
    const blocker = adapter.client.begin(async (transaction) => {
      await transaction`
        SELECT client_id FROM message_guards WHERE client_id = ${fixture.clientId} FOR UPDATE
      `;
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;
    const repository = new DrizzleAccountabilityRepository(
      adapter,
      new BufferedAgentAuditRepository(adapter.database),
    );
    const inputs = {
      baselineCheckInCount: 0,
      baselineCheckInLatencyHours: null,
      completedDue14d: 0,
      completedDue7d: 0,
      currentCheckInLatencyHours: null,
      daysSinceOpen: 8,
      missedDue14d: 2,
      missedDue7d: 1,
      plannedDue14d: 2,
      plannedDue7d: 1,
      rpeDrift: null,
    } as const;
    const commit = (
      suffix: string,
      tier: 1 | 3,
      owner: "automation" | "coach",
      automationPaused: boolean,
    ): ReturnType<DrizzleAccountabilityRepository["commitDecision"]> =>
      repository.commitDecision({
        automatedSendAllowed: tier === 1,
        clientId: fixture.clientId,
        context: {
          actorId: DEMO_COACH_ID,
          effectiveAt,
          idempotencyKey: `ownership-${suffix}`,
          requestId: `request-ownership-${suffix}`,
        },
        draftedContent: `Synthetic ${suffix} decision.`,
        inputs,
        nextState: {
          automationPaused,
          churnFlagged: false,
          owner,
          tier,
          version: 2,
        },
        runId: null,
        tier,
        traceId: null,
      });
    const escalation = outcome(commit("coach", 3, "coach", true));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
    const automation = outcome(commit("automation", 1, "automation", false));
    await waitForLockWaiters(1);
    release.resolve();
    await blocker;
    await Promise.all([escalation, automation]);

    const state = await adapter.database.query.accountabilityStates.findFirst({
      where: eq(accountabilityStates.clientId, fixture.clientId),
    });
    expect(state).toMatchObject({ automationPaused: true, owner: "coach", tier: 3 });
    const sent = await adapter.database
      .select({ value: count() })
      .from(messages)
      .where(
        and(
          eq(messages.clientId, fixture.clientId),
          eq(messages.actor, "automation"),
          eq(messages.status, "sent"),
        ),
      );
    expect(sent[0]?.value).toBe(0);
  });

  it("QA-CON-009 replays a blocked override as one reasoned publication after connection loss", async () => {
    const fixture = await createFixture(12, "queued");
    await adapter.database
      .update(programmes)
      .set({ reviewBand: "blocked" })
      .where(eq(programmes.id, fixture.programmeId));
    const blocker = await holdProgrammeRow(fixture.programmeId);
    const publisher = new PublishProgrammeTransaction(new DrizzleUnitOfWork(adapter));
    const first = publicationCommand(fixture, fixture.programmeId, 5);
    const command: PublishProgrammeCommand = {
      ...first,
      approval: "override",
      reason: "  Synthetic coach accepted the documented blocked-gate risk.  ",
      requestHash: `override:${fixture.programmeId}:1`,
    };
    const replay: PublishProgrammeCommand = {
      ...command,
      actionId: uuid(980_061),
      idempotencyRecordId: uuid(980_062),
      requestId: "request-override-replay",
      sessions: command.sessions.map((session) => ({ ...session, id: uuid(980_063) })),
    };
    const attempts = [outcome(publisher.execute(command)), outcome(publisher.execute(replay))];
    await waitForLockWaiters(2);
    blocker.release();
    await blocker.done;
    const results = await Promise.all(attempts);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => (result.ok ? result.value : null))).toEqual([
      { programmeId: fixture.programmeId, status: "published" },
      { programmeId: fixture.programmeId, status: "published" },
    ]);
    const [actions, storedSessions, claims] = await Promise.all([
      adapter.database
        .select()
        .from(coachActions)
        .where(eq(coachActions.programmeId, fixture.programmeId)),
      adapter.database.select().from(sessions).where(eq(sessions.programmeId, fixture.programmeId)),
      adapter.database
        .select()
        .from(idempotencyRecords)
        .where(eq(idempotencyRecords.key, command.idempotencyKey)),
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      action: "overrode_block",
      reason: "Synthetic coach accepted the documented blocked-gate risk.",
    });
    expect(storedSessions).toHaveLength(1);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.state).toBe("completed");
  });
});
