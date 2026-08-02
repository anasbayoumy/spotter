export const recordedWeekStart = "2026-08-03";
export const performanceExercise = Object.freeze({
  family: "horizontal_pull",
  id: "58000000-0000-4000-8000-000000000001",
  muscleGroups: Object.freeze(["back"]),
  name: "Synthetic row intervals",
  notes: "Disposable performance fixture.",
  reps: 8,
  restSeconds: 90,
  rpe: 7,
  sets: 4,
});

export function performanceClientId(clientNumber) {
  if (!Number.isSafeInteger(clientNumber) || clientNumber < 1 || clientNumber > 50) {
    throw new Error("Performance client number must be an integer from 1 through 50.");
  }
  return `00000000-0000-4000-8000-${String(100 + clientNumber).padStart(12, "0")}`;
}

export const intendedPerformanceClientIds = Object.freeze(
  Array.from({ length: 50 }, (_, index) => performanceClientId(index + 1)),
);

export function assertExactActiveSyntheticClientSet(ids) {
  if (
    !Array.isArray(ids) ||
    ids.length !== intendedPerformanceClientIds.length ||
    ids.some((id, index) => id !== intendedPerformanceClientIds[index])
  ) {
    throw new Error(
      "Global active synthetic client set is not exactly the intended 50 identities.",
    );
  }
  return ids;
}

export function createMutationContractFixture(weekStart = recordedWeekStart) {
  const planned = [{ ...performanceExercise, muscleGroups: [...performanceExercise.muscleGroups] }];
  return {
    actual: [
      {
        exerciseId: performanceExercise.id,
        sets: [{ completed: true, loadKg: 20, reps: 8, rpe: 7, setIndex: 1 }],
      },
    ],
    payload: {
      days: [
        {
          dayIndex: 1,
          exercises: planned,
          focus: "Disposable performance review",
          scheduledDate: weekStart,
        },
      ],
      summary: "Disposable performance review",
    },
    planned,
  };
}

export function assertMutationContractFixture(fixture, expectedWeekStart = recordedWeekStart) {
  const day = fixture?.payload?.days?.[0];
  const exercise = day?.exercises?.[0];
  const planned = fixture?.planned?.[0];
  const actual = fixture?.actual?.[0];
  const problems = [];
  if (fixture?.payload?.days?.length !== 1) problems.push("programme must contain one day");
  if (day?.scheduledDate !== expectedWeekStart)
    problems.push("programme day must own requested week");
  if (day?.dayIndex !== 1 || typeof day?.focus !== "string" || day.focus.length === 0) {
    problems.push("programme day is invalid");
  }
  if (
    typeof exercise?.id !== "string" ||
    exercise.id !== planned?.id ||
    exercise.id !== actual?.exerciseId
  ) {
    problems.push("planned and actual exercise identities differ");
  }
  if (
    exercise?.family !== "horizontal_pull" ||
    !Array.isArray(exercise?.muscleGroups) ||
    exercise.muscleGroups.length === 0 ||
    !Number.isSafeInteger(exercise?.sets) ||
    !Number.isSafeInteger(exercise?.reps) ||
    typeof exercise?.rpe !== "number"
  ) {
    problems.push("prescribed exercise is not contract-valid");
  }
  if (
    !Array.isArray(actual?.sets) ||
    actual.sets.length !== 1 ||
    actual.sets[0]?.setIndex !== 1 ||
    actual.sets[0]?.completed !== true
  ) {
    problems.push("actual exercise is not contract-valid");
  }
  if (problems.length > 0) {
    throw new Error(`Mutation fixture contract is invalid: ${problems.join("; ")}`);
  }
  return fixture;
}

export function assertNonDestructiveCorpusSql(sql) {
  const forbidden = [
    /DELETE\s+FROM\s+message_guards/iu,
    /UPDATE\s+clients\b/iu,
    /DELETE\s+FROM\s+clients\b/iu,
    /TRUNCATE\b/iu,
  ];
  const matched = forbidden.find((pattern) => pattern.test(sql));
  if (matched !== undefined) {
    throw new Error(`Standard corpus contains a destructive statement: ${String(matched)}`);
  }
  if (!/^\s*\\set ON_ERROR_STOP on[\s\S]*\bBEGIN;[\s\S]*\bCOMMIT;/u.test(sql)) {
    throw new Error("Standard corpus must execute as one fail-fast transaction.");
  }
  return sql;
}
