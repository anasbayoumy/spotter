import { z } from "zod";

import { movementFamilySchema } from "./clients";
import {
  isoDateSchema,
  isoInstantSchema,
  limits,
  nonBlankTextSchema,
  uuidSchema,
} from "./primitives";

export const programmeStatusSchema = z.enum([
  "draft",
  "queued",
  "published",
  "rejected",
  "superseded",
]);
export const reviewBandSchema = z.enum(["blocked", "attention", "clear"]);
export const repetitionSchema = z.union([
  z.number().int().min(1).max(200),
  z
    .object({ min: z.number().int().min(1).max(200), max: z.number().int().min(1).max(200) })
    .strict()
    .refine((value) => value.max >= value.min, "Maximum repetitions must be at least minimum"),
]);

export const prescribedExerciseSchema = z
  .object({
    id: uuidSchema,
    name: z.string().trim().min(1).max(120),
    family: movementFamilySchema,
    muscleGroups: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
    sets: z.number().int().min(1).max(limits.setsPerExercise),
    reps: repetitionSchema,
    rpe: z.number().min(1).max(10),
    restSeconds: z.number().int().min(0).max(900).nullable().default(null),
    notes: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

export const programmeDaySchema = z
  .object({
    dayIndex: z.number().int().min(1).max(limits.programmeDays),
    scheduledDate: isoDateSchema,
    focus: z.string().trim().min(1).max(160),
    exercises: z.array(prescribedExerciseSchema).min(1).max(limits.exercisesPerDay),
  })
  .strict();

export const programmePayloadSchema = z
  .object({
    summary: z.string().trim().min(1).max(1_000),
    days: z.array(programmeDaySchema).min(1).max(limits.programmeDays),
  })
  .strict()
  .superRefine((payload, context) => {
    const indexes = new Set<number>();
    const dates = new Set<string>();
    for (const [index, day] of payload.days.entries()) {
      if (indexes.has(day.dayIndex)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate day index",
          path: ["days", index, "dayIndex"],
        });
      }
      if (dates.has(day.scheduledDate)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate scheduled date",
          path: ["days", index, "scheduledDate"],
        });
      }
      indexes.add(day.dayIndex);
      dates.add(day.scheduledDate);
    }
  });

export const citationSchema = z
  .object({
    sectionId: z.string().trim().min(1).max(120),
    recordIds: z.array(uuidSchema).min(1).max(50),
    claim: z.string().trim().min(1).max(500),
  })
  .strict();

export const gateResultSchema = z
  .object({
    id: uuidSchema,
    name: z.enum([
      "forbidden_movement",
      "unknown_family",
      "volume_spike",
      "intensity_ceiling",
      "frequency_breach",
      "adjustment_operation_scope",
      "nudge_rate",
      "medical_language",
      "contraindication_contradiction",
    ]),
    passed: z.boolean(),
    rationale: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const judgeResultSchema = z
  .object({
    id: uuidSchema,
    name: z.enum(["grounding", "coherence", "consistency", "intervention"]),
    score: z.number().int().min(1).max(5),
    rationale: z.string().trim().min(1).max(2_000),
    judgeModel: z.string().trim().min(1).max(200),
  })
  .strict();

export const programmeSchema = z
  .object({
    id: uuidSchema,
    clientId: uuidSchema,
    mesocycle: z.number().int().min(1).max(10_000),
    week: z.number().int().min(1).max(1_000),
    payload: programmePayloadSchema,
    status: programmeStatusSchema,
    reviewBand: reviewBandSchema.nullable(),
    generatedBy: uuidSchema,
    approvedBy: uuidSchema.nullable(),
    approvedAt: isoInstantSchema.nullable(),
    supersededBy: uuidSchema.nullable(),
    validFrom: isoInstantSchema.nullable(),
    createdAt: isoInstantSchema,
    version: z.number().int().min(1),
  })
  .strict()
  .superRefine((programme, context) => {
    if (
      programme.status === "published" &&
      (programme.approvedBy === null ||
        programme.approvedAt === null ||
        programme.validFrom === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Published programmes require approval and validity metadata",
      });
    }
    if (programme.status === "superseded" && programme.supersededBy === null) {
      context.addIssue({
        code: "custom",
        message: "Superseded programmes require a successor",
        path: ["supersededBy"],
      });
    }
  });

export const programmeReviewSchema = z
  .object({
    programme: programmeSchema,
    citations: z.array(citationSchema).max(limits.citations),
    gates: z.array(gateResultSchema).max(50),
    judges: z.array(judgeResultSchema).max(20),
    traceId: uuidSchema,
    promptVersion: z.string().trim().min(1).max(128),
    model: z.string().trim().min(1).max(200),
  })
  .strict();

export const generateProgrammeRequestSchema = z
  .object({ clientId: uuidSchema, targetWeekStart: isoDateSchema })
  .strict();
export const editProgrammeRequestSchema = z
  .object({
    payload: programmePayloadSchema,
    expectedVersion: z.number().int().min(1),
    reason: z.string().trim().max(1_000).optional(),
  })
  .strict();
export const lifecycleMutationRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    reason: z.string().trim().max(1_000).optional(),
  })
  .strict();
export const overrideProgrammeRequestSchema = z
  .object({ expectedVersion: z.number().int().min(1), reason: nonBlankTextSchema })
  .strict();

export const listProgrammesQuerySchema = z
  .object({
    clientId: uuidSchema.optional(),
    status: programmeStatusSchema.optional(),
    band: reviewBandSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export type ProgrammePayload = z.infer<typeof programmePayloadSchema>;
export type Programme = z.infer<typeof programmeSchema>;
export type ProgrammeReview = z.infer<typeof programmeReviewSchema>;
export type ReviewBand = z.infer<typeof reviewBandSchema>;
export type GateResult = z.infer<typeof gateResultSchema>;
export type JudgeResult = z.infer<typeof judgeResultSchema>;
