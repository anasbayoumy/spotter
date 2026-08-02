import { z } from "zod";

import { movementFamilySchema } from "./clients";
import { isoInstantSchema, nonBlankTextSchema, uuidSchema } from "./primitives";

export const adjustmentStatusSchema = z.enum([
  "draft",
  "queued",
  "approved",
  "rejected",
  "applied",
  "stale",
]);
export const reduceLoadOperationSchema = z
  .object({
    type: z.literal("reduce_load"),
    exerciseId: uuidSchema,
    percent: z.number().min(1).max(100),
    rationale: nonBlankTextSchema,
  })
  .strict();
export const reduceVolumeOperationSchema = z
  .object({
    type: z.literal("reduce_volume"),
    exerciseId: uuidSchema,
    setsToRemove: z.number().int().min(1).max(20),
    rationale: nonBlankTextSchema,
  })
  .strict();
export const swapExerciseOperationSchema = z
  .object({
    type: z.literal("swap_exercise"),
    exerciseId: uuidSchema,
    replacementName: z.string().trim().min(1).max(120),
    replacementFamily: movementFamilySchema,
    equivalenceId: uuidSchema,
    rationale: nonBlankTextSchema,
  })
  .strict();
export const adjustmentOperationSchema = z.discriminatedUnion("type", [
  reduceLoadOperationSchema,
  reduceVolumeOperationSchema,
  swapExerciseOperationSchema,
]);
export const adjustmentTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("explicit_coach"), coachId: uuidSchema }).strict(),
  z
    .object({
      type: z.literal("low_readiness"),
      checkInId: uuidSchema,
      readiness: z.number().int().min(1).max(2),
    })
    .strict(),
  z
    .object({ type: z.literal("high_rpe"), sessionId: uuidSchema, rpe: z.number().min(9).max(10) })
    .strict(),
  z
    .object({
      type: z.literal("low_completion"),
      sessionId: uuidSchema,
      completionRatio: z.number().min(0).max(0.7),
    })
    .strict(),
]);
export const adjustmentSchema = z
  .object({
    id: uuidSchema,
    clientId: uuidSchema,
    baseProgrammeId: uuidSchema,
    trigger: adjustmentTriggerSchema,
    sourceEventKey: z.string().trim().min(8).max(200),
    operations: z.array(adjustmentOperationSchema).min(1).max(100),
    status: adjustmentStatusSchema,
    reviewBand: z.enum(["blocked", "attention", "clear"]),
    approvedBy: uuidSchema.nullable(),
    approvedAt: isoInstantSchema.nullable(),
    appliedProgrammeId: uuidSchema.nullable(),
    createdAt: isoInstantSchema,
    version: z.number().int().min(1),
  })
  .strict()
  .superRefine((adjustment, context) => {
    if (
      ["approved", "applied"].includes(adjustment.status) &&
      (adjustment.approvedBy === null || adjustment.approvedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved adjustments require coach approval metadata",
      });
    }
    if (adjustment.status === "applied" && adjustment.appliedProgrammeId === null) {
      context.addIssue({
        code: "custom",
        message: "Applied adjustments require a programme version",
      });
    }
  });
export const generateAdjustmentRequestSchema = z
  .object({ clientId: uuidSchema, sourceEventKey: z.string().trim().min(8).max(200).optional() })
  .strict();
export const reviewAdjustmentRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    reason: z.string().trim().max(1_000).optional(),
  })
  .strict();
export const editAdjustmentRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    operations: z.array(adjustmentOperationSchema).min(1).max(100),
    reason: z.string().trim().max(1_000).optional(),
  })
  .strict();
export const overrideAdjustmentRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();
export const listAdjustmentsQuerySchema = z
  .object({
    clientId: uuidSchema.optional(),
    status: adjustmentStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export type Adjustment = z.infer<typeof adjustmentSchema>;
export type AdjustmentOperation = z.infer<typeof adjustmentOperationSchema>;
export type AdjustmentTrigger = z.infer<typeof adjustmentTriggerSchema>;
