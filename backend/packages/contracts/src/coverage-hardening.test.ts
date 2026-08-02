import { describe, expect, it } from "vitest";

import {
  accountabilityModelOutputSchema,
  accountabilityStateSchema,
  actualExerciseSchema,
  adjustmentSchema,
  agentRunSchema,
  engagementInputsSchema,
  ianaTimezoneSchema,
  isoDateSchema,
  listSessionsQuerySchema,
  programmePayloadSchema,
  programmeSchema,
  repetitionSchema,
  sessionSchema,
} from "./index";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const instant = "2026-08-02T12:00:00.000Z";
const exercise = {
  family: "squat",
  id,
  loadKg: 40,
  muscleGroups: ["quadriceps"],
  name: "Squat",
  notes: null,
  reps: 5,
  restSeconds: 90,
  rpe: 7,
  sets: 3,
} as const;
const programmePayload = {
  days: [
    {
      dayIndex: 1,
      exercises: [exercise],
      focus: "Strength",
      scheduledDate: "2026-08-03",
    },
  ],
  summary: "Synthetic week",
};
const programme = {
  approvedAt: null,
  approvedBy: null,
  clientId: id,
  createdAt: instant,
  generatedBy: id,
  id,
  mesocycle: 1,
  payload: programmePayload,
  reviewBand: "clear",
  status: "queued",
  supersededBy: null,
  validFrom: null,
  version: 1,
  week: 1,
} as const;

describe("cross-field contract invariants", () => {
  it("rejects impossible seven and fourteen day engagement counts independently", () => {
    const inputs = {
      baselineCheckInCount: 0,
      baselineCheckInLatencyHours: null,
      completedDue14d: 2,
      completedDue7d: 1,
      currentCheckInLatencyHours: null,
      daysSinceOpen: null,
      missedDue14d: 0,
      missedDue7d: 0,
      plannedDue14d: 2,
      plannedDue7d: 1,
      rpeDrift: null,
    };

    expect(engagementInputsSchema.safeParse(inputs).success).toBe(true);
    expect(engagementInputsSchema.safeParse({ ...inputs, completedDue7d: 2 }).success).toBe(false);
    expect(engagementInputsSchema.safeParse({ ...inputs, completedDue14d: 3 }).success).toBe(false);
  });

  it("enforces escalated ownership, automation, and churn state independently", () => {
    const state = {
      automationPaused: true,
      churnFlagged: false,
      clientId: id,
      lastTransitionAt: instant,
      owner: "coach",
      tier: 3,
      version: 1,
    } as const;

    expect(accountabilityStateSchema.safeParse(state).success).toBe(true);
    expect(accountabilityStateSchema.safeParse({ ...state, automationPaused: false }).success).toBe(
      false,
    );
    expect(accountabilityStateSchema.safeParse({ ...state, owner: "none" }).success).toBe(false);
    expect(accountabilityStateSchema.safeParse({ ...state, tier: 4 }).success).toBe(false);
    expect(
      accountabilityStateSchema.safeParse({ ...state, churnFlagged: true, tier: 4 }).success,
    ).toBe(true);
  });

  it("requires both approval metadata and the applied programme reference", () => {
    const adjustment = {
      appliedProgrammeId: null,
      approvedAt: null,
      approvedBy: null,
      baseProgrammeId: id,
      clientId: id,
      createdAt: instant,
      id,
      operations: [
        {
          exerciseId: id,
          percent: 20,
          rationale: "Readiness is low",
          type: "reduce_load",
        },
      ],
      reviewBand: "attention",
      sourceEventKey: "coverage-adjustment",
      status: "queued",
      trigger: { coachId: id, type: "explicit_coach" },
      version: 1,
    } as const;

    expect(adjustmentSchema.safeParse(adjustment).success).toBe(true);
    expect(adjustmentSchema.safeParse({ ...adjustment, status: "approved" }).success).toBe(false);
    expect(
      adjustmentSchema.safeParse({
        ...adjustment,
        approvedAt: instant,
        approvedBy: id,
        status: "approved",
      }).success,
    ).toBe(true);
    expect(
      adjustmentSchema.safeParse({
        ...adjustment,
        approvedAt: instant,
        approvedBy: id,
        status: "applied",
      }).success,
    ).toBe(false);
    expect(
      adjustmentSchema.safeParse({
        ...adjustment,
        appliedProgrammeId: otherId,
        approvedAt: instant,
        approvedBy: id,
        status: "applied",
      }).success,
    ).toBe(true);
  });

  it("rejects tier and content-kind disagreement at the model boundary", () => {
    const citation = { claim: "Synthetic evidence", recordIds: [id], sectionId: "profile" };
    const valid = {
      body: "A short synthetic nudge",
      citations: [citation],
      kind: "client_nudge",
      tier: 1,
    } as const;

    expect(accountabilityModelOutputSchema.safeParse(valid).success).toBe(true);
    expect(accountabilityModelOutputSchema.safeParse({ ...valid, tier: 0 }).success).toBe(false);
    expect(
      accountabilityModelOutputSchema.safeParse({ ...valid, kind: "reduced_plan_offer" }).success,
    ).toBe(false);
  });

  it("requires exactly one agent-run result channel", () => {
    const base = {
      agent: "accountability",
      createdAt: instant,
      errorCode: "dependency_unavailable",
      id,
      latencyMs: 1,
      mode: "recorded",
      model: "recorded-v1",
      output: null,
      promptVersion: "accountability.v1",
      traceId: otherId,
      usage: null,
    } as const;

    expect(agentRunSchema.safeParse(base).success).toBe(true);
    expect(agentRunSchema.safeParse({ ...base, errorCode: null }).success).toBe(false);
    expect(
      agentRunSchema.safeParse({
        ...base,
        output: {
          body: "A short synthetic nudge",
          citations: [{ claim: "Synthetic evidence", recordIds: [id], sectionId: "profile" }],
          kind: "client_nudge",
          tier: 1,
        },
      }).success,
    ).toBe(false);
  });
});

describe("date, programme, and session refinements", () => {
  it("validates calendar days and IANA timezone identifiers", () => {
    expect(isoDateSchema.safeParse("2026-12-31").success).toBe(true);
    expect(isoDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(ianaTimezoneSchema.safeParse("Africa/Cairo").success).toBe(true);
    expect(ianaTimezoneSchema.safeParse("Not/A_Timezone").success).toBe(false);
  });

  it("enforces repetition ordering and unique programme day identity", () => {
    expect(repetitionSchema.safeParse({ max: 8, min: 5 }).success).toBe(true);
    expect(repetitionSchema.safeParse({ max: 4, min: 5 }).success).toBe(false);
    expect(programmePayloadSchema.safeParse(programmePayload).success).toBe(true);
    expect(
      programmePayloadSchema.safeParse({
        ...programmePayload,
        days: [
          programmePayload.days[0],
          { ...programmePayload.days[0], scheduledDate: "2026-08-04" },
        ],
      }).success,
    ).toBe(false);
    expect(
      programmePayloadSchema.safeParse({
        ...programmePayload,
        days: [programmePayload.days[0], { ...programmePayload.days[0], dayIndex: 2 }],
      }).success,
    ).toBe(false);
  });

  it("enforces published and superseded programme lifecycle metadata", () => {
    expect(programmeSchema.safeParse(programme).success).toBe(true);
    expect(programmeSchema.safeParse({ ...programme, status: "published" }).success).toBe(false);
    expect(programmeSchema.safeParse({ ...programme, status: "superseded" }).success).toBe(false);
    expect(
      programmeSchema.safeParse({ ...programme, status: "superseded", supersededBy: otherId })
        .success,
    ).toBe(true);
  });

  it("rejects duplicate actual sets and incomplete completed-session metadata", () => {
    const set = { completed: true, loadKg: 40, reps: 5, rpe: 8, setIndex: 1 };
    const actual = { exerciseId: id, sets: [set] };
    const scheduled = {
      actual: null,
      clientId: id,
      id,
      notes: null,
      performedAt: null,
      planned: [exercise],
      programmeId: otherId,
      rpe: null,
      scheduledFor: "2026-08-03",
      status: "scheduled",
      version: 1,
    } as const;

    expect(actualExerciseSchema.safeParse(actual).success).toBe(true);
    expect(actualExerciseSchema.safeParse({ ...actual, sets: [set, set] }).success).toBe(false);
    expect(sessionSchema.safeParse(scheduled).success).toBe(true);
    expect(sessionSchema.safeParse({ ...scheduled, status: "completed" }).success).toBe(false);
    expect(
      sessionSchema.safeParse({
        ...scheduled,
        actual: [actual],
        performedAt: instant,
        rpe: 8,
        status: "completed",
      }).success,
    ).toBe(true);
  });

  it("rejects inverted optional session ranges", () => {
    expect(listSessionsQuerySchema.safeParse({ clientId: id }).success).toBe(true);
    expect(
      listSessionsQuerySchema.safeParse({
        clientId: id,
        from: "2026-08-04",
        to: "2026-08-03",
      }).success,
    ).toBe(false);
    expect(listSessionsQuerySchema.safeParse({ clientId: id, from: "2026-08-03" }).success).toBe(
      true,
    );
  });
});
