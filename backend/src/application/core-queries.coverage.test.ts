import {
  accountabilityDetailSchema,
  adjustmentSchema,
  clientDetailSchema,
  clientSummarySchema,
  contextTraceSchema,
  programmeReviewSchema,
  programmeSchema,
  scorecardSchema,
  sessionSchema,
  todaySchema,
  type GateResult,
  type JudgeResult,
} from "@spotter/contracts";
import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../domain/index.js";
import {
  ApplicationError,
  executeIdempotently,
  executeSafely,
  failure,
  success,
  type ExecutionContext,
  type FingerprintPort,
  type IdempotencyPort,
} from "./core.js";
import { reviewBandFromResults } from "./evaluation.js";
import type {
  AccountabilityPort,
  AdjustmentPort,
  ClientReadPort,
  ProgrammePort,
  ScorecardPort,
  SessionPort,
  TracePort,
} from "./ports.js";
import {
  GetAccountabilityState,
  GetClientDetail,
  GetClientToday,
  GetContextTrace,
  GetProgrammeReview,
  GetScorecard,
  GetSession,
  ListAdjustments,
  ListClientMessages,
  ListDemoClients,
  ListProgrammes,
  ListSessions,
} from "./queries.js";

const ids = {
  client: "00000000-0000-4000-8000-000000000101",
  coach: "00000000-0000-4000-8000-000000000102",
  programme: "00000000-0000-4000-8000-000000000103",
  run: "00000000-0000-4000-8000-000000000104",
  trace: "00000000-0000-4000-8000-000000000105",
  turn: "00000000-0000-4000-8000-000000000106",
  exercise: "00000000-0000-4000-8000-000000000107",
  session: "00000000-0000-4000-8000-000000000108",
  adjustment: "00000000-0000-4000-8000-000000000109",
  score: "00000000-0000-4000-8000-000000000110",
} as const;
const effectiveAt = new Date("2026-08-02T12:00:00.000Z");
const context: ExecutionContext = {
  requestId: "request-coverage",
  actorId: ids.coach,
  effectiveAt,
  idempotencyKey: "coverage:key:001",
};
const fingerprint: FingerprintPort = { fingerprint: (value) => JSON.stringify(value) };

const exercise = {
  id: ids.exercise,
  name: "Row",
  family: "horizontal_pull",
  muscleGroups: ["back"],
  sets: 2,
  reps: 8,
  rpe: 7,
  restSeconds: 60,
  notes: null,
} as const;
const payload = {
  summary: "Synthetic plan",
  days: [
    { dayIndex: 1, scheduledDate: "2026-08-03", focus: "Conditioning", exercises: [exercise] },
  ],
};
const programme = programmeSchema.parse({
  id: ids.programme,
  clientId: ids.client,
  mesocycle: 1,
  week: 1,
  payload,
  status: "queued",
  reviewBand: "clear",
  generatedBy: ids.run,
  approvedBy: null,
  approvedAt: null,
  supersededBy: null,
  validFrom: null,
  createdAt: effectiveAt.toISOString(),
  version: 1,
});
const citation = { sectionId: "profile", recordIds: [ids.client], claim: "Synthetic goal" };
const review = programmeReviewSchema.parse({
  programme,
  citations: [citation],
  gates: [],
  judges: [],
  traceId: ids.trace,
  promptVersion: "prompt-v1",
  model: "recorded-generator",
});
const session = sessionSchema.parse({
  id: ids.session,
  clientId: ids.client,
  programmeId: ids.programme,
  scheduledFor: "2026-08-03",
  status: "scheduled",
  planned: [exercise],
  actual: null,
  performedAt: null,
  rpe: null,
  notes: null,
  version: 1,
});
const client = clientSummarySchema.parse({
  id: ids.client,
  handle: "c_coverage",
  status: "active",
  timezone: "Africa/Cairo",
  goals: { primary: "Synthetic race", secondary: [], targetDate: null },
  profile: {
    ageBand: "25_34",
    sex: "not_specified",
    trainingAgeMonths: 12,
    equipment: ["rower"],
    sessionsPerWeek: 3,
  },
  coachId: ids.coach,
  dataClassification: "synthetic",
  createdAt: effectiveAt.toISOString(),
});
const detail = clientDetailSchema.parse({
  client,
  activeConstraints: [],
  currentProgramme: null,
  sessions: [],
  checkIns: [],
  messages: [],
  adherence7d: null,
  adherence14d: null,
});
const today = todaySchema.parse({
  clientId: ids.client,
  localDate: "2026-08-02",
  timezone: "Africa/Cairo",
  programme: null,
  session: null,
  nextSession: null,
  outstandingMessage: null,
});
const trace = contextTraceSchema.parse({
  id: ids.trace,
  clientId: ids.client,
  turnId: ids.turn,
  intent: "programme",
  sections: [],
  rendered: "synthetic",
  tokenCount: 1,
  budget: 100,
  createdAt: effectiveAt.toISOString(),
});
const adjustment = adjustmentSchema.parse({
  id: ids.adjustment,
  clientId: ids.client,
  baseProgrammeId: ids.programme,
  trigger: { type: "explicit_coach", coachId: ids.coach },
  sourceEventKey: "coverage:event:001",
  operations: [
    {
      type: "reduce_volume",
      exerciseId: ids.exercise,
      setsToRemove: 1,
      rationale: "Low readiness",
    },
  ],
  status: "queued",
  reviewBand: "clear",
  approvedBy: null,
  approvedAt: null,
  appliedProgrammeId: null,
  createdAt: effectiveAt.toISOString(),
  version: 1,
});
const accountability = accountabilityDetailSchema.parse({
  state: {
    clientId: ids.client,
    tier: 0,
    owner: "none",
    lastTransitionAt: effectiveAt.toISOString(),
    automationPaused: false,
    churnFlagged: false,
    version: 1,
  },
  latestScore: null,
  messages: [],
});
const scorecard = scorecardSchema.parse({
  generatedAt: effectiveAt.toISOString(),
  mode: "recorded",
  safetyPassRateByGate: {},
  judgeDistribution: {},
  calibrationKappaByJudge: {},
  bandAccuracy: { value: null, sampleSize: 0, availability: "unavailable" },
  costPerPublishedPlanUsd: { value: null, sampleSize: 0, availability: "unavailable" },
  latencyP50Ms: { value: null, sampleSize: 0, availability: "unavailable" },
  latencyP95Ms: { value: null, sampleSize: 0, availability: "unavailable" },
});

function idempotency(overrides: Partial<IdempotencyPort> = {}): IdempotencyPort {
  return {
    claim: () => Promise.resolve({ kind: "claimed", recordId: ids.run }),
    complete: () => Promise.resolve(),
    fail: () => Promise.resolve(),
    ...overrides,
  };
}

describe("application core coverage", () => {
  it("wraps success, application, domain, and unknown failures", async () => {
    expect(success(1)).toEqual({ ok: true, value: 1 });
    const application = new ApplicationError("not_found", "missing");
    expect(failure(application)).toEqual({ ok: false, error: application });
    await expect(executeSafely(() => Promise.resolve(2))).resolves.toEqual({ ok: true, value: 2 });
    await expect(executeSafely(() => Promise.reject(application))).resolves.toEqual({
      ok: false,
      error: application,
    });
    const domain = await executeSafely(() =>
      Promise.reject(new DomainError("invalid_value", "bad", { field: "x" })),
    );
    expect(domain).toMatchObject({
      ok: false,
      error: { code: "validation_failed", details: { field: "x" } },
    });
    await expect(executeSafely(() => Promise.reject(new Error("private")))).resolves.toMatchObject({
      ok: false,
      error: { code: "internal_error", message: "The operation could not be completed." },
    });
  });

  it("covers idempotent completion, unavailable replay, domain failure and unknown failure", async () => {
    const complete = vi.fn<IdempotencyPort["complete"]>().mockResolvedValue(undefined);
    await expect(
      executeIdempotently(
        { idempotency: idempotency({ complete }), fingerprint },
        context,
        "scope",
        {},
        () => Promise.resolve("done"),
      ),
    ).resolves.toBe("done");
    expect(complete).toHaveBeenCalled();
    await expect(
      executeIdempotently(
        {
          idempotency: idempotency({
            claim: () => Promise.resolve({ kind: "completed", recordId: ids.run }),
          }),
          fingerprint,
        },
        context,
        "scope",
        {},
        () => Promise.resolve("never"),
      ),
    ).rejects.toMatchObject({ code: "dependency_unavailable" });
    const fail = vi.fn<IdempotencyPort["fail"]>().mockResolvedValue(undefined);
    await expect(
      executeIdempotently(
        { idempotency: idempotency({ fail }), fingerprint },
        context,
        "scope",
        {},
        () => Promise.reject(new DomainError("stale_adjustment", "stale")),
      ),
    ).rejects.toBeInstanceOf(DomainError);
    expect(fail).toHaveBeenLastCalledWith(ids.run, "stale_adjustment", effectiveAt);
    await expect(
      executeIdempotently(
        { idempotency: idempotency({ fail }), fingerprint },
        context,
        "scope",
        {},
        () => Promise.reject(new Error("boom")),
      ),
    ).rejects.toThrow("boom");
    expect(fail).toHaveBeenLastCalledWith(ids.run, "internal_error", effectiveAt);
  });

  it("accepts every judge score and rejects an out-of-range score", () => {
    const gate: GateResult = {
      id: ids.run,
      name: "unknown_family",
      passed: true,
      rationale: "known",
    };
    const judges: JudgeResult[] = [1, 2, 3, 4, 5].map((value, index) => ({
      id: `00000000-0000-4000-8000-${String(200 + index).padStart(12, "0")}`,
      name: "grounding",
      score: value,
      rationale: "synthetic",
      judgeModel: "independent-judge",
    }));
    expect(reviewBandFromResults([gate], judges)).toBe("attention");
    const invalidJudge: JudgeResult = {
      id: ids.score,
      name: "grounding",
      score: 6,
      rationale: "synthetic",
      judgeModel: "independent-judge",
    };
    expect(() => reviewBandFromResults([gate], [invalidJudge])).toThrow(/out-of-range/u);
  });
});

function clientPort(overrides: Partial<ClientReadPort> = {}): ClientReadPort {
  return {
    listSyntheticActive: () => Promise.resolve([client]),
    getDetail: () => Promise.resolve(detail),
    getToday: () => Promise.resolve(today),
    listVisibleMessages: () => Promise.resolve([]),
    ...overrides,
  };
}

function programmePort(overrides: Partial<ProgrammePort> = {}): ProgrammePort {
  return {
    list: () => Promise.resolve([programme]),
    getReview: () => Promise.resolve(review),
    queueGenerated: () => Promise.resolve(review),
    edit: () => Promise.resolve(review),
    reject: () => Promise.resolve({ ...programme, status: "rejected" }),
    publish: () => Promise.resolve(programme),
    ...overrides,
  };
}

function sessionPort(overrides: Partial<SessionPort> = {}): SessionPort {
  return {
    list: () => Promise.resolve([session]),
    get: () => Promise.resolve(session),
    log: () => Promise.resolve(session),
    complete: () => Promise.resolve(session),
    ...overrides,
  };
}

function adjustmentPort(overrides: Partial<AdjustmentPort> = {}): AdjustmentPort {
  return {
    list: () => Promise.resolve([adjustment]),
    resolveGenerationInput: () => Promise.resolve(undefined),
    queueGenerated: () => Promise.resolve(adjustment),
    get: () => Promise.resolve(adjustment),
    approve: () => Promise.resolve(programme),
    reject: () => Promise.resolve(adjustment),
    ...overrides,
  };
}

function accountabilityPort(overrides: Partial<AccountabilityPort> = {}): AccountabilityPort {
  return {
    get: () => Promise.resolve(accountability),
    loadInputs: () => Promise.reject(new Error("not used")),
    commitDecision: () => Promise.reject(new Error("not used")),
    ...overrides,
  };
}

describe("query use cases", () => {
  it("passes through all list and scorecard queries", async () => {
    await expect(new ListDemoClients(clientPort()).execute()).resolves.toEqual([client]);
    await expect(new ListClientMessages(clientPort()).execute(ids.client)).resolves.toEqual([]);
    await expect(
      new ListProgrammes(programmePort()).execute({ clientId: ids.client }),
    ).resolves.toEqual([programme]);
    await expect(
      new ListSessions(sessionPort()).execute({ clientId: ids.client }),
    ).resolves.toEqual([session]);
    await expect(
      new ListAdjustments(adjustmentPort()).execute({ clientId: ids.client }),
    ).resolves.toEqual([adjustment]);
    const port: ScorecardPort = { get: () => Promise.resolve(scorecard) };
    await expect(new GetScorecard(port).execute()).resolves.toEqual(scorecard);
  });

  it("returns available single resources", async () => {
    await expect(
      new GetClientDetail(clientPort()).execute(ids.client, effectiveAt),
    ).resolves.toEqual(detail);
    await expect(
      new GetClientToday(clientPort()).execute(ids.client, effectiveAt),
    ).resolves.toEqual(today);
    await expect(new GetProgrammeReview(programmePort()).execute(ids.programme)).resolves.toEqual(
      review,
    );
    await expect(new GetSession(sessionPort()).execute(ids.session)).resolves.toEqual(session);
    await expect(
      new GetAccountabilityState(accountabilityPort()).execute(ids.client),
    ).resolves.toEqual(accountability);
    const traces: TracePort = {
      persistBeforeModel: () => Promise.resolve(),
      get: () => Promise.resolve(trace),
    };
    await expect(new GetContextTrace(traces).execute(ids.trace)).resolves.toEqual(trace);
  });

  it("fails missing resources and rejects client leakage of a queued programme", async () => {
    await expect(
      new GetClientDetail(clientPort({ getDetail: () => Promise.resolve(undefined) })).execute(
        ids.client,
        effectiveAt,
      ),
    ).rejects.toMatchObject({ code: "client_not_found" });
    await expect(
      new GetClientToday(clientPort({ getToday: () => Promise.resolve(undefined) })).execute(
        ids.client,
        effectiveAt,
      ),
    ).rejects.toMatchObject({ code: "client_not_found" });
    const leaked = todaySchema.parse({ ...today, programme });
    await expect(
      new GetClientToday(clientPort({ getToday: () => Promise.resolve(leaked) })).execute(
        ids.client,
        effectiveAt,
      ),
    ).rejects.toMatchObject({ code: "internal_error" });
    await expect(
      new GetProgrammeReview(
        programmePort({ getReview: () => Promise.resolve(undefined) }),
      ).execute(ids.programme),
    ).rejects.toMatchObject({ code: "programme_not_found" });
    await expect(
      new GetSession(sessionPort({ get: () => Promise.resolve(undefined) })).execute(ids.session),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      new GetAccountabilityState(
        accountabilityPort({ get: () => Promise.resolve(undefined) }),
      ).execute(ids.client),
    ).rejects.toMatchObject({ code: "client_not_found" });
    const traces: TracePort = {
      persistBeforeModel: () => Promise.resolve(),
      get: () => Promise.resolve(undefined),
    };
    await expect(new GetContextTrace(traces).execute(ids.trace)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
