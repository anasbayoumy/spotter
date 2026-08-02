import { describe, expect, it } from "vitest";

import {
  accountabilityStateSchema,
  actualSetSchema,
  adjustmentModelOutputSchema,
  apiContracts,
  apiResponseSchema,
  clientConstraintSchema,
  contextTraceSchema,
  createCheckInRequestSchema,
  editAdjustmentRequestSchema,
  idempotencyKeySchema,
  isoDateSchema,
  programmeModelOutputSchema,
  prescribedExerciseSchema,
  programmeSchema,
  scorecardSchema,
} from "./index";

const id = "00000000-0000-4000-8000-000000000001";
const instant = "2026-08-02T12:00:00.000Z";
const exercise = {
  id,
  name: "Squat",
  family: "squat",
  muscleGroups: ["quadriceps"],
  sets: 3,
  reps: 5,
  rpe: 7,
  restSeconds: 90,
  notes: null,
};
const payload = {
  summary: "Synthetic week",
  days: [{ dayIndex: 1, scheduledDate: "2026-08-03", focus: "Strength", exercises: [exercise] }],
};

describe("contract primitives", () => {
  it("validates real calendar dates and bounded idempotency keys", () => {
    expect(isoDateSchema.safeParse("2024-02-29").success).toBe(true);
    expect(isoDateSchema.safeParse("2023-02-29").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("session:complete:123").success).toBe(true);
    expect(idempotencyKeySchema.safeParse("bad key").success).toBe(false);
  });

  it("keeps response success and failure mutually exclusive and strict", () => {
    const schema = apiResponseSchema(isoDateSchema);
    expect(
      schema.safeParse({ data: "2026-08-02", error: null, meta: { requestId: "request-123" } })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        data: null,
        error: { code: "not_found", message: "Missing" },
        meta: { requestId: "request-123" },
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        data: "2026-08-02",
        error: { code: "not_found", message: "Missing" },
        meta: { requestId: "request-123" },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: "2026-08-02",
        error: null,
        meta: { requestId: "request-123" },
        leaked: true,
      }).success,
    ).toBe(false);
  });
});

describe("safety-critical persisted JSON", () => {
  const constraint = {
    id,
    clientId: id,
    kind: "injury",
    severity: "hard",
    source: "coach_entered",
    detail: { region: "shoulder", forbids: ["overhead_press"], modifies: [], note: null },
    validFrom: instant,
    validUntil: null,
    createdAt: instant,
  };

  it("rejects inferred hard and non-positive validity windows", () => {
    expect(clientConstraintSchema.safeParse(constraint).success).toBe(true);
    expect(clientConstraintSchema.safeParse({ ...constraint, source: "inferred" }).success).toBe(
      false,
    );
    expect(clientConstraintSchema.safeParse({ ...constraint, validUntil: instant }).success).toBe(
      false,
    );
  });

  it("requires publication and supersession metadata", () => {
    const base = {
      id,
      clientId: id,
      mesocycle: 1,
      week: 1,
      payload,
      status: "published",
      reviewBand: "clear",
      generatedBy: id,
      approvedBy: id,
      approvedAt: instant,
      supersededBy: null,
      validFrom: instant,
      createdAt: instant,
      version: 1,
    };
    expect(programmeSchema.safeParse(base).success).toBe(true);
    expect(programmeSchema.safeParse({ ...base, approvedBy: null }).success).toBe(false);
    expect(programmeSchema.safeParse({ ...base, status: "superseded" }).success).toBe(false);
  });

  it("rejects NaN, infinity, negative load and invalid readiness", () => {
    const actual = { setIndex: 1, reps: 5, loadKg: 10, rpe: 8, completed: true };
    expect(actualSetSchema.safeParse(actual).success).toBe(true);
    expect(actualSetSchema.safeParse({ ...actual, loadKg: Number.POSITIVE_INFINITY }).success).toBe(
      false,
    );
    expect(actualSetSchema.safeParse({ ...actual, reps: -1 }).success).toBe(false);
    expect(
      createCheckInRequestSchema.safeParse({
        clientId: id,
        readiness: 0,
        body: "Tired",
        respondedAt: instant,
      }).success,
    ).toBe(false);
  });

  it("accepts an optional bounded prescribed load and strict adjustment edit operations", () => {
    expect(prescribedExerciseSchema.parse(exercise).loadKg).toBeUndefined();
    expect(prescribedExerciseSchema.parse({ ...exercise, loadKg: 40 }).loadKg).toBe(40);
    expect(prescribedExerciseSchema.safeParse({ ...exercise, loadKg: -1 }).success).toBe(false);
    expect(prescribedExerciseSchema.safeParse({ ...exercise, loadKg: 2_001 }).success).toBe(false);
    expect(
      editAdjustmentRequestSchema.safeParse({
        expectedVersion: 1,
        operations: [
          {
            exerciseId: id,
            percent: 25,
            rationale: "Reduce the explicit prescription.",
            type: "reduce_load",
          },
        ],
        appliedProgrammeId: id,
      }).success,
    ).toBe(false);
  });

  it("enforces coach-owned upper accountability tiers", () => {
    const state = {
      clientId: id,
      tier: 3,
      owner: "coach",
      lastTransitionAt: instant,
      automationPaused: true,
      churnFlagged: false,
      version: 1,
    };
    expect(accountabilityStateSchema.safeParse(state).success).toBe(true);
    expect(accountabilityStateSchema.safeParse({ ...state, owner: "automation" }).success).toBe(
      false,
    );
    expect(accountabilityStateSchema.safeParse({ ...state, tier: 4 }).success).toBe(false);
  });
});

describe("model and trace boundaries", () => {
  const citation = {
    sectionId: "hard_constraints",
    recordIds: [id],
    claim: "Avoid overhead pressing",
  };

  it("accepts only structured programme and reducing adjustment outputs", () => {
    expect(programmeModelOutputSchema.safeParse({ payload, citations: [citation] }).success).toBe(
      true,
    );
    expect(programmeModelOutputSchema.safeParse({ text: "Do some squats" }).success).toBe(false);
    expect(
      adjustmentModelOutputSchema.safeParse({
        operations: [{ type: "reduce_load", exerciseId: id, percent: 10, rationale: "High RPE" }],
        citations: [citation],
      }).success,
    ).toBe(true);
    expect(
      adjustmentModelOutputSchema.safeParse({
        operations: [{ type: "increase_load", percent: 10 }],
        citations: [citation],
      }).success,
    ).toBe(false);
  });

  it("rejects traces that exceed their declared budget", () => {
    const trace = {
      id,
      clientId: id,
      turnId: id,
      intent: "programme",
      sections: [],
      rendered: "context",
      tokenCount: 101,
      budget: 100,
      createdAt: instant,
    };
    expect(contextTraceSchema.safeParse(trace).success).toBe(false);
    expect(contextTraceSchema.safeParse({ ...trace, tokenCount: 100 }).success).toBe(true);
  });
});

describe("API inventory and metrics", () => {
  it("exposes every documented capability family", () => {
    expect(Object.keys(apiContracts)).toEqual([
      "clients",
      "programmes",
      "sessions",
      "checkIns",
      "adjustments",
      "accountability",
      "traces",
      "scorecard",
      "jobs",
    ]);
  });

  it("never represents unavailable scorecard metrics as zero", () => {
    const metric = { value: null, sampleSize: 0, availability: "unavailable" };
    const scorecard = {
      generatedAt: instant,
      mode: "recorded",
      safetyPassRateByGate: {},
      judgeDistribution: {},
      calibrationKappaByJudge: {},
      bandAccuracy: metric,
      costPerPublishedPlanUsd: metric,
      latencyP50Ms: metric,
      latencyP95Ms: metric,
    };
    expect(scorecardSchema.safeParse(scorecard).success).toBe(true);
    expect(
      scorecardSchema.safeParse({ ...scorecard, bandAccuracy: { ...metric, value: 0 } }).success,
    ).toBe(false);
  });
});
