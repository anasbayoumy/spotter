import { describe, expect, it } from "vitest";

import {
  Adjustment,
  AccountabilityState,
  DomainError,
  EntityId,
  Programme,
  RequestFingerprint,
  assertExpectedVersion,
  calculateAdherence,
  calculateAccountabilityTier,
  calculateReviewBand,
  canSendAutomatedMessage,
  breachesIntensityCeiling,
  breachesFrequency,
  containsConfiguredPattern,
  inferredConstraintSeverityIsValid,
  isMovementAllowed,
  isVolumeSpike,
  validateAdjustmentOperations,
} from "./index.js";
import type {
  ProgrammeDay,
  ProgrammeExercise,
  ProgrammePayload,
  ProgrammeState,
} from "./programme.js";

const IDS = {
  client: "00000000-0000-4000-8000-000000000103",
  coach: "00000000-0000-4000-8000-000000000104",
  exercise: "00000000-0000-4000-8000-000000000105",
  programme: "00000000-0000-4000-8000-000000000101",
} as const;
const NOW = new Date("2026-08-02T12:00:00.000Z");

function exercise(): ProgrammeExercise {
  return { family: "hinge", id: IDS.exercise, name: "Deadlift", rpe: 7, sets: 3 };
}

function day(dayIndex = 1, patch: Partial<ProgrammeDay> = {}): ProgrammeDay {
  return {
    dayIndex,
    scheduledDate: `2026-08-${String(dayIndex + 2).padStart(2, "0")}`,
    exercises: [exercise()],
    ...patch,
  };
}

function state(patch: Partial<ProgrammeState> = {}): ProgrammeState {
  return {
    id: IDS.programme,
    clientId: IDS.client,
    slotKey: "2026-W32",
    payload: { summary: "  Reviewed week  ", days: [day()] },
    status: "draft",
    reviewBand: null,
    approvedBy: null,
    approvedAt: null,
    supersededBy: null,
    sourceProgrammeId: null,
    version: 1,
    ...patch,
  };
}

function expectDomainFailure(action: () => void, code: DomainError["code"], message: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainError);
  if (!(thrown instanceof DomainError)) throw thrown;
  expect(thrown.code).toBe(code);
  expect(thrown.message).toBe(message);
}

describe("programme mutation boundaries", () => {
  it("accepts the inclusive maximum of fourteen days and twenty exercises", () => {
    const days = Array.from({ length: 14 }, (_, index) => day(index + 1));
    const maximumExerciseDay = day(1, {
      exercises: Array.from({ length: 20 }, () => exercise()),
    });
    expect(
      new Programme(state({ payload: { summary: "Week", days } })).snapshot().payload.days,
    ).toHaveLength(14);
    expect(
      new Programme(state({ payload: { summary: "Week", days: [maximumExerciseDay] } })).snapshot()
        .payload.days[0]?.exercises,
    ).toHaveLength(20);
    expect(
      new Programme(
        state({
          payload: {
            summary: "Week",
            days: [
              day(1, {
                exercises: [
                  { ...exercise(), rpe: 1, sets: 1 },
                  { ...exercise(), id: "00000000-0000-4000-8000-000000000106", rpe: 10, sets: 20 },
                ],
              }),
            ],
          },
        }),
      ).snapshot().payload.days[0]?.exercises,
    ).toHaveLength(2);
  });

  it("rejects absent programme content with the stable domain explanation", () => {
    for (const payload of [
      { summary: " ", days: [day()] },
      { summary: "Week", days: [] },
    ] satisfies ProgrammePayload[]) {
      expectDomainFailure(
        () => new Programme(state({ payload })),
        "invalid_value",
        "Programme requires a summary and one to fourteen days",
      );
    }
  });

  it("rejects decimal, zero, and duplicate programme-day identity", () => {
    for (const days of [
      [day(1.5)],
      [day(0)],
      [day(15)],
      [day(1), day(1, { scheduledDate: "2026-08-04" })],
      [day(1), day(2, { scheduledDate: "2026-08-03" })],
      [
        ...Array.from({ length: 14 }, (_, index) => day(index + 1)),
        day(14, {
          scheduledDate: "2026-08-31",
        }),
      ],
    ]) {
      expectDomainFailure(
        () => new Programme(state({ payload: { summary: "Week", days } })),
        "invalid_value",
        "Programme days require unique valid indexes and dates",
      );
    }
  });

  it("rejects empty exercise lists and malformed exercise values", () => {
    expectDomainFailure(
      () =>
        new Programme(state({ payload: { summary: "Week", days: [day(1, { exercises: [] })] } })),
      "invalid_value",
      "Programme days require one to twenty exercises",
    );
    expectDomainFailure(
      () =>
        new Programme(
          state({
            payload: {
              summary: "Week",
              days: [day(1, { exercises: Array.from({ length: 21 }, () => exercise()) })],
            },
          }),
        ),
      "invalid_value",
      "Programme days require one to twenty exercises",
    );
    for (const malformed of [
      { ...exercise(), name: " " },
      { ...exercise(), family: " " },
      { ...exercise(), sets: 1.5 },
      { ...exercise(), rpe: 0 },
    ]) {
      expectDomainFailure(
        () =>
          new Programme(
            state({ payload: { summary: "Week", days: [day(1, { exercises: [malformed] })] } }),
          ),
        "invalid_value",
        "Invalid prescribed exercise",
      );
    }
  });

  it("rejects invalid programme identity and illegal queue/approval states with stable evidence", () => {
    expectDomainFailure(
      () => new Programme(state({ version: 0 })),
      "invalid_value",
      "Invalid programme identity or version",
    );
    const queued = new Programme(state()).queue("clear", 1);
    expectDomainFailure(
      () => queued.queue("clear", 2),
      "invalid_state_transition",
      "Only a draft can be queued",
    );
    expectDomainFailure(
      () => new Programme(state()).approve(IDS.coach, NOW, 1),
      "invalid_state_transition",
      "Only a queued programme can be approved",
    );
  });

  it("protects blocked publication and increments a valid reasoned override", () => {
    const blocked = new Programme(state()).queue("blocked", 1);
    expectDomainFailure(
      () => blocked.approve(IDS.coach, NOW, 2),
      "blocked_requires_override",
      "Blocked programmes require an override",
    );
    expect(
      blocked.override(IDS.coach, NOW, "Coach reviewed the risk.", 2).snapshot(),
    ).toMatchObject({
      status: "published",
      version: 3,
    });
    const attention = new Programme(state()).queue("attention", 1);
    expectDomainFailure(
      () => attention.override(IDS.coach, NOW, "Not blocked.", 2),
      "invalid_state_transition",
      "Only a queued blocked programme can be overridden",
    );
  });

  it("stores normalized content and rejects published rows missing either approval field", () => {
    const snapshot = new Programme(
      state({
        payload: {
          summary: "  Week  ",
          days: [
            day(1, { exercises: [{ ...exercise(), family: "  hinge  ", name: "  Deadlift  " }] }),
          ],
        },
      }),
    ).snapshot();
    expect(snapshot.payload.summary).toBe("Week");
    expect(new Programme(state({ slotKey: "  2026-W32  " })).snapshot().slotKey).toBe("2026-W32");
    expect(snapshot.payload.days[0]?.exercises[0]).toMatchObject({
      family: "hinge",
      name: "Deadlift",
    });

    for (const patch of [
      { approvedAt: NOW, approvedBy: null },
      { approvedAt: null, approvedBy: IDS.coach },
    ]) {
      expectDomainFailure(
        () => new Programme(state({ ...patch, status: "published" })),
        "invalid_value",
        "Published programmes require coach approval",
      );
    }
    expectDomainFailure(
      () => new Programme(state({ status: "superseded", supersededBy: null })),
      "invalid_value",
      "Superseded programmes require a successor",
    );
  });

  it("permits both documented rejection sources and keeps terminal history immutable", () => {
    expect(new Programme(state()).reject(1).snapshot().status).toBe("rejected");
    expect(new Programme(state()).queue("attention", 1).reject(2).snapshot().status).toBe(
      "rejected",
    );
    const rejected = new Programme(state()).reject(1);
    expectDomainFailure(
      () => rejected.revise("00000000-0000-4000-8000-000000000102", state().payload, 2),
      "invalid_state_transition",
      "Rejected or superseded programmes cannot be edited",
    );
    const published = new Programme(
      state({ approvedAt: NOW, approvedBy: IDS.coach, reviewBand: "clear", status: "published" }),
    );
    expectDomainFailure(
      () => published.reject(1),
      "invalid_state_transition",
      "Only draft or queued programmes can be rejected",
    );
    expectDomainFailure(
      () => new Programme(state()).supersede("00000000-0000-4000-8000-000000000102", 1),
      "invalid_state_transition",
      "Only a published programme can be superseded",
    );
  });
});

describe("deterministic safety mutation boundaries", () => {
  it("keeps any failed binary gate blocking even when another gate passes", () => {
    expect(calculateReviewBand([{ passed: true }, { passed: false }], [{ score: 5 }])).toBe(
      "blocked",
    );
  });

  it("normalizes movement input and preserves low-adherence boundaries", () => {
    expect(isMovementAllowed("  squat  ", new Set(["squat"]), new Set())).toBe(true);
    expect(isMovementAllowed(" ", new Set([""]), new Set())).toBe(false);
    expect(isVolumeSpike(10, 11, 0)).toBe(false);
    expect(isVolumeSpike(0, 0, 0.5)).toBe(false);
    expect(isVolumeSpike(10, 9, 0.5)).toBe(false);
    expectDomainFailure(
      () => isVolumeSpike(-1, 2, 0.5),
      "invalid_value",
      "Invalid volume/adherence input",
    );
    expectDomainFailure(() => breachesFrequency(-1, 2), "invalid_value", "Invalid frequency");
    expect(breachesFrequency(0, 0)).toBe(false);
    expect(breachesIntensityCeiling(1, true)).toBe(false);
    expectDomainFailure(() => breachesIntensityCeiling(11, true), "invalid_value", "Invalid RPE");
  });

  it("matches any configured pattern and never promotes inferred constraints to hard", () => {
    expect(containsConfiguredPattern("medical warning", [/diagnosis/u, /medical/u])).toBe(true);
    expect(inferredConstraintSeverityIsValid("inferred", "hard")).toBe(false);
    expect(inferredConstraintSeverityIsValid("inferred", "soft")).toBe(true);
    expect(inferredConstraintSeverityIsValid("coach_entered", "hard")).toBe(true);
  });
});

describe("adjustment mutation boundaries", () => {
  const base = {
    id: "00000000-0000-4000-8000-000000000107",
    clientId: IDS.client,
    baseProgrammeId: IDS.programme,
    sourceEventKey: "event001",
    operations: [{ type: "reduce_load" as const, exerciseId: IDS.exercise, percent: 10 }],
    status: "draft" as const,
    approvedBy: null,
    approvedAt: null,
    appliedProgrammeId: null,
    version: 1,
  };

  it("accepts the inclusive eight-character event key boundary", () => {
    const operation = base.operations[0];
    if (operation === undefined) throw new Error("Adjustment fixture requires one operation");
    expect(new Adjustment(base).snapshot().sourceEventKey).toBe("event001");
    expect(
      new Adjustment({ ...base, sourceEventKey: "  event001  " }).snapshot().sourceEventKey,
    ).toBe("event001");
    expect(validateAdjustmentOperations(Array.from({ length: 100 }, () => operation))).toHaveLength(
      100,
    );
  });

  it("rejects either form of partial approval metadata", () => {
    for (const patch of [
      { approvedBy: IDS.coach, approvedAt: null },
      { approvedBy: null, approvedAt: NOW },
    ]) {
      expectDomainFailure(
        () => new Adjustment({ ...base, ...patch, status: "approved" }),
        "invalid_value",
        "Approved adjustments require coach metadata",
      );
    }
    const queued = new Adjustment(base).queue(1);
    expect(queued.markStale(2).snapshot()).toMatchObject({ status: "stale", version: 3 });
  });
});

describe("core value mutation boundaries", () => {
  it("normalizes entity IDs and rejects either missing UUID anchor", () => {
    const canonical = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(new EntityId(canonical.toUpperCase()).value).toBe(canonical);
    for (const malformed of [`x${canonical}`, `${canonical}x`]) {
      expectDomainFailure(
        () => new EntityId(malformed),
        "invalid_value",
        "Entity ID must be a UUID",
      );
    }
  });

  it("retains fingerprint diagnostics and version-conflict evidence", () => {
    for (const malformed of ["g".repeat(64), `${"a".repeat(64)}x`]) {
      expectDomainFailure(
        () => new RequestFingerprint(malformed),
        "invalid_value",
        "Request fingerprint must be a SHA-256 hex digest",
      );
    }
    let thrown: unknown;
    try {
      assertExpectedVersion(1.5, 1.5);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: "version_conflict",
      message: "The resource version changed",
      details: { actual: 1.5, expected: 1.5 },
    });
  });
});

describe("accountability mutation boundaries", () => {
  const engagement = {
    plannedDue14d: 4,
    completedDue14d: 4,
    missedDue7d: 0,
    missedDue14d: 0,
    currentCheckInLatencyHours: null,
    baselineCheckInLatencyHours: null,
    baselineCheckInCount: 0,
    daysSinceOpen: 0,
  } as const;

  it("preserves stable validation evidence while accepting zero current latency", () => {
    expectDomainFailure(
      () => calculateAdherence(2, 1),
      "invalid_value",
      "Invalid adherence counts",
    );
    expectDomainFailure(
      () => calculateAccountabilityTier({ ...engagement, missedDue7d: -1 }),
      "invalid_value",
      "Engagement counts must be non-negative integers",
    );
    expect(calculateAccountabilityTier({ ...engagement, currentCheckInLatencyHours: 0 })).toBe(0);
    expectDomainFailure(
      () => calculateAccountabilityTier({ ...engagement, currentCheckInLatencyHours: -1 }),
      "invalid_value",
      "Invalid engagement recency or latency",
    );
  });

  it("does not apply percentage adherence with only one due session", () => {
    expect(
      calculateAccountabilityTier({ ...engagement, completedDue14d: 0, plannedDue14d: 1 }),
    ).toBe(0);
    expect(
      calculateAccountabilityTier({
        ...engagement,
        baselineCheckInCount: 0,
        baselineCheckInLatencyHours: 3,
        currentCheckInLatencyHours: 6,
      }),
    ).toBe(0);
    expect(
      calculateAccountabilityTier({
        ...engagement,
        baselineCheckInCount: 2,
        baselineCheckInLatencyHours: null,
        currentCheckInLatencyHours: 1,
      }),
    ).toBe(0);
  });

  it("allows a coach-owned tier three escalation to increase to churn tier four", () => {
    const stateValue = new AccountabilityState({
      tier: 3,
      owner: "coach",
      automationPaused: true,
      churnFlagged: false,
      version: 1,
    });
    expect(stateValue.transition(4).snapshot()).toEqual({
      tier: 4,
      owner: "coach",
      automationPaused: true,
      churnFlagged: true,
      version: 2,
    });
  });

  it("fails closed on invalid message instants with stable evidence", () => {
    expectDomainFailure(
      () => canSendAutomatedMessage(null, new Date("invalid")),
      "invalid_value",
      "Invalid message instant",
    );
  });

  it("validates persisted state and fully releases coach ownership", () => {
    for (const invalid of [
      {
        tier: 3,
        owner: "automation",
        automationPaused: true,
        churnFlagged: false,
        version: 1,
      },
      {
        tier: 3,
        owner: "coach",
        automationPaused: false,
        churnFlagged: false,
        version: 1,
      },
    ] as const) {
      expectDomainFailure(
        () => new AccountabilityState(invalid),
        "invalid_value",
        "Invalid accountability state",
      );
    }
    const human = new AccountabilityState({
      tier: 3,
      owner: "coach",
      automationPaused: true,
      churnFlagged: false,
      version: 1,
    });
    expectDomainFailure(
      () => human.releaseByCoach(1, " "),
      "invalid_state_transition",
      "Coach-owned state requires a recorded coach release",
    );
    expect(human.releaseByCoach(1, "coach-action-1").snapshot()).toEqual({
      tier: 1,
      owner: "automation",
      automationPaused: false,
      churnFlagged: false,
      version: 2,
    });
  });
});
