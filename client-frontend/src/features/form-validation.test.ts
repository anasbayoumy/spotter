import { sessionSchema } from "@spotter/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", (): object => ({
  default: { getItem: vi.fn(), removeItem: vi.fn(), setItem: vi.fn() },
}));

import { createCheckInDraft, validateCheckInDraft } from "./check-in/draft";
import { createSessionDraft, validateSessionSubmission } from "./session-logging/draft";

const clientId = "00000000-0000-4000-8000-000000000101";
const session = sessionSchema.parse({
  actual: null,
  clientId,
  id: "00000000-0000-4000-8000-000000000102",
  notes: null,
  performedAt: null,
  planned: [
    {
      family: "hinge",
      id: "00000000-0000-4000-8000-000000000103",
      muscleGroups: ["hamstrings"],
      name: "Deadlift",
      notes: null,
      reps: 5,
      restSeconds: 120,
      rpe: 7,
      sets: 2,
    },
  ],
  programmeId: "00000000-0000-4000-8000-000000000104",
  rpe: null,
  scheduledFor: "2026-08-03",
  status: "scheduled",
  version: 1,
});

describe("session draft validation", () => {
  it("builds structured planned sets and validates bounded numeric fields", () => {
    const draft = createSessionDraft(session);
    const result = validateSessionSubmission(clientId, {
      ...draft,
      performedAt: "2026-08-03T06:00:00.000Z",
      sessionRpe: "8",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.log.actual[0]?.sets).toHaveLength(2);
      expect(result.data.completion.rpe).toBe(8);
    }
  });

  it("rejects out-of-range reps, load, set RPE, and overall RPE", () => {
    const draft = createSessionDraft(session);
    const firstExercise = draft.exercises[0];
    expect(firstExercise).toBeDefined();
    if (firstExercise === undefined) return;
    const firstSet = firstExercise.sets[0];
    expect(firstSet).toBeDefined();
    if (firstSet === undefined) return;
    const result = validateSessionSubmission(clientId, {
      ...draft,
      exercises: [
        {
          ...firstExercise,
          sets: [{ ...firstSet, loadKg: "-1", reps: "501", rpe: "11" }],
        },
      ],
      sessionRpe: "0",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(result.errors).length).toBeGreaterThan(0);
  });
});

describe("check-in validation", () => {
  it("requires readiness from one to five and bounded nonblank text", () => {
    const empty = createCheckInDraft(clientId);
    expect(validateCheckInDraft(clientId, empty).success).toBe(false);
    expect(
      validateCheckInDraft(clientId, {
        ...empty,
        body: "Ready for a lighter day.",
        readiness: 2,
        respondedAt: "2026-08-03T06:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});
