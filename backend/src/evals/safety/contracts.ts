import { z } from "zod";

const boundedText = z.string().trim().max(10_000);
const instant = z.coerce.date();

export const safetyExerciseSchema = z
  .object({
    family: z.string().trim().min(1).max(120),
    id: z.string().trim().min(1).max(120),
    muscleGroups: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    name: z.string().trim().min(1).max(120),
    rpe: z.number().min(1).max(10),
    sets: z.number().int().min(1).max(100),
  })
  .strict();

export const safetyConstraintSchema = z
  .object({
    forbids: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
    id: z.string().trim().min(1).max(120),
    kind: z.enum(["allergy", "equipment", "injury", "medical", "preference", "schedule"]),
    severity: z.enum(["hard", "soft"]),
    supersededBy: z.string().trim().min(1).max(120).nullable().default(null),
    validFrom: instant,
    validUntil: instant.nullable().default(null),
  })
  .strict()
  .refine(
    (value) => value.validUntil === null || value.validUntil.valueOf() > value.validFrom.valueOf(),
    "validUntil must be after validFrom",
  );

export const volumeChangeSchema = z
  .object({
    muscleGroup: z.string().trim().min(1).max(80),
    previousSets: z.number().int().min(0).max(1_000),
    proposedSets: z.number().int().min(0).max(1_000),
  })
  .strict();

export const rawAdjustmentOperationSchema = z
  .object({
    direction: z.enum(["decrease", "increase"]).optional(),
    equivalenceId: z.string().trim().min(1).max(120).optional(),
    percent: z.number().optional(),
    replacementFamily: z.string().trim().min(1).max(120).optional(),
    setsToRemove: z.number().optional(),
    type: z.string().trim().min(1).max(120),
  })
  .strict();

export const safetyInputSchema = z
  .object({
    adherence14d: z.number().min(0).max(1).nullable().default(null),
    adjustment: z
      .object({
        autoApply: z.boolean().default(false),
        operations: z.array(rawAdjustmentOperationSchema).max(100),
      })
      .strict()
      .nullable()
      .default(null),
    allowedSessions: z.number().int().min(0).max(14).nullable().default(null),
    asOf: instant,
    checkInText: boundedText.default(""),
    constraints: z.array(safetyConstraintSchema).max(200).default([]),
    exercises: z.array(safetyExerciseSchema).max(300).default([]),
    intent: z.enum(["accountability", "adjustment", "programme"]),
    nudge: z
      .object({
        attemptedAt: instant,
        automated: z.boolean(),
        concurrentAttempts: z.number().int().min(1).max(1_000).default(1),
        lastAutomatedSentAt: instant.nullable().default(null),
        owner: z.enum(["automation", "coach", "none"]),
        tier: z.number().int().min(0).max(4),
      })
      .strict()
      .nullable()
      .default(null),
    outputText: boundedText.default(""),
    plannedSessions: z.number().int().min(0).max(14).default(0),
    volumeChanges: z.array(volumeChangeSchema).max(100).default([]),
  })
  .strict();

export type SafetyInput = z.infer<typeof safetyInputSchema>;
export type SafetyConstraint = z.infer<typeof safetyConstraintSchema>;
export type SafetyExercise = z.infer<typeof safetyExerciseSchema>;
export type RawAdjustmentOperation = z.infer<typeof rawAdjustmentOperationSchema>;
