import {
  completeSessionRequestSchema,
  limits,
  logSessionRequestSchema,
  type Session,
} from "@spotter/contracts";
import { z } from "zod";

import { createIdempotencyKey } from "../../lib/api/idempotency";
import { readValidatedStorage, removeStorage, writeStorage } from "../../lib/storage/json-storage";

const setDraftSchema = z
  .object({
    completed: z.boolean(),
    loadKg: z.string().max(20),
    reps: z.string().max(10),
    rpe: z.string().max(10),
    setIndex: z.number().int().min(1).max(limits.setsPerExercise),
  })
  .strict();
const exerciseDraftSchema = z
  .object({ exerciseId: z.uuid(), sets: z.array(setDraftSchema).max(limits.setsPerExercise) })
  .strict();
export const sessionDraftSchema = z
  .object({
    completeKey: z.string().min(8).max(128),
    completePayloadFingerprint: z.string().nullable().default(null),
    exercises: z.array(exerciseDraftSchema).max(limits.exercisesPerDay),
    expectedVersion: z.number().int().min(1),
    logKey: z.string().min(8).max(128),
    logPayloadFingerprint: z.string().nullable().default(null),
    notes: z.string().max(limits.longText),
    performedAt: z.string().nullable(),
    sessionRpe: z.string().max(10),
  })
  .strict();

export type SessionDraft = z.infer<typeof sessionDraftSchema>;

export interface ValidatedSessionSubmission {
  readonly completion: z.infer<typeof completeSessionRequestSchema>;
  readonly log: z.infer<typeof logSessionRequestSchema>;
}

export type SessionSubmissionValidation =
  | { readonly errors: Readonly<Record<string, string>>; readonly success: false }
  | { readonly data: ValidatedSessionSubmission; readonly success: true };

function storageKey(sessionId: string): string {
  return `spotter.demo.session-draft.v1:${sessionId}`;
}

export function createSessionDraft(session: Session): SessionDraft {
  const actualByExercise = new Map(
    (session.actual ?? []).map((exercise) => [exercise.exerciseId, exercise]),
  );
  return {
    completeKey: createIdempotencyKey("session-complete", session.id),
    completePayloadFingerprint: null,
    exercises: session.planned.map((exercise) => {
      const recorded = actualByExercise.get(exercise.id);
      return {
        exerciseId: exercise.id,
        sets:
          recorded?.sets.map((set) => ({
            completed: set.completed,
            loadKg: set.loadKg === null ? "" : String(set.loadKg),
            reps: String(set.reps),
            rpe: set.rpe === null ? "" : String(set.rpe),
            setIndex: set.setIndex,
          })) ??
          Array.from({ length: exercise.sets }, (_, index) => ({
            completed: true,
            loadKg: "",
            reps:
              typeof exercise.reps === "number" ? String(exercise.reps) : String(exercise.reps.min),
            rpe: String(exercise.rpe),
            setIndex: index + 1,
          })),
      };
    }),
    expectedVersion: session.version,
    logKey: createIdempotencyKey("session-log", session.id),
    logPayloadFingerprint: null,
    notes: session.notes ?? "",
    performedAt: null,
    sessionRpe: session.rpe === null ? "" : String(session.rpe),
  };
}

function numberFromField(value: string): number | null {
  if (value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function validateSessionSubmission(
  clientId: string,
  draft: SessionDraft,
): SessionSubmissionValidation {
  const actual = draft.exercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    sets: exercise.sets.map((set) => ({
      completed: set.completed,
      loadKg: numberFromField(set.loadKg),
      reps: numberFromField(set.reps),
      rpe: numberFromField(set.rpe),
      setIndex: set.setIndex,
    })),
  }));
  const performedAt = draft.performedAt ?? new Date().toISOString();
  const logResult = logSessionRequestSchema.safeParse({
    actual,
    clientId,
    expectedVersion: draft.expectedVersion,
    notes: draft.notes.trim().length === 0 ? null : draft.notes,
  });
  const completionResult = completeSessionRequestSchema.safeParse({
    clientId,
    expectedVersion: draft.expectedVersion,
    performedAt,
    rpe: numberFromField(draft.sessionRpe),
  });
  if (logResult.success && completionResult.success) {
    return { data: { completion: completionResult.data, log: logResult.data }, success: true };
  }
  const errors: Record<string, string> = {};
  for (const issue of logResult.success ? [] : logResult.error.issues) {
    errors[`log.${issue.path.join(".")}`] = issue.message;
  }
  for (const issue of completionResult.success ? [] : completionResult.error.issues) {
    errors[`complete.${issue.path.join(".")}`] = issue.message;
  }
  return { errors, success: false };
}

export async function readSessionDraft(sessionId: string): Promise<SessionDraft | null> {
  return readValidatedStorage(storageKey(sessionId), sessionDraftSchema);
}

export async function saveSessionDraft(sessionId: string, draft: SessionDraft): Promise<void> {
  await writeStorage(storageKey(sessionId), sessionDraftSchema.parse(draft));
}

export async function clearSessionDraft(sessionId: string): Promise<void> {
  await removeStorage(storageKey(sessionId));
}
