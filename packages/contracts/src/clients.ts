import { z } from "zod";

import {
  clientHandleSchema,
  ianaTimezoneSchema,
  isoDateSchema,
  isoInstantSchema,
  nonBlankTextSchema,
  uuidSchema,
} from "./primitives";

export const clientStatusSchema = z.enum(["active", "paused", "churned"]);
export const dataClassificationSchema = z.enum(["synthetic", "non_synthetic"]);
export const constraintKindSchema = z.enum([
  "injury",
  "allergy",
  "equipment",
  "schedule",
  "medical",
  "preference",
]);
export const constraintSeveritySchema = z.enum(["hard", "soft"]);
export const constraintSourceSchema = z.enum(["client_reported", "coach_entered", "inferred"]);
export const movementFamilySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);

export const goalSchema = z
  .object({
    primary: nonBlankTextSchema,
    secondary: z.array(nonBlankTextSchema).max(10).default([]),
    targetDate: isoDateSchema.nullable().default(null),
  })
  .strict();

export const clientProfileSchema = z
  .object({
    ageBand: z.enum(["under_18", "18_24", "25_34", "35_44", "45_54", "55_64", "65_plus"]),
    sex: z.enum(["female", "male", "intersex", "not_specified"]),
    trainingAgeMonths: z.number().int().min(0).max(1_200),
    equipment: z.array(z.string().trim().min(1).max(100)).max(100),
    sessionsPerWeek: z.number().int().min(1).max(14),
  })
  .strict();

export const constraintDetailSchema = z
  .object({
    region: z.string().trim().min(1).max(100).nullable().default(null),
    forbids: z.array(movementFamilySchema).max(100).default([]),
    modifies: z.array(movementFamilySchema).max(100).default([]),
    note: z.string().trim().max(1_000).nullable().default(null),
  })
  .strict();

export const clientConstraintSchema = z
  .object({
    id: uuidSchema,
    clientId: uuidSchema,
    kind: constraintKindSchema,
    severity: constraintSeveritySchema,
    source: constraintSourceSchema,
    detail: constraintDetailSchema,
    validFrom: isoInstantSchema,
    validUntil: isoInstantSchema.nullable(),
    createdAt: isoInstantSchema,
  })
  .strict()
  .superRefine((constraint, context) => {
    if (constraint.source === "inferred" && constraint.severity === "hard") {
      context.addIssue({
        code: "custom",
        message: "Inferred constraints cannot be hard",
        path: ["severity"],
      });
    }
    if (
      constraint.validUntil !== null &&
      new Date(constraint.validUntil).valueOf() <= new Date(constraint.validFrom).valueOf()
    ) {
      context.addIssue({
        code: "custom",
        message: "validUntil must be after validFrom",
        path: ["validUntil"],
      });
    }
  });

export const clientSummarySchema = z
  .object({
    id: uuidSchema,
    handle: clientHandleSchema,
    status: clientStatusSchema,
    timezone: ianaTimezoneSchema,
    goals: goalSchema,
    profile: clientProfileSchema,
    coachId: uuidSchema,
    dataClassification: dataClassificationSchema,
    createdAt: isoInstantSchema,
  })
  .strict();

export type ClientSummary = z.infer<typeof clientSummarySchema>;
export type ClientConstraint = z.infer<typeof clientConstraintSchema>;
export type MovementFamily = z.infer<typeof movementFamilySchema>;
