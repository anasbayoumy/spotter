import { describe, expect, it } from "vitest";

import {
  AccountabilityState,
  Adjustment,
  DomainError,
  EntityId,
  IdempotencyKey,
  Programme,
  ReadinessCheckIn,
  RequestFingerprint,
  TemporalWindow,
  TrainingSession,
  adjustmentTriggers,
  adjustmentOperationsAreReducing,
  assertExpectedVersion,
  breachesFrequency,
  breachesIntensityCeiling,
  calculateAccountabilityTier,
  calculateAdherence,
  calculateReviewBand,
  canSendAutomatedMessage,
  containsConfiguredPattern,
  inferredConstraintSeverityIsValid,
  isCurrentAt,
  isMovementAllowed,
  isVolumeSpike,
  selectCurrentAt,
  validateAdjustmentOperations,
} from "./index";

const ids = {
  programme: "00000000-0000-4000-8000-000000000001",
  programme2: "00000000-0000-4000-8000-000000000002",
  client: "00000000-0000-4000-8000-000000000003",
  coach: "00000000-0000-4000-8000-000000000004",
  exercise: "00000000-0000-4000-8000-000000000005",
  equivalence: "00000000-0000-4000-8000-000000000006",
  session: "00000000-0000-4000-8000-000000000007",
  adjustment: "00000000-0000-4000-8000-000000000008",
} as const;
const now = new Date("2026-08-02T12:00:00.000Z");
const payload = {
  summary: "Week one",
  days: [
    {
      dayIndex: 1,
      scheduledDate: "2026-08-03",
      exercises: [{ id: ids.exercise, name: "Squat", family: "squat", sets: 3, rpe: 7 }],
    },
  ],
} as const;

function expectDomainErrorCode(action: () => void, code: DomainError["code"]): void {
  let thrown: unknown;
  try {
    action();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainError);
  if (!(thrown instanceof DomainError)) throw thrown;
  expect(thrown.code).toBe(code);
}

function programme(
  status: "draft" | "queued" | "published" = "draft",
  band: "blocked" | "attention" | "clear" | null = null,
): Programme {
  return new Programme({
    id: ids.programme,
    clientId: ids.client,
    slotKey: "2026-08-03",
    payload,
    status,
    reviewBand: band,
    approvedBy: status === "published" ? ids.coach : null,
    approvedAt: status === "published" ? now : null,
    supersededBy: null,
    sourceProgrammeId: null,
    version: 1,
  });
}

describe("value objects and temporal validity", () => {
  it("normalizes UUIDs and rejects invalid IDs", () => {
    expect(new EntityId(ids.client.toUpperCase()).value).toBe(ids.client);
    expect(() => new EntityId("nope")).toThrow(DomainError);
  });

  it("bounds idempotency keys and fingerprints", () => {
    expect(new IdempotencyKey(" request:123 ").value).toBe("request:123");
    expect(() => new IdempotencyKey("short")).toThrow();
    expect(new RequestFingerprint("A".repeat(64)).value).toBe("a".repeat(64));
    expect(() => new RequestFingerprint("0".repeat(63))).toThrow();
  });

  it("uses inclusive lower and exclusive upper temporal boundaries", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-02-01T00:00:00.000Z");
    const window = new TemporalWindow(start, end);
    expect(window.isActiveAt(start)).toBe(true);
    expect(window.isActiveAt(new Date(end.valueOf() - 1))).toBe(true);
    expect(window.isActiveAt(end)).toBe(false);
    expect(
      isCurrentAt({ validFrom: start, validUntil: end, supersededBy: ids.programme2 }, start),
    ).toBe(false);
  });

  it("rejects zero-length and reversed temporal windows", () => {
    expect(() => new TemporalWindow(now, now)).toThrow();
    expect(() => new TemporalWindow(now, new Date(now.valueOf() - 1))).toThrow();
  });
});

describe("programme lifecycle", () => {
  it("queues and publishes a non-blocked programme with human metadata", () => {
    const queued = programme().queue("clear", 1);
    const published = queued.approve(ids.coach, now, 2).snapshot();
    expect(published.status).toBe("published");
    expect(published.approvedBy).toBe(ids.coach);
    expect(published.version).toBe(3);
  });

  it("blocks ordinary approval and requires a nonblank override reason", () => {
    const blocked = programme().queue("blocked", 1);
    expectDomainErrorCode(() => blocked.approve(ids.coach, now, 2), "blocked_requires_override");
    expectDomainErrorCode(
      () => blocked.override(ids.coach, now, "   ", 2),
      "override_reason_required",
    );
    expect(blocked.override(ids.coach, now, "Coach reviewed constraint", 2).snapshot().status).toBe(
      "published",
    );
  });

  it("preserves history by producing a new draft identity when revised", () => {
    const original = programme("published");
    const revision = original
      .revise(ids.programme2, { ...payload, summary: "Revised" }, 1)
      .snapshot();
    expect(original.snapshot().status).toBe("published");
    expect(revision).toMatchObject({
      id: ids.programme2,
      sourceProgrammeId: ids.programme,
      status: "draft",
      approvedBy: null,
    });
  });

  it("requires expected versions and legal transitions", () => {
    expectDomainErrorCode(() => programme().queue("clear", 2), "version_conflict");
    expectDomainErrorCode(() => programme("published").reject(1), "invalid_state_transition");
    expect(programme("published").supersede(ids.programme2, 1).snapshot()).toMatchObject({
      status: "superseded",
      supersededBy: ids.programme2,
    });
  });
});

describe("adjustment lifecycle", () => {
  function draftAdjustment(): Adjustment {
    return new Adjustment({
      id: ids.adjustment,
      clientId: ids.client,
      baseProgrammeId: ids.programme,
      sourceEventKey: "session:event:1",
      operations: [{ type: "reduce_load", exerciseId: ids.exercise, percent: 10 }],
      status: "draft",
      approvedBy: null,
      approvedAt: null,
      appliedProgrammeId: null,
      version: 1,
    });
  }

  it("cannot apply before a coach approves", () => {
    expectDomainErrorCode(
      () => draftAdjustment().apply(ids.programme, ids.programme2, 1),
      "invalid_state_transition",
    );
  });

  it("applies only against the current base programme", () => {
    const approved = draftAdjustment().queue(1).approve(ids.coach, now, 2);
    expectDomainErrorCode(
      () => approved.apply(ids.programme2, ids.programme2, 3),
      "stale_adjustment",
    );
    expect(approved.apply(ids.programme, ids.programme2, 3).snapshot()).toMatchObject({
      status: "applied",
      appliedProgrammeId: ids.programme2,
    });
  });

  it("rejects increases disguised as invalid reductions", () => {
    expectDomainErrorCode(
      () =>
        new Adjustment({
          ...draftAdjustment().snapshot(),
          operations: [{ type: "reduce_load", exerciseId: ids.exercise, percent: 0 }],
        }),
      "unsupported_adjustment",
    );
  });
});

describe("sessions and adjustment triggers", () => {
  function session(): TrainingSession {
    return new TrainingSession({
      id: ids.session,
      clientId: ids.client,
      programmeId: ids.programme,
      plannedSetCount: 4,
      actual: null,
      performedAt: null,
      rpe: null,
      version: 1,
    });
  }

  it("logs, completes, and calculates bounded completion", () => {
    const logged = session().log(
      [{ exerciseId: ids.exercise, sets: [{ setIndex: 1, reps: 5, loadKg: 50, completed: true }] }],
      1,
    );
    expect(logged.completionRatio()).toBe(0.25);
    const completed = logged.complete(9, now, 2);
    expect(adjustmentTriggers(null, completed)).toEqual(["high_rpe", "low_completion"]);
  });

  it("triggers low readiness at the inclusive boundary", () => {
    expect(adjustmentTriggers(new ReadinessCheckIn(2, "Tired", now), null)).toEqual([
      "low_readiness",
    ]);
    expect(adjustmentTriggers(new ReadinessCheckIn(3, "Fine", now), null)).toEqual([]);
  });

  it("requires actual work before completion and prevents post-completion mutation", () => {
    expect(() => session().complete(8, now, 1)).toThrow();
    const complete = session()
      .log([{ exerciseId: ids.exercise, sets: [] }], 1)
      .complete(8, now, 2);
    expect(() => complete.log([{ exerciseId: ids.exercise, sets: [] }], 3)).toThrow();
  });
});

describe("accountability policy", () => {
  const base = {
    plannedDue14d: 4,
    completedDue14d: 4,
    missedDue7d: 0,
    missedDue14d: 0,
    currentCheckInLatencyHours: null,
    baselineCheckInLatencyHours: null,
    baselineCheckInCount: 0,
    daysSinceOpen: 0,
  } as const;

  it.each([
    [{ ...base }, 0],
    [{ ...base, missedDue7d: 1, missedDue14d: 1 }, 1],
    [{ ...base, missedDue14d: 2 }, 2],
    [
      {
        ...base,
        baselineCheckInCount: 2,
        baselineCheckInLatencyHours: 3,
        currentCheckInLatencyHours: 6,
      },
      2,
    ],
    [{ ...base, plannedDue14d: 2, completedDue14d: 0 }, 3],
    [{ ...base, daysSinceOpen: 7 }, 3],
    [{ ...base, daysSinceOpen: 21 }, 4],
  ] as const)("calculates highest matching tier for %o", (inputs, tier) => {
    expect(calculateAccountabilityTier(inputs)).toBe(tier);
  });

  it("does not apply percentage adherence to sparse denominators", () => {
    expect(calculateAccountabilityTier({ ...base, plannedDue14d: 1, completedDue14d: 0 })).toBe(0);
    expect(calculateAdherence(0, 0)).toBeNull();
  });

  it("allows at exactly 48 hours and suppresses one millisecond before", () => {
    const last = new Date("2026-01-01T00:00:00.000Z");
    expect(canSendAutomatedMessage(last, new Date(last.valueOf() + 48 * 60 * 60 * 1_000 - 1))).toBe(
      false,
    );
    expect(canSendAutomatedMessage(last, new Date(last.valueOf() + 48 * 60 * 60 * 1_000))).toBe(
      true,
    );
  });

  it("keeps human-owned escalation sticky until a recorded release", () => {
    const human = new AccountabilityState({
      tier: 3,
      owner: "coach",
      automationPaused: true,
      churnFlagged: false,
      version: 1,
    });
    expect(human.transition(0)).toBe(human);
    expect(() => human.releaseByCoach(0, " ")).toThrow();
    expect(human.releaseByCoach(1, "action-1").snapshot()).toMatchObject({
      tier: 1,
      owner: "automation",
      automationPaused: false,
    });
  });
});

describe("safety policies", () => {
  it("applies blocked precedence and strict clear threshold", () => {
    expect(calculateReviewBand([{ passed: false }], [{ score: 5 }])).toBe("blocked");
    expect(calculateReviewBand([{ passed: true }], [{ score: 4 }, { score: 5 }])).toBe("clear");
    expect(calculateReviewBand([{ passed: true }], [{ score: 3 }])).toBe("attention");
    expect(calculateReviewBand([{ passed: true }], [])).toBe("attention");
  });

  it("fails unknown and forbidden movement families closed", () => {
    const known = new Set(["squat", "overhead_press"]);
    expect(isMovementAllowed("squat", known, new Set())).toBe(true);
    expect(isMovementAllowed("snatch", known, new Set())).toBe(false);
    expect(isMovementAllowed("overhead_press", known, new Set(["overhead_press"]))).toBe(false);
  });

  it("uses strict volume-spike and intensity/frequency boundaries", () => {
    expect(isVolumeSpike(10, 13, 0.59)).toBe(false);
    expect(isVolumeSpike(10, 14, 0.59)).toBe(true);
    expect(isVolumeSpike(10, 14, 0.6)).toBe(false);
    expect(breachesIntensityCeiling(9, true)).toBe(true);
    expect(breachesIntensityCeiling(8.99, true)).toBe(false);
    expect(breachesFrequency(4, 4)).toBe(false);
    expect(breachesFrequency(5, 4)).toBe(true);
  });

  it("prevents inferred hard constraints", () => {
    expect(inferredConstraintSeverityIsValid("inferred", "hard")).toBe(false);
    expect(inferredConstraintSeverityIsValid("inferred", "soft")).toBe(true);
  });
});

describe("core value boundary regressions", () => {
  it("compares and renders entity and idempotency values", () => {
    const first = new EntityId(ids.client);
    expect(first.equals(new EntityId(ids.client))).toBe(true);
    expect(first.equals(new EntityId(ids.coach))).toBe(false);
    expect(first.toString()).toBe(ids.client);
    expect(new IdempotencyKey("request:key").toString()).toBe("request:key");
  });

  it.each(["x".repeat(129), "invalid key", "💥-request"])(
    "rejects malformed idempotency key %s",
    (key) => {
      expect(() => new IdempotencyKey(key)).toThrow(DomainError);
    },
  );

  it("rejects non-integer, non-positive, and mismatched expected versions", () => {
    expectDomainErrorCode(() => {
      assertExpectedVersion(1, 1.5);
    }, "version_conflict");
    expectDomainErrorCode(() => {
      assertExpectedVersion(1, 0);
    }, "version_conflict");
    expectDomainErrorCode(() => {
      assertExpectedVersion(2, 1);
    }, "version_conflict");
    expect(() => {
      assertExpectedVersion(2, 2);
    }).not.toThrow();
  });
});

describe("temporal selection and defensive copies", () => {
  it("supports open windows and returns defensive date copies", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const window = new TemporalWindow(start, null);
    const returnedStart = window.validFrom;
    returnedStart.setUTCFullYear(2030);
    expect(window.validFrom.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(window.validUntil).toBeNull();
    expect(window.isActiveAt(new Date("2030-01-01T00:00:00.000Z"))).toBe(true);
  });

  it("returns a defensive upper bound and rejects invalid effective instants", () => {
    const end = new Date("2026-02-01T00:00:00.000Z");
    const window = new TemporalWindow(new Date("2026-01-01T00:00:00.000Z"), end);
    const returnedEnd = window.validUntil;
    expect(returnedEnd).not.toBeNull();
    returnedEnd?.setUTCFullYear(2030);
    expect(window.validUntil?.toISOString()).toBe(end.toISOString());
    expect(() => window.isActiveAt(new Date("invalid"))).toThrow(DomainError);
    expect(() => new TemporalWindow(new Date("invalid"), null)).toThrow(DomainError);
  });

  it("selects only unsuperseded records active at the effective instant", () => {
    const effectiveAt = new Date("2026-01-15T00:00:00.000Z");
    const records = [
      {
        key: "active",
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: null,
        supersededBy: null,
      },
      {
        key: "future",
        validFrom: new Date("2026-02-01T00:00:00.000Z"),
        validUntil: null,
        supersededBy: null,
      },
      {
        key: "expired",
        validFrom: new Date("2025-01-01T00:00:00.000Z"),
        validUntil: effectiveAt,
        supersededBy: null,
      },
      {
        key: "stale",
        validFrom: new Date("2025-01-01T00:00:00.000Z"),
        validUntil: null,
        supersededBy: ids.programme,
      },
    ];
    expect(selectCurrentAt(records, effectiveAt).map((record) => record.key)).toEqual(["active"]);
  });
});

describe("programme construction and rejected transition boundaries", () => {
  function state(
    overrides: Partial<ReturnType<Programme["snapshot"]>> = {},
  ): ReturnType<Programme["snapshot"]> {
    return { ...programme().snapshot(), ...overrides };
  }

  it.each([
    { summary: "", days: payload.days },
    { summary: "Week", days: [] },
    {
      summary: "Week",
      days: Array.from({ length: 15 }, (_, index) => ({
        ...payload.days[0],
        dayIndex: index + 1,
        scheduledDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
      })),
    },
  ])("rejects invalid programme shape %#", (invalidPayload) => {
    expect(() => new Programme(state({ payload: invalidPayload }))).toThrow(DomainError);
  });

  it("rejects duplicate indexes, duplicate dates, and empty exercise days", () => {
    const second = { ...payload.days[0], dayIndex: 2 };
    expect(
      () => new Programme(state({ payload: { ...payload, days: [payload.days[0], second] } })),
    ).toThrow(DomainError);
    expect(
      () =>
        new Programme(
          state({
            payload: {
              ...payload,
              days: [payload.days[0], { ...second, scheduledDate: "2026-08-04", dayIndex: 1 }],
            },
          }),
        ),
    ).toThrow(DomainError);
    expect(
      () =>
        new Programme(
          state({ payload: { ...payload, days: [{ ...payload.days[0], exercises: [] }] } }),
        ),
    ).toThrow(DomainError);
  });

  it.each([
    { name: "", family: "squat", sets: 3, rpe: 7 },
    { name: "Squat", family: "", sets: 3, rpe: 7 },
    { name: "Squat", family: "squat", sets: 0, rpe: 7 },
    { name: "Squat", family: "squat", sets: 21, rpe: 7 },
    { name: "Squat", family: "squat", sets: 3, rpe: 11 },
  ])("rejects invalid prescribed exercise %#", (overrides) => {
    const invalidExercise = { ...payload.days[0].exercises[0], ...overrides };
    expect(
      () =>
        new Programme(
          state({
            payload: { ...payload, days: [{ ...payload.days[0], exercises: [invalidExercise] }] },
          }),
        ),
    ).toThrow(DomainError);
  });

  it("rejects invalid identity/version and inconsistent persisted lifecycle metadata", () => {
    expect(() => new Programme(state({ slotKey: " " }))).toThrow(DomainError);
    expect(() => new Programme(state({ version: 0 }))).toThrow(DomainError);
    expect(
      () => new Programme(state({ status: "published", approvedBy: null, approvedAt: null })),
    ).toThrow(DomainError);
    expect(() => new Programme(state({ status: "superseded", supersededBy: null }))).toThrow(
      DomainError,
    );
  });

  it("rejects illegal queue, revise, approve, override, reject, and supersede paths", () => {
    expectDomainErrorCode(
      () => programme("queued", "clear").queue("clear", 1),
      "invalid_state_transition",
    );
    const rejected = programme().reject(1);
    expectDomainErrorCode(
      () => rejected.revise(ids.programme2, payload, 2),
      "invalid_state_transition",
    );
    expectDomainErrorCode(() => programme().approve(ids.coach, now, 1), "invalid_state_transition");
    expectDomainErrorCode(
      () => programme().queue("clear", 1).override(ids.coach, now, "reason", 2),
      "invalid_state_transition",
    );
    expectDomainErrorCode(() => programme("published").reject(1), "invalid_state_transition");
    expectDomainErrorCode(
      () => programme().supersede(ids.programme2, 1),
      "invalid_state_transition",
    );
  });

  it("rejects edits of superseded programmes", () => {
    const superseded = programme("published").supersede(ids.programme2, 1);
    expectDomainErrorCode(
      () => superseded.revise(ids.adjustment, payload, 2),
      "invalid_state_transition",
    );
  });
});

describe("adjustment operation and lifecycle boundaries", () => {
  function draft(overrides: Partial<ReturnType<Adjustment["snapshot"]>> = {}): Adjustment {
    return new Adjustment({
      id: ids.adjustment,
      clientId: ids.client,
      baseProgrammeId: ids.programme,
      sourceEventKey: "session:event:coverage",
      operations: [{ type: "reduce_load", exerciseId: ids.exercise, percent: 10 }],
      status: "draft",
      approvedBy: null,
      approvedAt: null,
      appliedProgrammeId: null,
      version: 1,
      ...overrides,
    });
  }

  it("accepts and normalizes every supported operation", () => {
    const operations = validateAdjustmentOperations([
      { type: "reduce_load", exerciseId: ids.exercise, percent: 100 },
      { type: "reduce_volume", exerciseId: ids.exercise, setsToRemove: 20 },
      {
        type: "swap_exercise",
        exerciseId: ids.exercise,
        replacementFamily: " row ",
        equivalenceId: ids.equivalence,
      },
    ]);
    expect(operations[2]).toMatchObject({ replacementFamily: "row" });
    expect(adjustmentOperationsAreReducing(operations)).toBe(true);
    expect(adjustmentOperationsAreReducing([])).toBe(false);
  });

  it.each([
    { type: "reduce_load", exerciseId: ids.exercise, percent: Number.POSITIVE_INFINITY },
    { type: "reduce_load", exerciseId: ids.exercise, percent: 101 },
    { type: "reduce_volume", exerciseId: ids.exercise, setsToRemove: 0 },
    { type: "reduce_volume", exerciseId: ids.exercise, setsToRemove: 1.5 },
    { type: "reduce_volume", exerciseId: ids.exercise, setsToRemove: 21 },
    {
      type: "swap_exercise",
      exerciseId: ids.exercise,
      replacementFamily: " ",
      equivalenceId: ids.equivalence,
    },
  ] as const)("rejects unsupported operation %#", (operation) => {
    expectDomainErrorCode(
      () => validateAdjustmentOperations([operation]),
      "unsupported_adjustment",
    );
  });

  it("rejects empty and oversized operation collections", () => {
    expectDomainErrorCode(() => validateAdjustmentOperations([]), "unsupported_adjustment");
    const operation = { type: "reduce_load" as const, exerciseId: ids.exercise, percent: 1 };
    expectDomainErrorCode(
      () => validateAdjustmentOperations(Array.from({ length: 101 }, () => operation)),
      "unsupported_adjustment",
    );
  });

  it("validates source identity/version and persisted approval/application metadata", () => {
    expect(() => draft({ sourceEventKey: "short" })).toThrow(DomainError);
    expect(() => draft({ version: 0 })).toThrow(DomainError);
    expect(() => draft({ status: "approved" })).toThrow(DomainError);
    expect(() =>
      draft({
        status: "applied",
        approvedBy: ids.coach,
        approvedAt: now,
        appliedProgrammeId: null,
      }),
    ).toThrow(DomainError);
  });

  it("covers queue/approve/reject/stale lifecycle and illegal repetitions", () => {
    const queued = draft().queue(1);
    expectDomainErrorCode(() => queued.queue(2), "invalid_state_transition");
    const rejected = queued.reject(2);
    expect(rejected.snapshot().status).toBe("rejected");
    expectDomainErrorCode(() => rejected.reject(3), "invalid_state_transition");
    expectDomainErrorCode(() => draft().approve(ids.coach, now, 1), "invalid_state_transition");
    expect(queued.markStale(2).snapshot().status).toBe("stale");
    expectDomainErrorCode(() => draft().markStale(1), "invalid_state_transition");
    const approved = queued.approve(ids.coach, now, 2);
    expect(approved.markStale(3).snapshot().status).toBe("stale");
    expect(approved.snapshot().approvedAt?.toISOString()).toBe(now.toISOString());
  });
});

describe("session input and lifecycle boundaries", () => {
  function fresh(
    overrides: Partial<ReturnType<TrainingSession["snapshot"]>> = {},
  ): TrainingSession {
    return new TrainingSession({
      id: ids.session,
      clientId: ids.client,
      programmeId: ids.programme,
      plannedSetCount: 2,
      actual: null,
      performedAt: null,
      rpe: null,
      version: 1,
      ...overrides,
    });
  }
  const validActual = [
    { exerciseId: ids.exercise, sets: [{ setIndex: 1, reps: 5, loadKg: 50, completed: true }] },
  ] as const;

  it("rejects empty/oversized work, duplicate sets, and invalid set values", () => {
    expect(() => fresh().log([], 1)).toThrow(DomainError);
    expect(() =>
      fresh().log(
        Array.from({ length: 21 }, () => validActual[0]),
        1,
      ),
    ).toThrow(DomainError);
    const maximumSets = Array.from({ length: 20 }, (_, index) => ({
      ...validActual[0].sets[0],
      setIndex: index + 1,
    }));
    expect(
      fresh({ plannedSetCount: 20 })
        .log([{ exerciseId: ids.exercise, sets: maximumSets }], 1)
        .snapshot().actual?.[0]?.sets,
    ).toHaveLength(20);
    expect(() =>
      fresh().log(
        [
          {
            exerciseId: ids.exercise,
            sets: Array.from({ length: 21 }, (_, index) => ({
              ...validActual[0].sets[0],
              setIndex: index + 1,
            })),
          },
        ],
        1,
      ),
    ).toThrow(DomainError);
    expect(() =>
      fresh().log(
        [{ exerciseId: ids.exercise, sets: [validActual[0].sets[0], validActual[0].sets[0]] }],
        1,
      ),
    ).toThrow(DomainError);
    for (const set of [
      { setIndex: 0, reps: 5, loadKg: 1, completed: true },
      { setIndex: 1.5, reps: 5, loadKg: 1, completed: true },
      { setIndex: 1, reps: -1, loadKg: 1, completed: true },
      { setIndex: 1, reps: 501, loadKg: 1, completed: true },
      { setIndex: 1, reps: 5, loadKg: -1, completed: true },
      { setIndex: 1, reps: 5, loadKg: 2_001, completed: true },
    ])
      expect(() => fresh().log([{ exerciseId: ids.exercise, sets: [set] }], 1)).toThrow(
        DomainError,
      );
  });

  it("rejects invalid session construction and inconsistent completion metadata", () => {
    expect(() => fresh({ plannedSetCount: 0 })).toThrow(DomainError);
    expect(() => fresh({ version: 0 })).toThrow(DomainError);
    expect(() => fresh({ performedAt: now, rpe: null })).toThrow(DomainError);
    expect(() => fresh({ performedAt: null, rpe: 8 })).toThrow(DomainError);
    expect(() => fresh({ performedAt: now, rpe: 8, actual: null })).toThrow(DomainError);
  });

  it("rejects invalid completion values and clamps over-completion ratio", () => {
    const logged = fresh({ plannedSetCount: 1 }).log(
      [
        {
          exerciseId: ids.exercise,
          sets: [validActual[0].sets[0], { ...validActual[0].sets[0], setIndex: 2 }],
        },
      ],
      1,
    );
    expect(logged.completionRatio()).toBe(1);
    expect(logged.snapshot().actual).toEqual([
      {
        exerciseId: ids.exercise,
        sets: [validActual[0].sets[0], { ...validActual[0].sets[0], setIndex: 2 }],
      },
    ]);
    expect(() => logged.complete(0, now, 2)).toThrow(DomainError);
    expect(() => logged.complete(11, now, 2)).toThrow(DomainError);
    expect(() => logged.complete(8, new Date("invalid"), 2)).toThrow(DomainError);
    expect(logged.complete(10, now, 2).snapshot().rpe).toBe(10);
  });

  it("does not derive session triggers until completion", () => {
    const logged = fresh().log(validActual, 1);
    expect(adjustmentTriggers(null, logged)).toEqual([]);
    expect(fresh().completionRatio()).toBe(0);
    const healthyCompletion = fresh({ plannedSetCount: 1 }).log(validActual, 1).complete(7, now, 2);
    expect(adjustmentTriggers(null, healthyCompletion)).toEqual([]);
    expect(() => healthyCompletion.complete(7, now, 3)).toThrowError(
      "Session must have uncompleted actual work before completion",
    );
    expect(() => fresh().complete(7, now, 1)).toThrowError(
      "Session must have uncompleted actual work before completion",
    );
  });

  it.each([
    [0, "fine", now],
    [6, "fine", now],
    [2.5, "fine", now],
    [2, " ", now],
    [2, "fine", new Date("invalid")],
  ] as const)("rejects invalid readiness check-in %#", (readiness, body, respondedAt) => {
    expect(() => new ReadinessCheckIn(readiness, body, respondedAt)).toThrow(DomainError);
  });
});

describe("accountability rejected inputs and state transitions", () => {
  const valid = {
    plannedDue14d: 4,
    completedDue14d: 4,
    missedDue7d: 0,
    missedDue14d: 0,
    currentCheckInLatencyHours: null,
    baselineCheckInLatencyHours: null,
    baselineCheckInCount: 0,
    daysSinceOpen: 0,
  } as const;

  it("rejects invalid adherence and engagement counts", () => {
    expect(() => calculateAdherence(2, 1)).toThrow(DomainError);
    expect(() => calculateAdherence(-1, 1)).toThrow(DomainError);
    expect(() => calculateAdherence(0.5, 1)).toThrow(DomainError);
    expect(() => calculateAccountabilityTier({ ...valid, missedDue14d: -1 })).toThrow(DomainError);
    expect(() => calculateAccountabilityTier({ ...valid, baselineCheckInCount: 1.5 })).toThrow(
      DomainError,
    );
  });

  it("rejects invalid recency and latency values", () => {
    expect(() => calculateAccountabilityTier({ ...valid, daysSinceOpen: -1 })).toThrow(DomainError);
    expect(() =>
      calculateAccountabilityTier({
        ...valid,
        currentCheckInLatencyHours: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(DomainError);
    expect(() => calculateAccountabilityTier({ ...valid, currentCheckInLatencyHours: -1 })).toThrow(
      DomainError,
    );
    expect(() => calculateAccountabilityTier({ ...valid, baselineCheckInLatencyHours: 0 })).toThrow(
      DomainError,
    );
  });

  it("enforces valid persisted states and transitions across ownership modes", () => {
    expect(
      () =>
        new AccountabilityState({
          tier: 0,
          owner: "none",
          automationPaused: false,
          churnFlagged: false,
          version: 0,
        }),
    ).toThrow(DomainError);
    expect(
      () =>
        new AccountabilityState({
          tier: 3,
          owner: "automation",
          automationPaused: false,
          churnFlagged: false,
          version: 1,
        }),
    ).toThrow(DomainError);
    expect(
      () =>
        new AccountabilityState({
          tier: 4,
          owner: "coach",
          automationPaused: true,
          churnFlagged: false,
          version: 1,
        }),
    ).toThrow(DomainError);
    const initial = new AccountabilityState({
      tier: 0,
      owner: "none",
      automationPaused: false,
      churnFlagged: false,
      version: 1,
    });
    expect(initial.transition(0)).toBe(initial);
    expect(initial.transition(1).snapshot()).toMatchObject({
      owner: "automation",
      automationPaused: false,
    });
    expect(initial.transition(3).snapshot()).toMatchObject({
      owner: "coach",
      automationPaused: true,
    });
    expect(initial.transition(4).snapshot()).toMatchObject({ owner: "coach", churnFlagged: true });
    expect(() => initial.releaseByCoach(0, "action")).toThrow(DomainError);
  });

  it("supports a coach release to silence and validates message instants", () => {
    const human = new AccountabilityState({
      tier: 3,
      owner: "coach",
      automationPaused: true,
      churnFlagged: false,
      version: 1,
    });
    expect(human.releaseByCoach(0, "action").snapshot()).toMatchObject({ tier: 0, owner: "none" });
    expect(canSendAutomatedMessage(null, now)).toBe(true);
    expect(() => canSendAutomatedMessage(null, new Date("invalid"))).toThrow(DomainError);
    expect(() => canSendAutomatedMessage(new Date("invalid"), now)).toThrow(DomainError);
  });
});

describe("safety validation error and helper branches", () => {
  it("handles zero baseline, unknown adherence, blank family, and no injury", () => {
    expect(isVolumeSpike(0, 1, 0.5)).toBe(true);
    expect(isVolumeSpike(10, 20, null)).toBe(false);
    expect(isVolumeSpike(10, 9, 0.5)).toBe(false);
    expect(isMovementAllowed(" ", new Set(["squat"]), new Set())).toBe(false);
    expect(breachesIntensityCeiling(10, false)).toBe(false);
  });

  it("rejects invalid volume, intensity, and frequency inputs", () => {
    expect(() => isVolumeSpike(-1, 1, 0.5)).toThrow(DomainError);
    expect(() => isVolumeSpike(1, 1, 1.1)).toThrow(DomainError);
    expect(() => breachesIntensityCeiling(Number.NaN, true)).toThrow(DomainError);
    expect(() => breachesIntensityCeiling(0, true)).toThrow(DomainError);
    expect(() => breachesFrequency(-1, 1)).toThrow(DomainError);
    expect(() => breachesFrequency(1.5, 1)).toThrow(DomainError);
  });

  it("tests configured patterns deterministically, including global regex state", () => {
    const global = /diagnose/gi;
    expect(containsConfiguredPattern("Do not diagnose", [global])).toBe(true);
    expect(containsConfiguredPattern("Diagnose again", [global])).toBe(true);
    expect(containsConfiguredPattern("Neutral wording", [/medication/i])).toBe(false);
  });
});
