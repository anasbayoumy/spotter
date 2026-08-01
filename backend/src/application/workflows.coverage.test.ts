import {
  adjustmentModelOutputSchema,
  adjustmentSchema,
  checkInSchema,
  contextTraceSchema,
  programmeModelOutputSchema,
  programmeReviewSchema,
  programmeSchema,
  sessionSchema,
  type GateResult,
  type JudgeResult,
  type Programme,
  type ProgrammeReview,
  type Session,
} from "@spotter/contracts";
import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../domain/index.js";
import { ApproveAdjustment, GenerateAdjustment, RejectAdjustment } from "./adjustments.js";
import {
  ApplicationError,
  type ExecutionContext,
  type FingerprintPort,
  type IdempotencyPort,
} from "./core.js";
import type {
  AdjustmentPort,
  AdjustmentTriggerPort,
  AgentAuditPort,
  CheckInPort,
  ContextAssemblerPort,
  EvaluationPort,
  ModelGatewayPort,
  ProgrammePort,
  RedFlagPort,
  SessionPort,
  TracePort,
} from "./ports.js";
import {
  ApproveProgramme,
  EditProgrammeProposal,
  GenerateProgramme,
  OverrideBlockedProgramme,
  RejectProgramme,
} from "./programmes.js";
import { CompleteSession, CreateCheckIn, LogSessionWork } from "./sessions.js";

const ids = {
  client: "00000000-0000-4000-8000-000000000301",
  coach: "00000000-0000-4000-8000-000000000302",
  programme: "00000000-0000-4000-8000-000000000303",
  run: "00000000-0000-4000-8000-000000000304",
  trace: "00000000-0000-4000-8000-000000000305",
  turn: "00000000-0000-4000-8000-000000000306",
  exercise: "00000000-0000-4000-8000-000000000307",
  session: "00000000-0000-4000-8000-000000000308",
  checkIn: "00000000-0000-4000-8000-000000000309",
  adjustment: "00000000-0000-4000-8000-000000000310",
  gate: "00000000-0000-4000-8000-000000000311",
  judge: "00000000-0000-4000-8000-000000000312",
  successor: "00000000-0000-4000-8000-000000000313",
} as const;
const now = new Date("2026-08-02T12:00:00.000Z");
const context: ExecutionContext = {
  requestId: "workflow-coverage",
  actorId: ids.coach,
  effectiveAt: now,
  idempotencyKey: "workflow:coverage:001",
};
const fingerprint: FingerprintPort = { fingerprint: (value) => JSON.stringify(value) };
const exerciseInput = {
  id: ids.exercise,
  name: "Squat",
  family: "squat",
  muscleGroups: ["quadriceps"],
  sets: 3,
  reps: 5,
  rpe: 7,
  restSeconds: 90,
  notes: null,
};
const payloadInput = {
  summary: "Synthetic week",
  days: [
    {
      dayIndex: 1,
      scheduledDate: "2026-08-03",
      focus: "Strength",
      exercises: [exerciseInput],
    },
  ],
};
const citation = { sectionId: "profile", recordIds: [ids.client], claim: "Uses schedule" };
const programmeOutput = programmeModelOutputSchema.parse({
  payload: payloadInput,
  citations: [citation],
});
const payload = programmeOutput.payload;
const exercise = payload.days[0]?.exercises[0];
if (exercise === undefined) throw new Error("Fixture requires one exercise");
const adjustmentOutput = adjustmentModelOutputSchema.parse({
  operations: [
    { type: "reduce_load", exerciseId: ids.exercise, percent: 10, rationale: "High RPE" },
  ],
  citations: [citation],
});
const trace = contextTraceSchema.parse({
  id: ids.trace,
  clientId: ids.client,
  turnId: ids.turn,
  intent: "programme",
  sections: [],
  rendered: "synthetic context",
  tokenCount: 10,
  budget: 1_000,
  createdAt: now.toISOString(),
});
const passingGate: GateResult = {
  id: ids.gate,
  name: "forbidden_movement",
  passed: true,
  rationale: "Safe",
};
const judge: JudgeResult = {
  id: ids.judge,
  name: "grounding",
  score: 5,
  rationale: "Grounded",
  judgeModel: "recorded-judge",
};

function review(
  status: Programme["status"] = "queued",
  band: Programme["reviewBand"] = "clear",
  version = 1,
): ProgrammeReview {
  return programmeReviewSchema.parse({
    programme: {
      id: ids.programme,
      clientId: ids.client,
      mesocycle: 1,
      week: 1,
      payload,
      status,
      reviewBand: band,
      generatedBy: ids.run,
      approvedBy: null,
      approvedAt: null,
      supersededBy: status === "superseded" ? ids.successor : null,
      validFrom: null,
      createdAt: now.toISOString(),
      version,
    },
    citations: [citation],
    gates: [passingGate],
    judges: [judge],
    traceId: ids.trace,
    promptVersion: "prompt-v1",
    model: "recorded-generator",
  });
}

const queuedReview = review();
const publishedProgramme = programmeSchema.parse({
  ...queuedReview.programme,
  status: "published",
  approvedBy: ids.coach,
  approvedAt: now.toISOString(),
  validFrom: now.toISOString(),
  version: 2,
});
const queuedAdjustment = adjustmentSchema.parse({
  id: ids.adjustment,
  clientId: ids.client,
  baseProgrammeId: ids.programme,
  trigger: { type: "explicit_coach", coachId: ids.coach },
  sourceEventKey: "adjustment:source:001",
  operations: adjustmentOutput.operations,
  status: "queued",
  reviewBand: "clear",
  approvedBy: null,
  approvedAt: null,
  appliedProgrammeId: null,
  createdAt: now.toISOString(),
  version: 1,
});

function idempotency(): IdempotencyPort {
  return {
    claim: () => Promise.resolve({ kind: "claimed", recordId: ids.run }),
    complete: () => Promise.resolve(),
    fail: () => Promise.resolve(),
  };
}

interface IdempotentDependencies {
  readonly idempotency: IdempotencyPort;
  readonly fingerprint: FingerprintPort;
}

const idempotent = (): IdempotentDependencies => ({ idempotency: idempotency(), fingerprint });

function programmePort(overrides: Partial<ProgrammePort> = {}): ProgrammePort {
  return {
    list: () => Promise.resolve([queuedReview.programme]),
    getReview: () => Promise.resolve(queuedReview),
    queueGenerated: () => Promise.resolve(queuedReview),
    edit: () => Promise.resolve(queuedReview),
    reject: () => Promise.resolve({ ...queuedReview.programme, status: "rejected" }),
    publish: () => Promise.resolve(publishedProgramme),
    ...overrides,
  };
}

function adjustmentPort(overrides: Partial<AdjustmentPort> = {}): AdjustmentPort {
  return {
    list: () => Promise.resolve([queuedAdjustment]),
    resolveGenerationInput: () =>
      Promise.resolve({
        baseProgrammeId: ids.programme,
        sourceEventKey: "adjustment:source:001",
        trigger: { type: "explicit_coach", coachId: ids.coach },
      }),
    queueGenerated: () => Promise.resolve(queuedAdjustment),
    get: () => Promise.resolve(queuedAdjustment),
    approve: () => Promise.resolve(publishedProgramme),
    reject: () => Promise.resolve({ ...queuedAdjustment, status: "rejected" }),
    ...overrides,
  };
}

interface GenerationDependencies extends IdempotentDependencies {
  readonly assembler: ContextAssemblerPort;
  readonly traces: TracePort;
  readonly gateway: ModelGatewayPort;
  readonly evaluation: EvaluationPort;
  readonly audit: AgentAuditPort;
  readonly programmes: ProgrammePort;
  readonly adjustments: AdjustmentPort;
}

function generationDependencies(
  overrides: {
    readonly programmes?: ProgrammePort;
    readonly adjustments?: AdjustmentPort;
    readonly gateway?: Partial<ModelGatewayPort>;
    readonly evaluation?: Partial<EvaluationPort>;
    readonly audit?: Partial<AgentAuditPort>;
  } = {},
): GenerationDependencies {
  const assembler: ContextAssemblerPort = { assemble: () => Promise.resolve({ trace }) };
  const traces: TracePort = {
    persistBeforeModel: () => Promise.resolve(),
    get: () => Promise.resolve(trace),
  };
  const gateway: ModelGatewayPort = {
    generateProgramme: () => Promise.resolve(programmeOutput),
    generateAdjustment: () => Promise.resolve(adjustmentOutput),
    draftAccountability: () => Promise.reject(new Error("unused")),
    ...overrides.gateway,
  };
  const evaluation: EvaluationPort = {
    runGates: () => Promise.resolve([passingGate]),
    runJudges: () => Promise.resolve([judge]),
    ...overrides.evaluation,
  };
  const audit: AgentAuditPort = {
    recordSuccess: () => Promise.resolve(ids.run),
    recordFailure: () => Promise.resolve(),
    ...overrides.audit,
  };
  return {
    assembler,
    traces,
    gateway,
    evaluation,
    audit,
    programmes: overrides.programmes ?? programmePort(),
    adjustments: overrides.adjustments ?? adjustmentPort(),
    ...idempotent(),
  };
}

describe("programme workflow edge coverage", () => {
  it.each([
    [new ApplicationError("dependency_unavailable", "down"), "dependency_unavailable"],
    [new DomainError("invalid_value", "bad"), "invalid_value"],
    [new Error("private"), "internal_error"],
  ])("records typed and unknown generation failures", async (failure, expectedCode) => {
    const recordFailure = vi.fn<AgentAuditPort["recordFailure"]>().mockResolvedValue(undefined);
    const dependencies = generationDependencies({
      evaluation: { runGates: () => Promise.reject(failure) },
      audit: { recordFailure },
    });
    await expect(
      new GenerateProgramme(dependencies).execute(
        { clientId: ids.client, targetWeekStart: "2026-08-03" },
        context,
      ),
    ).rejects.toBe(failure);
    expect(recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: expectedCode }),
    );
  });

  it("edits an eligible proposal after re-evaluation", async () => {
    const edit = vi.fn<ProgrammePort["edit"]>().mockResolvedValue(queuedReview);
    const result = await new EditProgrammeProposal({
      programmes: programmePort({ edit }),
      traces: { persistBeforeModel: () => Promise.resolve(), get: () => Promise.resolve(trace) },
      evaluation: {
        runGates: () => Promise.resolve([passingGate]),
        runJudges: () => Promise.resolve([judge]),
      },
    }).execute(ids.programme, { payload, expectedVersion: 1 }, context);
    expect(result).toEqual(queuedReview);
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ band: "clear" }));
  });

  it.each([
    [programmePort({ getReview: () => Promise.resolve(undefined) }), 1, "programme_not_found"],
    [
      programmePort({ getReview: () => Promise.resolve(review("queued", "clear", 2)) }),
      1,
      "version_conflict",
    ],
    [
      programmePort({ getReview: () => Promise.resolve(review("rejected")) }),
      1,
      "invalid_state_transition",
    ],
    [
      programmePort({ getReview: () => Promise.resolve(review("superseded")) }),
      1,
      "invalid_state_transition",
    ],
  ])("rejects invalid edit state", async (programmes, expectedVersion, code) => {
    const useCase = new EditProgrammeProposal({
      programmes,
      traces: { persistBeforeModel: () => Promise.resolve(), get: () => Promise.resolve(trace) },
      evaluation: { runGates: () => Promise.resolve([]), runJudges: () => Promise.resolve([]) },
    });
    await expect(
      useCase.execute(ids.programme, { payload, expectedVersion }, context),
    ).rejects.toMatchObject({ code });
  });

  it("rejects an invalid edit payload and a missing source trace", async () => {
    const useCase = (traces: TracePort): EditProgrammeProposal =>
      new EditProgrammeProposal({
        programmes: programmePort(),
        traces,
        evaluation: { runGates: () => Promise.resolve([]), runJudges: () => Promise.resolve([]) },
      });
    await expect(
      useCase({
        persistBeforeModel: () => Promise.resolve(),
        get: () => Promise.resolve(trace),
      }).execute(ids.programme, { payload: { ...payload, days: [] }, expectedVersion: 1 }, context),
    ).rejects.toThrow();
    await expect(
      useCase({
        persistBeforeModel: () => Promise.resolve(),
        get: () => Promise.resolve(undefined),
      }).execute(ids.programme, { payload, expectedVersion: 1 }, context),
    ).rejects.toMatchObject({ code: "dependency_unavailable" });
  });

  it("publishes standard and rejects programmes", async () => {
    await expect(
      new ApproveProgramme(programmePort(), idempotent()).execute(
        ids.programme,
        { expectedVersion: 1 },
        context,
      ),
    ).resolves.toEqual(publishedProgramme);
    await expect(
      new RejectProgramme(programmePort(), idempotent()).execute(
        ids.programme,
        { expectedVersion: 1, reason: "coach choice" },
        context,
      ),
    ).resolves.toMatchObject({ status: "rejected" });
  });

  it.each([
    [programmePort({ getReview: () => Promise.resolve(undefined) }), 1, "programme_not_found"],
    [
      programmePort({ getReview: () => Promise.resolve(review("queued", "clear", 2)) }),
      1,
      "version_conflict",
    ],
    [
      programmePort({ getReview: () => Promise.resolve(review("rejected")) }),
      1,
      "invalid_state_transition",
    ],
  ])("rejects invalid publish state", async (programmes, expectedVersion, code) => {
    await expect(
      new ApproveProgramme(programmes, idempotent()).execute(
        ids.programme,
        { expectedVersion },
        context,
      ),
    ).rejects.toMatchObject({ code });
  });

  it("enforces every override invariant", async () => {
    const clear = new OverrideBlockedProgramme(programmePort(), idempotent());
    await expect(
      clear.executeOverride(ids.programme, { expectedVersion: 1, reason: "reason" }, context),
    ).rejects.toMatchObject({ code: "invalid_state_transition" });
    const blocked = new OverrideBlockedProgramme(
      programmePort({ getReview: () => Promise.resolve(review("queued", "blocked")) }),
      idempotent(),
    );
    await expect(
      blocked.executeOverride(ids.programme, { expectedVersion: 1, reason: " " }, context),
    ).rejects.toMatchObject({ code: "override_reason_required" });
    await expect(
      blocked.executeOverride(
        ids.programme,
        { expectedVersion: 1, reason: "accepted risk" },
        context,
      ),
    ).resolves.toEqual(publishedProgramme);
  });
});

describe("adjustment workflow edge coverage", () => {
  it("generates and queues a reviewed adjustment", async () => {
    await expect(
      new GenerateAdjustment(generationDependencies()).execute({ clientId: ids.client }, context),
    ).resolves.toEqual(queuedAdjustment);
  });

  it("rejects generation without an eligible source", async () => {
    const dependencies = generationDependencies({
      adjustments: adjustmentPort({ resolveGenerationInput: () => Promise.resolve(undefined) }),
    });
    await expect(
      new GenerateAdjustment(dependencies).execute({ clientId: ids.client }, context),
    ).rejects.toMatchObject({ code: "invalid_state_transition" });
  });

  it("audits invalid output and model execution failures", async () => {
    const invalidAudit = vi.fn<AgentAuditPort["recordFailure"]>().mockResolvedValue(undefined);
    const invalid = generationDependencies({
      gateway: {
        generateAdjustment: () =>
          Promise.resolve({ invalid: true } as unknown as typeof adjustmentOutput),
      },
      audit: { recordFailure: invalidAudit },
    });
    await expect(
      new GenerateAdjustment(invalid).execute({ clientId: ids.client }, context),
    ).rejects.toMatchObject({ code: "model_output_invalid" });
    expect(invalidAudit).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "model_output_invalid" }),
    );

    const failure = new Error("judge unavailable");
    const failedAudit = vi.fn<AgentAuditPort["recordFailure"]>().mockResolvedValue(undefined);
    const failed = generationDependencies({
      evaluation: { runJudges: () => Promise.reject(failure) },
      audit: { recordFailure: failedAudit },
    });
    await expect(
      new GenerateAdjustment(failed).execute({ clientId: ids.client }, context),
    ).rejects.toBe(failure);
    expect(failedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "model_run_failed" }),
    );
  });

  it.each([
    [adjustmentPort({ get: () => Promise.resolve(undefined) }), 1, "not_found"],
    [
      adjustmentPort({ get: () => Promise.resolve({ ...queuedAdjustment, version: 2 }) }),
      1,
      "version_conflict",
    ],
    [
      adjustmentPort({ get: () => Promise.resolve({ ...queuedAdjustment, status: "approved" }) }),
      1,
      "invalid_state_transition",
    ],
  ])("rejects invalid approval state", async (adjustments, expectedVersion, code) => {
    await expect(
      new ApproveAdjustment(adjustments, idempotent()).execute(
        ids.adjustment,
        { expectedVersion },
        context,
      ),
    ).rejects.toMatchObject({ code });
  });

  it("approves and rejects queued adjustments", async () => {
    await expect(
      new ApproveAdjustment(adjustmentPort(), idempotent()).execute(
        ids.adjustment,
        { expectedVersion: 1 },
        context,
      ),
    ).resolves.toEqual(publishedProgramme);
    await expect(
      new RejectAdjustment(adjustmentPort(), idempotent()).execute(
        ids.adjustment,
        { expectedVersion: 1, reason: "not needed" },
        context,
      ),
    ).resolves.toMatchObject({ status: "rejected" });
  });
});

function completedSession(overrides: Partial<Session> = {}): Session {
  return sessionSchema.parse({
    id: ids.session,
    clientId: ids.client,
    programmeId: ids.programme,
    scheduledFor: "2026-08-02",
    status: "completed",
    planned: [exercise],
    actual: [
      {
        exerciseId: ids.exercise,
        sets: [
          { setIndex: 1, reps: 5, loadKg: 50, rpe: 7, completed: true },
          { setIndex: 2, reps: 5, loadKg: 50, rpe: 7, completed: true },
          { setIndex: 3, reps: 5, loadKg: 50, rpe: 7, completed: true },
        ],
      },
    ],
    performedAt: now.toISOString(),
    rpe: 7,
    notes: null,
    version: 2,
    ...overrides,
  });
}

function sessionPort(value: Session): SessionPort {
  return {
    list: () => Promise.resolve([value]),
    get: () => Promise.resolve(value),
    log: () => Promise.resolve(value),
    complete: () => Promise.resolve(value),
  };
}

describe("session and check-in edge coverage", () => {
  it("logs session work through the idempotent boundary", async () => {
    const value = completedSession({ status: "scheduled", performedAt: null, rpe: null });
    await expect(
      new LogSessionWork(sessionPort(value), idempotent()).execute(
        ids.session,
        { clientId: ids.client, actual: value.actual ?? [], notes: null, expectedVersion: 1 },
        context,
      ),
    ).resolves.toEqual(value);
  });

  it("requests low-completion adjustment and caps over-completion", async () => {
    const request = vi.fn<AdjustmentTriggerPort["request"]>().mockResolvedValue(undefined);
    const low = completedSession({
      actual: [
        {
          exerciseId: ids.exercise,
          sets: [{ setIndex: 1, reps: 5, loadKg: 50, rpe: 7, completed: true }],
        },
      ],
    });
    await new CompleteSession(sessionPort(low), { request }, idempotent()).execute(
      ids.session,
      { clientId: ids.client, rpe: 7, performedAt: now.toISOString(), expectedVersion: 1 },
      context,
    );
    expect(request.mock.calls[0]?.[0].trigger).toMatchObject({ type: "low_completion" });

    request.mockClear();
    const over = completedSession({
      actual: [
        {
          exerciseId: ids.exercise,
          sets: [
            { setIndex: 1, reps: 5, loadKg: 50, rpe: 7, completed: true },
            { setIndex: 2, reps: 5, loadKg: 50, rpe: 7, completed: true },
            { setIndex: 3, reps: 5, loadKg: 50, rpe: 7, completed: true },
            { setIndex: 4, reps: 5, loadKg: 50, rpe: 7, completed: true },
          ],
        },
      ],
    });
    await new CompleteSession(sessionPort(over), { request }, idempotent()).execute(
      ids.session,
      { clientId: ids.client, rpe: 7, performedAt: now.toISOString(), expectedVersion: 1 },
      context,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("handles missing actual work and a healthy completion without a trigger", async () => {
    const request = vi.fn<AdjustmentTriggerPort["request"]>().mockResolvedValue(undefined);
    const missing = completedSession({
      status: "scheduled",
      actual: null,
      performedAt: null,
      rpe: null,
    });
    await new CompleteSession(sessionPort(missing), { request }, idempotent()).execute(
      ids.session,
      { clientId: ids.client, rpe: 7, performedAt: now.toISOString(), expectedVersion: 1 },
      context,
    );
    expect(request.mock.calls[0]?.[0].trigger).toMatchObject({ completionRatio: 0 });
    request.mockClear();
    await new CompleteSession(sessionPort(completedSession()), { request }, idempotent()).execute(
      ids.session,
      { clientId: ids.client, rpe: 7, performedAt: now.toISOString(), expectedVersion: 1 },
      context,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [1, false, "low_readiness"],
    [4, false, "none"],
    [1, true, "escalate"],
  ])("routes check-ins deterministically", async (readiness, hasRedFlag, expected) => {
    const events: string[] = [];
    const checkIns: CheckInPort = {
      create: (input) =>
        Promise.resolve(
          checkInSchema.parse({
            id: ids.checkIn,
            clientId: input.clientId,
            readiness: input.readiness,
            body: input.body,
            sentiment: null,
            respondedAt: input.respondedAt,
            latencyHours: null,
            createdAt: now.toISOString(),
            requiresHumanEscalation: input.requiresHumanEscalation,
          }),
        ),
    };
    const redFlags: RedFlagPort = {
      hasRedFlag: () => hasRedFlag,
      escalate: () => {
        events.push("escalate");
        return Promise.resolve();
      },
    };
    const triggers: AdjustmentTriggerPort = {
      request: (input) => {
        events.push(input.trigger.type);
        return Promise.resolve();
      },
    };
    await new CreateCheckIn(checkIns, redFlags, triggers, idempotent()).execute(
      { clientId: ids.client, readiness, body: "synthetic", respondedAt: now.toISOString() },
      context,
    );
    expect(events).toEqual(expected === "none" ? [] : [expected]);
  });
});
