import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEMO_ANCHOR, demoSeedDataset } from "../../resources/demo/index.js";
import { DatabaseContextAssembler } from "../../src/composition/runtime-adapters.js";
import {
  AccountabilityRepository,
  AuditRepository,
  BufferedAgentAuditRepository,
  ClientRepository,
  ContextRepository,
  DatabaseInvariantError,
  DrizzleAccountabilityRepository,
  DrizzleAdjustmentRepository,
  DrizzleApplicationIdempotencyRepository,
  DrizzleCheckInRepository,
  DrizzleClientReadRepository,
  DrizzleJobRepository,
  DrizzleProgrammeApplicationRepository,
  DrizzleScorecardRepository,
  DrizzleSessionRepository,
  DrizzleTraceRepository,
  DrizzleUnitOfWork,
  IdempotencyRepository,
  PgliteDatabaseAdapter,
  ProgrammeRepository,
  accountabilityStates,
  agentRuns,
  checkIns,
  checkDatabaseHealth,
  clientConstraints,
  clientNotes,
  clients,
  evalResults,
  idempotencyRecords,
  jobRuns,
  messageGuards,
  messages,
  migratePgliteDatabase,
  programmes,
  requireHealthyDatabase,
  seedDemoDatabase,
  type DatabaseAdapter,
} from "../../src/infrastructure/database/index.js";

const CLIENT_ID = "00000000-0000-4000-8000-000000000101";
const COACH_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_CLIENT_ID = "00000000-0000-4000-8000-000000000107";
const PUBLISHED_PROGRAMME_ID = "00000000-0000-4000-8000-000000000601";
const TRACE_ID = "00000000-0000-4000-8000-000000008001";

async function databaseError(
  operation: Promise<unknown>,
  code: string,
): Promise<DatabaseInvariantError> {
  try {
    await operation;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DatabaseInvariantError);
    if (error instanceof DatabaseInvariantError) {
      expect(error.code).toBe(code);
      return error;
    }
    throw error;
  }
  throw new Error(`Expected database invariant ${code}`);
}

describe("PGlite infrastructure behavior coverage", () => {
  let adapter: PgliteDatabaseAdapter;

  beforeEach(async () => {
    adapter = await PgliteDatabaseAdapter.create();
    await migratePgliteDatabase(adapter, new URL("../../migrations", import.meta.url).pathname);
    await seedDemoDatabase(adapter.database, demoSeedDataset);
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("reports healthy and unhealthy database readiness with actionable detail", async () => {
    const health = await checkDatabaseHealth(adapter);
    expect(health).toMatchObject({ dialect: "pglite", ok: true });
    await expect(requireHealthyDatabase(adapter)).resolves.toEqual(health);

    const unhealthy: DatabaseAdapter = {
      capabilities: adapter.capabilities,
      close: () => Promise.resolve(),
      database: adapter.database,
      healthCheck: () =>
        Promise.resolve({
          dialect: "postgres",
          migrationVersion: null,
          ok: false,
          pgVersion: "16",
          vectorVersion: null,
        }),
      transaction: adapter.transaction.bind(adapter),
    };
    await expect(requireHealthyDatabase(unhealthy)).rejects.toThrow(
      "Database is not ready (postgres, pg=16, vector=missing).",
    );
  });

  it("queries programme review ordering, current publication, history, and missing IDs", async () => {
    const programmes = new ProgrammeRepository(adapter.database);

    await expect(programmes.findById(PUBLISHED_PROGRAMME_ID)).resolves.toMatchObject({
      id: PUBLISHED_PROGRAMME_ID,
      status: "published",
    });
    await expect(
      programmes.findById("00000000-0000-4000-8000-000000008099"),
    ).resolves.toBeUndefined();
    await expect(programmes.findCurrentPublished(CLIENT_ID, "2026-08-03")).resolves.toBeDefined();
    await expect(programmes.findCurrentPublished(CLIENT_ID, "2020-01-01")).resolves.toBeUndefined();

    const queue = await programmes.listReviewQueue();
    expect(queue.length).toBeGreaterThan(0);
    expect(queue[0]?.reviewBand).toBe("blocked");
    const history = await programmes.listHistory(CLIENT_ID);
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((entry) => entry.clientId === CLIENT_ID)).toBe(true);
  });

  it("covers synthetic client visibility and detects active non-synthetic records", async () => {
    const repository = new ClientRepository(adapter.database);
    await expect(repository.findSyntheticById(CLIENT_ID)).resolves.toMatchObject({ id: CLIENT_ID });
    await expect(
      repository.findSyntheticById("00000000-0000-4000-8000-000000008099"),
    ).resolves.toBeUndefined();
    await adapter.database
      .update(clients)
      .set({ dataClassification: "non_synthetic" })
      .where(eq(clients.id, OTHER_CLIENT_ID));
    await expect(repository.hasActiveNonSyntheticData()).resolves.toBe(true);
    expect(
      (await repository.listActiveSynthetic()).some((client) => client.id === OTHER_CLIENT_ID),
    ).toBe(false);
  });

  it("bounds context note queries and resolves the current published programme", async () => {
    const repository = new ContextRepository(adapter.database);
    await adapter.database.insert(clientNotes).values(
      Array.from({ length: 3 }, (_, index) => ({
        body: `Coverage note ${String(index)}`,
        clientId: CLIENT_ID,
        id: `00000000-0000-4000-8000-0000000081${String(index).padStart(2, "0")}`,
        source: "coach_entered" as const,
        validFrom: DEMO_ANCHOR,
      })),
    );

    await expect(repository.findEligibleNotes(CLIENT_ID, DEMO_ANCHOR, 0)).resolves.toHaveLength(1);
    expect(
      (await repository.findEligibleNotes(CLIENT_ID, DEMO_ANCHOR, 1_000)).length,
    ).toBeLessThanOrEqual(100);
    await expect(repository.findCurrentProgramme(CLIENT_ID, "2026-08-03")).resolves.toMatchObject({
      status: "published",
    });
    await expect(repository.findCurrentProgramme(CLIENT_ID, "2020-01-01")).resolves.toBeUndefined();
  });

  it("serializes automated message sending, recent suppression, and human ownership", async () => {
    const repository = new AccountabilityRepository(new DrizzleUnitOfWork(adapter));
    await adapter.database.delete(messages).where(eq(messages.clientId, CLIENT_ID));
    await adapter.database.delete(messageGuards).where(eq(messageGuards.clientId, CLIENT_ID));
    await adapter.database
      .update(accountabilityStates)
      .set({ automationPaused: false, churnFlagged: false, owner: "automation", tier: 1 })
      .where(eq(accountabilityStates.clientId, CLIENT_ID));

    await expect(
      repository.runAutomatedMessageDecision({
        attemptedAt: DEMO_ANCHOR,
        body: "Synthetic first nudge",
        clientId: CLIENT_ID,
        id: "00000000-0000-4000-8000-000000008201",
        tier: 1,
      }),
    ).resolves.toEqual({
      messageId: "00000000-0000-4000-8000-000000008201",
      status: "sent",
    });
    await expect(
      repository.runAutomatedMessageDecision({
        attemptedAt: new Date(DEMO_ANCHOR.valueOf() + 60 * 60 * 1_000),
        body: "Synthetic duplicate nudge",
        clientId: CLIENT_ID,
        id: "00000000-0000-4000-8000-000000008202",
        tier: 1,
      }),
    ).resolves.toMatchObject({ reason: "automated_message_within_48h", status: "suppressed" });

    await adapter.database
      .update(accountabilityStates)
      .set({ automationPaused: true, owner: "coach", tier: 3 })
      .where(eq(accountabilityStates.clientId, CLIENT_ID));
    await expect(
      repository.runAutomatedMessageDecision({
        attemptedAt: new Date(DEMO_ANCHOR.valueOf() + 72 * 60 * 60 * 1_000),
        body: "Synthetic human-owned attempt",
        clientId: CLIENT_ID,
        id: "00000000-0000-4000-8000-000000008203",
        tier: 2,
      }),
    ).resolves.toMatchObject({ reason: "human_owned_escalation", status: "suppressed" });

    const rows = await adapter.database
      .select()
      .from(messages)
      .where(eq(messages.clientId, CLIENT_ID));
    expect(rows.map(({ status }) => status)).toEqual(["sent", "suppressed", "suppressed"]);
  });

  it("persists trace, failed-run, successful-run, and evaluation audit evidence", async () => {
    const audit = new AuditRepository(adapter.database);
    await expect(
      audit.insertContextTrace({
        budget: 1_000,
        clientId: CLIENT_ID,
        createdAt: DEMO_ANCHOR,
        effectiveAt: DEMO_ANCHOR,
        id: TRACE_ID,
        intent: "programme",
        rendered: "Synthetic trace",
        selected: { sections: [] },
        tokenCount: 3,
        turnId: "00000000-0000-4000-8000-000000008002",
      }),
    ).resolves.toBe(TRACE_ID);

    const failedRunId = "00000000-0000-4000-8000-000000008011";
    await expect(
      audit.insertFailedRun({
        agent: "programme",
        attemptKey: "coverage-failed-run",
        createdAt: DEMO_ANCHOR,
        errorCode: "dependency_unavailable",
        id: failedRunId,
        latencyMs: 5,
        model: "recorded-v1",
        promptVersion: "programme.v1",
        traceId: TRACE_ID,
      }),
    ).resolves.toBe(failedRunId);

    const successfulRunId = "00000000-0000-4000-8000-000000008012";
    await expect(
      audit.insertSuccessfulPipeline(
        {
          agent: "programme",
          attemptKey: "coverage-successful-run",
          createdAt: DEMO_ANCHOR,
          id: successfulRunId,
          latencyMs: 4,
          model: "recorded-v1",
          output: { result: "synthetic" },
          promptVersion: "programme.v1",
          traceId: TRACE_ID,
        },
        [
          {
            agentRunId: successfulRunId,
            id: "00000000-0000-4000-8000-000000008013",
            kind: "gate",
            name: "forbidden_movement",
            passed: true,
            rationale: "Synthetic gate passed",
          },
        ],
      ),
    ).resolves.toBe(successfulRunId);
    expect(
      await adapter.database.query.evalResults.findFirst({
        where: eq(evalResults.agentRunId, successfulRunId),
      }),
    ).toMatchObject({ passed: true });

    const noEvaluationRunId = "00000000-0000-4000-8000-000000008014";
    await expect(
      audit.insertSuccessfulPipeline(
        {
          agent: "adjustment",
          attemptKey: "coverage-no-evaluation-run",
          createdAt: DEMO_ANCHOR,
          id: noEvaluationRunId,
          latencyMs: 2,
          model: "recorded-v1",
          output: { result: "synthetic" },
          promptVersion: "adjustment.v1",
          traceId: TRACE_ID,
        },
        [],
      ),
    ).resolves.toBe(noEvaluationRunId);
  });

  it("claims, completes, replays, conflicts, and rejects concurrent idempotency work", async () => {
    const repository = new IdempotencyRepository(adapter.database);
    const claim = {
      actorScope: CLIENT_ID,
      id: "00000000-0000-4000-8000-000000008301",
      key: "coverage-idempotency-key",
      operationScope: "coverage.operation",
      requestHash: "sha256:coverage",
    };

    await expect(repository.claim(claim)).resolves.toEqual({ kind: "claimed", recordId: claim.id });
    await databaseError(
      repository.claim({ ...claim, id: "00000000-0000-4000-8000-000000008302" }),
      "operation_in_progress",
    );
    await databaseError(
      repository.claim({
        ...claim,
        id: "00000000-0000-4000-8000-000000008303",
        requestHash: "sha256:different",
      }),
      "idempotency_key_reused",
    );
    await repository.complete(claim.id, 201, { result: "synthetic" }, DEMO_ANCHOR);
    await expect(
      repository.claim({ ...claim, id: "00000000-0000-4000-8000-000000008304" }),
    ).resolves.toEqual({
      kind: "completed",
      recordId: claim.id,
      response: { result: "synthetic" },
      status: 201,
    });
  });

  it("retries, replays, and rejects concurrent application job claims", async () => {
    const jobs = new DrizzleJobRepository(adapter.database);
    const failedKey = "coverage-job-failed";
    await expect(jobs.claim(failedKey, "weekly_plan")).resolves.toEqual({ kind: "claimed" });
    await expect(jobs.claim(failedKey, "weekly_plan")).rejects.toMatchObject({
      code: "operation_in_progress",
    });
    await jobs.fail(failedKey, "synthetic_failure", DEMO_ANCHOR);
    await expect(jobs.claim(failedKey, "weekly_plan")).resolves.toEqual({ kind: "claimed" });
    await expect(
      adapter.database.query.jobRuns.findFirst({ where: eq(jobRuns.stableKey, failedKey) }),
    ).resolves.toMatchObject({ attempt: 2, errorCode: null, status: "running" });

    const completeKey = "coverage-job-completed";
    const summary = {
      failed: 1,
      processed: 3,
      runKey: completeKey,
      status: "completed",
      succeeded: 2,
    } as const;
    await jobs.claim(completeKey, "daily_accountability");
    await jobs.complete(completeKey, summary, DEMO_ANCHOR);
    await expect(jobs.claim(completeKey, "daily_accountability")).resolves.toEqual({
      kind: "completed",
      value: summary,
    });

    const invalidKey = "coverage-job-invalid-summary";
    await jobs.claim(invalidKey, "weekly_plan");
    await jobs.complete(
      invalidKey,
      { ...summary, runKey: invalidKey, status: "running" },
      DEMO_ANCHOR,
    );
    await expect(jobs.claim(invalidKey, "weekly_plan")).rejects.toThrow(
      "Stored job summary is invalid.",
    );
  });

  it("retries and replays application idempotency while enforcing fingerprint ownership", async () => {
    const idempotency = new DrizzleApplicationIdempotencyRepository(adapter.database);
    const input = {
      actorId: CLIENT_ID,
      key: "coverage-application-idempotency",
      requestFingerprint: "sha256:application-coverage",
      scope: "application.coverage",
    };
    const first = await idempotency.claim(input);
    expect(first.kind).toBe("claimed");
    await expect(idempotency.claim(input)).rejects.toMatchObject({ code: "operation_in_progress" });
    await expect(
      idempotency.claim({ ...input, requestFingerprint: "sha256:different" }),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    await idempotency.fail(first.recordId, "synthetic_failure", DEMO_ANCHOR);
    await expect(idempotency.claim(input)).resolves.toEqual({
      kind: "claimed",
      recordId: first.recordId,
    });
    await idempotency.complete(first.recordId, { result: "synthetic" }, DEMO_ANCHOR);
    const replay = await idempotency.claim<{ readonly result: string }>(input);
    expect(replay).toEqual({
      kind: "completed",
      recordId: first.recordId,
      value: { result: "synthetic" },
    });
    if (replay.kind === "completed") {
      const stored = await adapter.database.query.idempotencyRecords.findFirst({
        where: eq(idempotencyRecords.id, first.recordId),
      });
      expect(stored?.response).toEqual({ result: "synthetic" });
      expect(replay.value).not.toBe(stored?.response);
    }
  });

  it("aggregates gate, judge, cost, latency, and mixed-model scorecard evidence", async () => {
    const existingRuns = await adapter.database.select().from(agentRuns).limit(2);
    const existingRun = existingRuns[0];
    const otherRun = existingRuns[1];
    expect(existingRuns).toHaveLength(2);
    if (existingRun === undefined || otherRun === undefined) return;
    await adapter.database.insert(evalResults).values([
      {
        agentRunId: otherRun.id,
        id: "00000000-0000-4000-8000-000000008401",
        kind: "gate",
        name: "coverage_gate",
        passed: true,
        rationale: "Synthetic pass",
      },
      {
        agentRunId: existingRun.id,
        id: "00000000-0000-4000-8000-000000008402",
        kind: "gate",
        name: "coverage_gate",
        passed: false,
        rationale: "Synthetic fail",
      },
      {
        agentRunId: existingRun.id,
        id: "00000000-0000-4000-8000-000000008403",
        judgeModel: "synthetic-judge",
        kind: "judge",
        name: "coverage_judge",
        rationale: "Synthetic score",
        score: 4,
      },
    ]);
    await adapter.database.insert(agentRuns).values({
      agent: "programme",
      attemptKey: "coverage-live-run",
      costUsd: 0.25,
      id: "00000000-0000-4000-8000-000000008404",
      latencyMs: 123,
      model: "live-synthetic-model",
      output: { result: "synthetic" },
      promptVersion: "programme.v1",
      status: "succeeded",
      traceId: existingRun.traceId,
    });

    const scorecard = await new DrizzleScorecardRepository(adapter.database).get();
    expect(scorecard.mode).toBe("mixed");
    expect(scorecard.safetyPassRateByGate["coverage_gate"]).toEqual({
      availability: "available",
      sampleSize: 2,
      value: 0.5,
    });
    expect(scorecard.judgeDistribution["coverage_judge"]).toEqual([0, 0, 0, 1, 0]);
    expect(scorecard.latencyP50Ms.availability).toBe("available");
    expect(scorecard.costPerPublishedPlanUsd.availability).toBe("available");
  });

  it("keeps deterministic coach edits in recorded scorecard provenance", async () => {
    const audit = new BufferedAgentAuditRepository(adapter.database);
    const programmes = new DrizzleProgrammeApplicationRepository(adapter, audit);
    const proposalId = "00000000-0000-4000-8000-000000000602";
    const proposal = await programmes.getReview(proposalId);
    expect(proposal).toBeDefined();
    if (proposal === undefined) return;
    expect(proposal.programme.reviewBand).not.toBeNull();
    if (proposal.programme.reviewBand === null) return;
    expect((await new DrizzleScorecardRepository(adapter.database).get()).mode).toBe("recorded");

    const edited = await programmes.edit({
      band: proposal.programme.reviewBand,
      context: {
        actorId: COACH_ID,
        effectiveAt: DEMO_ANCHOR,
        idempotencyKey: "coverage-programme-coach-edit",
        requestId: "coverage-programme-coach-edit",
      },
      expectedVersion: proposal.programme.version,
      gates: [],
      payload: {
        ...proposal.programme.payload,
        summary: `${proposal.programme.payload.summary} Coach-edited deterministically.`,
      },
      programmeId: proposalId,
    });

    expect(edited.model).toBe("recorded/coach-edit");
    await expect(
      adapter.database.query.agentRuns.findFirst({
        where: eq(agentRuns.id, edited.programme.generatedBy),
      }),
    ).resolves.toMatchObject({ model: "recorded/coach-edit" });
    await expect(new DrizzleScorecardRepository(adapter.database).get()).resolves.toMatchObject({
      mode: "recorded",
    });
  });

  it("fails closed for missing accountability clients and unavailable audit buffers", async () => {
    const audit = new BufferedAgentAuditRepository(adapter.database);
    const accountability = new DrizzleAccountabilityRepository(adapter, audit);
    const missingId = "00000000-0000-4000-8000-000000008499";
    await expect(accountability.get(missingId)).resolves.toBeUndefined();
    await expect(accountability.loadInputs(missingId, DEMO_ANCHOR)).rejects.toMatchObject({
      code: "client_not_found",
    });

    await expect(
      audit.persistSuccess(adapter.database, "00000000-0000-4000-8000-000000008498"),
    ).rejects.toThrow("Agent audit buffer is unavailable.");
    const persisted = await adapter.database.query.agentRuns.findFirst();
    expect(persisted).toBeDefined();
    if (persisted !== undefined) {
      await expect(audit.persistSuccess(adapter.database, persisted.id)).resolves.toBeUndefined();
    }
    await expect(
      new DrizzleTraceRepository(adapter.database).get(missingId),
    ).resolves.toBeUndefined();
  });

  it("fails closed for missing context clients and includes soft constraints deterministically", async () => {
    const assembler = new DatabaseContextAssembler(adapter.database);
    await expect(
      assembler.assemble({
        clientId: "00000000-0000-4000-8000-000000008499",
        effectiveAt: DEMO_ANCHOR,
        kind: "programme",
        targetWeekStart: "2026-08-03",
      }),
    ).rejects.toMatchObject({ code: "client_not_found" });

    const constraintId = "00000000-0000-4000-8000-000000008501";
    await adapter.database.insert(clientConstraints).values({
      clientId: CLIENT_ID,
      detail: { forbids: [], note: "Synthetic preference" },
      id: constraintId,
      kind: "preference",
      severity: "soft",
      source: "coach_entered",
      validFrom: new Date(DEMO_ANCHOR.valueOf() - 24 * 60 * 60 * 1_000),
    });
    const assembled = await assembler.assemble({
      clientId: CLIENT_ID,
      effectiveAt: DEMO_ANCHOR,
      kind: "programme",
      targetWeekStart: "2026-08-03",
    });
    expect(
      assembled.trace.sections
        .find((section) => section.kind === "soft_constraints_older_summaries")
        ?.records.map((record) => record.recordId),
    ).toContain(constraintId);
  });

  it("stores check-in free text and includes it in the next exact context trace", async () => {
    const body = "QA-CLI-006 unique recovery note.";
    const respondedAt = DEMO_ANCHOR.toISOString();
    const checkIn = await new DrizzleCheckInRepository(adapter).create({
      body,
      clientId: CLIENT_ID,
      readiness: 4,
      respondedAt,
      requiresHumanEscalation: false,
      context: {
        actorId: CLIENT_ID,
        effectiveAt: DEMO_ANCHOR,
        idempotencyKey: "qa-cli-006-check-in-context",
        requestId: "qa-cli-006-check-in-context",
      },
    });
    const stored = await adapter.database.query.checkIns.findFirst({
      where: eq(checkIns.id, checkIn.id),
    });
    const assembled = await new DatabaseContextAssembler(adapter.database).assemble({
      clientId: CLIENT_ID,
      effectiveAt: DEMO_ANCHOR,
      kind: "programme",
      targetWeekStart: "2026-08-03",
    });
    const checkInRecord = assembled.trace.sections
      .find((section) => section.kind === "check_ins_metrics")
      ?.records.find((record) => record.recordId === checkIn.id);

    expect(stored?.body).toBe(body);
    expect(checkIn.body).toBe(body);
    expect(checkInRecord).toMatchObject({ recordId: checkIn.id, source: "check_in" });
    expect(assembled.trace.rendered).toContain(`"body":"${body}"`);
  });

  it("covers filtered application reads and unavailable review dependencies", async () => {
    const missingId = "00000000-0000-4000-8000-000000008599";
    const clientReads = new DrizzleClientReadRepository(adapter.database);
    const constrained = await clientReads.getDetail(
      "00000000-0000-4000-8000-000000000102",
      DEMO_ANCHOR,
    );
    expect(constrained?.activeConstraints).toHaveLength(1);
    await expect(clientReads.getToday(CLIENT_ID, DEMO_ANCHOR)).resolves.toMatchObject({
      clientId: CLIENT_ID,
      localDate: "2026-08-03",
      nextSession: null,
      programme: { id: PUBLISHED_PROGRAMME_ID, status: "published" },
      session: { id: "00000000-0000-4000-8000-000000000701" },
    });
    await expect(
      clientReads.getToday("00000000-0000-4000-8000-000000000102", DEMO_ANCHOR),
    ).resolves.toMatchObject({ nextSession: null, programme: null, session: null });
    await expect(clientReads.getDetail(missingId, DEMO_ANCHOR)).resolves.toBeUndefined();
    await expect(clientReads.getToday(missingId, DEMO_ANCHOR)).resolves.toBeUndefined();

    const audit = new BufferedAgentAuditRepository(adapter.database);
    const programmeRepository = new DrizzleProgrammeApplicationRepository(adapter, audit);
    await expect(
      programmeRepository.list({
        band: "blocked",
        clientId: "00000000-0000-4000-8000-000000000102",
        status: "queued",
      }),
    ).resolves.toHaveLength(1);
    await expect(programmeRepository.getReview(missingId)).resolves.toBeUndefined();
    await adapter.database
      .update(programmes)
      .set({ generatedBy: null })
      .where(eq(programmes.id, "00000000-0000-4000-8000-000000000602"));
    await expect(
      programmeRepository.getReview("00000000-0000-4000-8000-000000000602"),
    ).rejects.toThrow("Programme audit run is unavailable.");

    const sessionRepository = new DrizzleSessionRepository(adapter);
    await expect(
      sessionRepository.list({
        clientId: CLIENT_ID,
        from: "2026-08-01",
        to: "2026-08-31",
      }),
    ).resolves.not.toHaveLength(0);
    await expect(sessionRepository.get(missingId)).resolves.toBeUndefined();

    const adjustmentRepository = new DrizzleAdjustmentRepository(adapter, audit);
    await expect(
      adjustmentRepository.list({
        clientId: "00000000-0000-4000-8000-000000000103",
        status: "queued",
      }),
    ).resolves.not.toHaveLength(0);
    await expect(
      adjustmentRepository.resolveGenerationInput({
        actorId: COACH_ID,
        clientId: missingId,
        sourceEventKey: undefined,
      }),
    ).resolves.toBeUndefined();
    await expect(
      adjustmentRepository.resolveGenerationInput({
        actorId: COACH_ID,
        clientId: CLIENT_ID,
        sourceEventKey: "missing-source-event",
      }),
    ).resolves.toBeUndefined();
    await expect(adjustmentRepository.get(missingId)).resolves.toBeUndefined();
  });
});
