import { describe, expect, it } from "vitest";

import {
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
  assertExpectedVersion,
  documentedExerciseEquivalences,
  isVolumeSpike,
  validateAdjustmentOperations,
  validateDocumentedExerciseSwap,
} from "./index.js";
import type { ProgrammeExercise, ProgrammeState } from "./programme.js";

const ids = {
  adjustment: "10000000-0000-4000-8000-000000000001",
  client: "10000000-0000-4000-8000-000000000002",
  coach: "10000000-0000-4000-8000-000000000003",
  exercise: "10000000-0000-4000-8000-000000000004",
  programme: "10000000-0000-4000-8000-000000000005",
  session: "10000000-0000-4000-8000-000000000006",
  successor: "10000000-0000-4000-8000-000000000008",
} as const;
const now = new Date("2026-08-02T12:00:00.000Z");

function exercise(loadKg?: number | null): ProgrammeExercise {
  return {
    family: "hinge",
    id: ids.exercise,
    name: "Deadlift",
    rpe: 7,
    sets: 3,
    ...(loadKg === undefined ? {} : { loadKg }),
  };
}

function programmeState(exerciseValue: ProgrammeExercise = exercise()): ProgrammeState {
  return {
    approvedAt: null,
    approvedBy: null,
    clientId: ids.client,
    id: ids.programme,
    payload: {
      days: [{ dayIndex: 1, exercises: [exerciseValue], scheduledDate: "2026-08-03" }],
      summary: "Reviewed week",
    },
    reviewBand: null,
    slotKey: "2026-W32",
    sourceProgrammeId: null,
    status: "draft",
    supersededBy: null,
    version: 1,
  };
}

function adjustment(): Adjustment {
  return new Adjustment({
    appliedProgrammeId: null,
    approvedAt: null,
    approvedBy: null,
    baseProgrammeId: ids.programme,
    clientId: ids.client,
    id: ids.adjustment,
    operations: [{ exerciseId: ids.exercise, percent: 10, type: "reduce_load" }],
    sourceEventKey: "event-key-1",
    status: "draft",
    version: 1,
  });
}

function session(
  actual: ConstructorParameters<typeof TrainingSession>[0]["actual"] = null,
): TrainingSession {
  return new TrainingSession({
    actual,
    clientId: ids.client,
    id: ids.session,
    performedAt: null,
    plannedSetCount: 2,
    programmeId: ids.programme,
    rpe: null,
    version: 1,
  });
}

function expectDomainError(
  operation: () => unknown,
  code: DomainError["code"],
  message: string,
): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainError);
  if (!(thrown instanceof DomainError)) throw thrown;
  expect(thrown.code).toBe(code);
  expect(thrown.message).toBe(message);
}

describe("mutation-audited programme boundaries", () => {
  it.each([undefined, null, 0, 2_000])("accepts the inclusive load boundary %s", (loadKg) => {
    expect(new Programme(programmeState(exercise(loadKg))).snapshot().payload.days).toHaveLength(1);
  });

  it.each([-0.01, 2_000.01, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects the invalid prescribed load %s",
    (loadKg) => {
      expectDomainError(
        () => new Programme(programmeState(exercise(loadKg))),
        "invalid_value",
        "Invalid prescribed exercise",
      );
    },
  );

  it("retains the reasoned-override diagnostic", () => {
    const blocked = new Programme(programmeState()).queue("blocked", 1);
    expectDomainError(
      () => blocked.override(ids.coach, now, " ", 2),
      "override_reason_required",
      "Override requires a written reason",
    );
  });

  it("does not let a blocked review band bypass queued-state authorization", () => {
    const draftBlocked = new Programme({ ...programmeState(), reviewBand: "blocked" });
    expectDomainError(
      () => draftBlocked.override(ids.coach, now, "Coach reviewed the finding", 1),
      "invalid_state_transition",
      "Only a queued blocked programme can be overridden",
    );
  });
});

describe("mutation-audited domain value boundaries", () => {
  it("accepts adherence one but rejects values above one", () => {
    expect(isVolumeSpike(10, 20, 1)).toBe(false);
    expectDomainError(
      () => isVolumeSpike(10, 20, -0.01),
      "invalid_value",
      "Invalid volume/adherence input",
    );
    expectDomainError(
      () => isVolumeSpike(10, 20, 1.01),
      "invalid_value",
      "Invalid volume/adherence input",
    );
  });

  it("retains idempotency and invalid-version diagnostics", () => {
    expect(new EntityId(`  ${ids.client.toUpperCase()}  `).value).toBe(ids.client);
    expect(new IdempotencyKey("12345678").value).toBe("12345678");
    expect(new IdempotencyKey("x".repeat(128)).value).toHaveLength(128);
    expectDomainError(
      () => new IdempotencyKey("short"),
      "invalid_value",
      "Invalid idempotency key",
    );
    expectDomainError(
      () => {
        assertExpectedVersion(0, 0);
      },
      "version_conflict",
      "The resource version changed",
    );
    expectDomainError(
      () => new RequestFingerprint(`x${"a".repeat(64)}`),
      "invalid_value",
      "Request fingerprint must be a SHA-256 hex digest",
    );
    expect(new RequestFingerprint(`  ${"A".repeat(64)}  `).value).toBe("a".repeat(64));
    expect(new DomainError("invalid_value", "stable").name).toBe("DomainError");
  });

  it("retains adjustment rejection diagnostics", () => {
    expectDomainError(
      () => validateAdjustmentOperations([]),
      "unsupported_adjustment",
      "Adjustment requires one to one hundred operations",
    );
    expectDomainError(
      () =>
        validateAdjustmentOperations([
          { exerciseId: ids.exercise, percent: 0, type: "reduce_load" },
        ]),
      "unsupported_adjustment",
      "Load reduction must be greater than zero and at most 100 percent",
    );
    expectDomainError(
      () =>
        validateAdjustmentOperations([
          { exerciseId: ids.exercise, setsToRemove: 0, type: "reduce_volume" },
        ]),
      "unsupported_adjustment",
      "Volume reduction must remove one to twenty sets",
    );
    expectDomainError(
      () =>
        validateAdjustmentOperations([
          {
            equivalenceId: "10000000-0000-4000-8000-000000000007",
            exerciseId: ids.exercise,
            replacementFamily: " ",
            type: "swap_exercise",
          },
        ]),
      "unsupported_adjustment",
      "A swap requires a documented replacement family",
    );
    expect(
      validateAdjustmentOperations([
        { exerciseId: ids.exercise, setsToRemove: 1, type: "reduce_volume" },
      ]),
    ).toEqual([{ exerciseId: ids.exercise, setsToRemove: 1, type: "reduce_volume" }]);
    expectDomainError(
      () => new Adjustment({ ...adjustment().snapshot(), sourceEventKey: "      x " }),
      "invalid_value",
      "Invalid adjustment event key or version",
    );
    expectDomainError(
      () =>
        new Adjustment({
          ...adjustment().snapshot(),
          approvedAt: now,
          approvedBy: ids.coach,
          status: "applied",
        }),
      "invalid_value",
      "Applied adjustment requires its programme version",
    );
    expectDomainError(
      () =>
        new Adjustment({
          ...adjustment().snapshot(),
          appliedProgrammeId: ids.successor,
          status: "applied",
        }),
      "invalid_value",
      "Approved adjustments require coach metadata",
    );
    expectDomainError(
      () => adjustment().approve(ids.coach, now, 1),
      "invalid_state_transition",
      "Only a queued adjustment can be approved",
    );
    const approved = adjustment().queue(1).approve(ids.coach, now, 2);
    expect(approved.apply(ids.programme, ids.successor, 3).snapshot().version).toBe(4);
    expectDomainError(
      () => approved.apply(ids.successor, ids.programme, 3),
      "stale_adjustment",
      "Adjustment base programme is no longer current",
    );
    expectDomainError(
      () => adjustment().apply(ids.programme, ids.successor, 1),
      "invalid_state_transition",
      "Adjustment requires coach approval before application",
    );
    expectDomainError(
      () => approved.reject(3),
      "invalid_state_transition",
      "Only a draft or queued adjustment can be rejected",
    );
    expect(adjustment().reject(1).snapshot()).toMatchObject({ status: "rejected", version: 2 });
    expectDomainError(
      () => adjustment().reject(1).queue(2),
      "invalid_state_transition",
      "Only a draft adjustment can be queued",
    );
    expectDomainError(
      () => adjustment().markStale(1),
      "invalid_state_transition",
      "Only a pending adjustment can become stale",
    );
  });

  it("accepts the inclusive lower RPE boundary when completing logged work", () => {
    const completed = session()
      .log(
        [
          {
            exerciseId: ids.exercise,
            sets: [{ completed: true, loadKg: 0, reps: 0, setIndex: 1 }],
          },
        ],
        1,
      )
      .complete(1, now, 2)
      .snapshot();

    expect(completed).toMatchObject({ performedAt: now, rpe: 1, version: 3 });
  });

  it("retains unsupported-equivalence error codes", () => {
    const base = {
      equivalenceId: "20000000-0000-4000-8000-000000000001",
      replacementFamily: "horizontal_pull",
      replacementName: "Seated cable row",
      sourceFamily: "horizontal_pull",
    };
    expectDomainError(
      () =>
        validateDocumentedExerciseSwap({
          ...base,
          equivalenceId: "20000000-0000-4000-8000-000000009999",
        }),
      "unsupported_adjustment",
      "Adjustment references an unknown exercise equivalence.",
    );
    expectDomainError(
      () => validateDocumentedExerciseSwap({ ...base, sourceFamily: "squat" }),
      "unsupported_adjustment",
      "Adjustment equivalence does not match the source movement family.",
    );
    expectDomainError(
      () => validateDocumentedExerciseSwap({ ...base, replacementName: "Unknown row" }),
      "unsupported_adjustment",
      "Adjustment equivalence does not match the replacement exercise name.",
    );
    expectDomainError(
      () => validateDocumentedExerciseSwap({ ...base, replacementFamily: "squat" }),
      "unsupported_adjustment",
      "Adjustment equivalence does not match the replacement movement family.",
    );
    expect(documentedExerciseEquivalences).toEqual([
      {
        id: "20000000-0000-4000-8000-000000000001",
        replacementFamily: "horizontal_pull",
        replacementName: "Seated cable row",
        sourceFamily: "horizontal_pull",
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        replacementFamily: "squat",
        replacementName: "Goblet squat",
        sourceFamily: "squat",
      },
    ]);
  });

  it("retains temporal validation diagnostics", () => {
    expectDomainError(
      () => new TemporalWindow(new Date("invalid"), null),
      "invalid_value",
      "Invalid instant",
    );
    expectDomainError(
      () => new TemporalWindow(now, now),
      "invalid_value",
      "validUntil must be after validFrom",
    );
  });
});

describe("mutation-audited session boundaries", () => {
  const set = { completed: true, loadKg: 50, reps: 5, setIndex: 1 } as const;

  it("accepts exactly twenty exercises, zero reps, and 2,000 kg", () => {
    const actual = Array.from({ length: 20 }, (_, index) => ({
      exerciseId: `10000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      sets: [{ ...set, loadKg: index === 0 ? 2_000 : null, reps: index === 0 ? 0 : 5 }],
    }));
    expect(session(actual).snapshot().actual).toHaveLength(20);
    expect(
      session([{ exerciseId: ids.exercise, sets: [{ ...set, loadKg: 0 }] }]).snapshot().actual,
    ).toEqual([{ exerciseId: ids.exercise, sets: [{ ...set, loadKg: 0 }] }]);
    expect(
      session([{ exerciseId: ids.exercise, sets: [{ ...set, reps: 500 }] }]).snapshot().actual,
    ).toEqual([{ exerciseId: ids.exercise, sets: [{ ...set, reps: 500 }] }]);
  });

  it("counts only completed actual sets", () => {
    const actual = [
      {
        exerciseId: ids.exercise,
        sets: [set, { ...set, completed: false, setIndex: 2 }],
      },
    ];
    expect(session(actual).completionRatio()).toBe(0.5);
  });

  it("accepts the inclusive readiness-body maximum", () => {
    expect(new ReadinessCheckIn(1, "x".repeat(4_000), now).body).toHaveLength(4_000);
    expect(new ReadinessCheckIn(5, "ready", now).readiness).toBe(5);
    expectDomainError(
      () => new ReadinessCheckIn(3, "x".repeat(4_001), now),
      "invalid_value",
      "Invalid readiness check-in",
    );
  });

  it("retains actual-work and lifecycle diagnostics", () => {
    expectDomainError(
      () => session([]),
      "invalid_value",
      "Actual work requires one to twenty exercises",
    );
    expectDomainError(
      () =>
        session([
          {
            exerciseId: ids.exercise,
            sets: [set, { ...set }],
          },
        ]),
      "invalid_value",
      "Actual sets contain duplicate indexes or exceed the limit",
    );
    expectDomainError(
      () => session([{ exerciseId: ids.exercise, sets: [{ ...set, reps: -1 }] }]),
      "invalid_value",
      "Invalid actual set",
    );
    expectDomainError(
      () =>
        new TrainingSession({
          ...session().snapshot(),
          plannedSetCount: 0,
        }),
      "invalid_value",
      "Invalid planned set count or session version",
    );
    expectDomainError(
      () =>
        new TrainingSession({
          ...session().snapshot(),
          performedAt: now,
        }),
      "invalid_value",
      "Completion timestamp and RPE must be set together",
    );
    expectDomainError(
      () =>
        new TrainingSession({
          ...session().snapshot(),
          performedAt: now,
          rpe: 7,
        }),
      "invalid_value",
      "Completed sessions require actual work",
    );
    expectDomainError(
      () => session().complete(7, now, 1),
      "invalid_state_transition",
      "Session must have uncompleted actual work before completion",
    );
    const logged = session().log([{ exerciseId: ids.exercise, sets: [set] }], 1);
    expectDomainError(
      () => logged.complete(0, now, 2),
      "invalid_value",
      "Invalid RPE or completion time",
    );
    const completed = logged.complete(7, now, 2);
    expectDomainError(
      () => completed.log([{ exerciseId: ids.exercise, sets: [set] }], 3),
      "invalid_state_transition",
      "A completed session cannot be edited",
    );
    expectDomainError(
      () => new ReadinessCheckIn(0, "ready", now),
      "invalid_value",
      "Invalid readiness check-in",
    );
  });

  it("triggers low completion at the inclusive seventy-percent boundary", () => {
    const planned = new TrainingSession({
      actual: null,
      clientId: ids.client,
      id: ids.session,
      performedAt: null,
      plannedSetCount: 10,
      programmeId: ids.programme,
      rpe: null,
      version: 1,
    });
    const actual = [
      {
        exerciseId: ids.exercise,
        sets: Array.from({ length: 7 }, (_, index) => ({
          ...set,
          setIndex: index + 1,
        })),
      },
    ];
    const completed = planned.log(actual, 1).complete(8, now, 2);
    expect(adjustmentTriggers(null, completed)).toEqual(["low_completion"]);
  });
});
