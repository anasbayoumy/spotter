import { sessionSchema } from "@spotter/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  getItem: vi.fn<(key: string) => Promise<string | null>>(),
  removeItem: vi.fn<(key: string) => Promise<void>>(),
  setItem: vi.fn<(key: string, value: string) => Promise<void>>(),
}));

vi.mock("@react-native-async-storage/async-storage", (): object => ({ default: storage }));

import {
  clearCheckInDraft,
  createCheckInDraft,
  readCheckInDraft,
  saveCheckInDraft,
} from "./check-in/draft";
import {
  clearSessionDraft,
  createSessionDraft,
  readSessionDraft,
  saveSessionDraft,
  validateSessionSubmission,
} from "./session-logging/draft";

const ids = {
  client: "00000000-0000-4000-8000-000000000201",
  exercise: "00000000-0000-4000-8000-000000000202",
  programme: "00000000-0000-4000-8000-000000000203",
  session: "00000000-0000-4000-8000-000000000204",
} as const;

const recordedSession = sessionSchema.parse({
  actual: [
    {
      exerciseId: ids.exercise,
      sets: [
        { completed: true, loadKg: null, reps: 7, rpe: null, setIndex: 1 },
        { completed: false, loadKg: 32.5, reps: 6, rpe: 8, setIndex: 2 },
      ],
    },
  ],
  clientId: ids.client,
  id: ids.session,
  notes: "Stored note",
  performedAt: null,
  planned: [
    {
      family: "hinge",
      id: ids.exercise,
      muscleGroups: ["hamstrings"],
      name: "Romanian deadlift",
      notes: null,
      reps: { max: 8, min: 6 },
      restSeconds: 90,
      rpe: 7,
      sets: 2,
    },
  ],
  programmeId: ids.programme,
  rpe: 8,
  scheduledFor: "2026-08-03",
  status: "scheduled",
  version: 3,
});

beforeEach(() => {
  storage.getItem.mockReset();
  storage.removeItem.mockReset();
  storage.setItem.mockReset();
  storage.getItem.mockResolvedValue(null);
  storage.removeItem.mockResolvedValue();
  storage.setItem.mockResolvedValue();
});

describe("check-in draft lifecycle", () => {
  it("uses a stable resource-specific key and persists a valid draft", async () => {
    const draft = {
      ...createCheckInDraft(ids.client),
      body: "Recovery is lower than usual.",
      readiness: 2,
      respondedAt: "2026-08-03T06:00:00.000Z",
    };
    await saveCheckInDraft(ids.client, draft);
    const write = storage.setItem.mock.calls[0];
    expect(write?.[0]).toBe(`spotter.demo.check-in-draft.v1:${ids.client}`);
    expect(write?.[1]).toBe(JSON.stringify(draft));

    storage.getItem.mockResolvedValueOnce(JSON.stringify(draft));
    await expect(readCheckInDraft(ids.client)).resolves.toEqual(draft);
    await clearCheckInDraft(ids.client);
    expect(storage.removeItem).toHaveBeenCalledWith(`spotter.demo.check-in-draft.v1:${ids.client}`);
  });

  it("rejects an invalid draft before writing it", async () => {
    const draft = createCheckInDraft(ids.client);
    await expect(
      saveCheckInDraft(ids.client, { ...draft, body: "x".repeat(4_001) }),
    ).rejects.toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe("session draft lifecycle and validation", () => {
  it("restores recorded actual values without inventing nullable load or RPE", () => {
    const draft = createSessionDraft(recordedSession);
    expect(draft).toMatchObject({
      expectedVersion: 3,
      notes: "Stored note",
      sessionRpe: "8",
    });
    expect(draft.exercises[0]?.sets).toEqual([
      { completed: true, loadKg: "", reps: "7", rpe: "", setIndex: 1 },
      { completed: false, loadKg: "32.5", reps: "6", rpe: "8", setIndex: 2 },
    ]);
  });

  it("separates log-field failures from a valid completion", () => {
    const draft = createSessionDraft(recordedSession);
    const firstExercise = draft.exercises[0];
    if (firstExercise === undefined) throw new Error("Test exercise is required.");
    const firstSet = firstExercise.sets[0];
    if (firstSet === undefined) throw new Error("Test set is required.");
    const result = validateSessionSubmission(ids.client, {
      ...draft,
      exercises: [
        {
          ...firstExercise,
          sets: [{ ...firstSet, reps: "not-a-number" }],
        },
      ],
      performedAt: "2026-08-03T06:00:00.000Z",
      sessionRpe: "8",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(result.errors).some((key) => key.startsWith("log."))).toBe(true);
      expect(Object.keys(result.errors).some((key) => key.startsWith("complete."))).toBe(false);
    }
  });

  it("accepts blank optional set load/RPE and converts blank notes to null", () => {
    const draft = createSessionDraft(recordedSession);
    const result = validateSessionSubmission(ids.client, {
      ...draft,
      notes: "   ",
      performedAt: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.log.notes).toBeNull();
      expect(result.data.log.actual[0]?.sets[0]).toMatchObject({ loadKg: null, rpe: null });
      expect(result.data.completion.performedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    }
  });

  it("persists, reads, and clears a validated session draft", async () => {
    const draft = createSessionDraft(recordedSession);
    await saveSessionDraft(ids.session, draft);
    expect(storage.setItem.mock.calls[0]?.[0]).toBe(`spotter.demo.session-draft.v1:${ids.session}`);
    storage.getItem.mockResolvedValueOnce(JSON.stringify(draft));
    await expect(readSessionDraft(ids.session)).resolves.toEqual(draft);
    await clearSessionDraft(ids.session);
    expect(storage.removeItem).toHaveBeenCalledWith(`spotter.demo.session-draft.v1:${ids.session}`);
  });
});
