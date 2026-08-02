import { z } from "zod";

import { prescribedExerciseSchema } from "./programmes";
import { isoDateSchema, isoInstantSchema, limits, uuidSchema } from "./primitives";

export const sessionStatusSchema = z.enum(["scheduled", "completed", "missed"]);
export const actualSetSchema = z
  .object({
    setIndex: z.number().int().min(1).max(limits.setsPerExercise),
    reps: z.number().int().min(0).max(500),
    loadKg: z.number().min(0).max(2_000).nullable(),
    rpe: z.number().min(1).max(10).nullable(),
    completed: z.boolean(),
  })
  .strict();
export const actualExerciseSchema = z
  .object({
    exerciseId: uuidSchema,
    sets: z.array(actualSetSchema).max(limits.setsPerExercise),
  })
  .strict()
  .refine(
    (value) => new Set(value.sets.map((set) => set.setIndex)).size === value.sets.length,
    "Duplicate set index",
  );

export const sessionSchema = z
  .object({
    id: uuidSchema,
    clientId: uuidSchema,
    programmeId: uuidSchema,
    scheduledFor: isoDateSchema,
    status: sessionStatusSchema,
    planned: z.array(prescribedExerciseSchema).min(1).max(limits.exercisesPerDay),
    actual: z.array(actualExerciseSchema).max(limits.exercisesPerDay).nullable(),
    performedAt: isoInstantSchema.nullable(),
    rpe: z.number().min(1).max(10).nullable(),
    notes: z.string().trim().max(limits.longText).nullable(),
    version: z.number().int().min(1),
  })
  .strict()
  .superRefine((session, context) => {
    if (
      session.status === "completed" &&
      (session.actual === null || session.performedAt === null || session.rpe === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed sessions require actual work, performedAt and RPE",
      });
    }
  });

export const logSessionRequestSchema = z
  .object({
    clientId: uuidSchema,
    actual: z.array(actualExerciseSchema).min(1).max(limits.exercisesPerDay),
    notes: z.string().trim().max(limits.longText).nullable().default(null),
    expectedVersion: z.number().int().min(1),
  })
  .strict();
export const completeSessionRequestSchema = z
  .object({
    clientId: uuidSchema,
    rpe: z.number().min(1).max(10),
    performedAt: isoInstantSchema,
    expectedVersion: z.number().int().min(1),
  })
  .strict();
export const listSessionsQuerySchema = z
  .object({
    clientId: uuidSchema,
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict()
  .refine(
    (query) => query.from === undefined || query.to === undefined || query.from <= query.to,
    "from must not be after to",
  );

export type Session = z.infer<typeof sessionSchema>;
export type ActualExercise = z.infer<typeof actualExerciseSchema>;
