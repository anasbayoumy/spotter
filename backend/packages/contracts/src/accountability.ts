import { z } from "zod";

import { isoInstantSchema, uuidSchema } from "./primitives";

export const accountabilityTierSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export const accountabilityOwnerSchema = z.enum(["none", "automation", "coach"]);
export const messageStatusSchema = z.enum(["drafted", "sent", "suppressed", "cancelled"]);
export const messageActorSchema = z.enum(["agent", "coach"]);

export const engagementInputsSchema = z
  .object({
    plannedDue7d: z.number().int().min(0).max(100),
    completedDue7d: z.number().int().min(0).max(100),
    plannedDue14d: z.number().int().min(0).max(200),
    completedDue14d: z.number().int().min(0).max(200),
    missedDue7d: z.number().int().min(0).max(100),
    missedDue14d: z.number().int().min(0).max(200),
    currentCheckInLatencyHours: z.number().min(0).nullable(),
    baselineCheckInLatencyHours: z.number().positive().nullable(),
    baselineCheckInCount: z.number().int().min(0),
    daysSinceOpen: z.number().int().min(0).nullable(),
    rpeDrift: z.number().nullable(),
  })
  .strict()
  .superRefine((inputs, context) => {
    if (inputs.completedDue7d > inputs.plannedDue7d) {
      context.addIssue({
        code: "custom",
        message: "7-day completed sessions exceed planned sessions",
        path: ["completedDue7d"],
      });
    }
    if (inputs.completedDue14d > inputs.plannedDue14d) {
      context.addIssue({
        code: "custom",
        message: "14-day completed sessions exceed planned sessions",
        path: ["completedDue14d"],
      });
    }
  });

export const engagementScoreSchema = z
  .object({
    id: uuidSchema,
    clientId: uuidSchema,
    computedAt: isoInstantSchema,
    inputs: engagementInputsSchema,
    adherence7d: z.number().min(0).max(1).nullable(),
    adherence14d: z.number().min(0).max(1).nullable(),
    score: z.number().min(0).max(100),
    tier: accountabilityTierSchema,
  })
  .strict();

export const accountabilityStateSchema = z
  .object({
    clientId: uuidSchema,
    tier: accountabilityTierSchema,
    owner: accountabilityOwnerSchema,
    lastTransitionAt: isoInstantSchema,
    automationPaused: z.boolean(),
    churnFlagged: z.boolean(),
    version: z.number().int().min(1),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.tier >= 3 && (state.owner !== "coach" || !state.automationPaused)) {
      context.addIssue({
        code: "custom",
        message: "Tier 3 and 4 require coach ownership and paused automation",
      });
    }
    if (state.tier === 4 && !state.churnFlagged) {
      context.addIssue({
        code: "custom",
        message: "Tier 4 requires a churn flag",
        path: ["churnFlagged"],
      });
    }
  });

export const inAppMessageSchema = z
  .object({
    id: uuidSchema,
    clientId: uuidSchema,
    tier: accountabilityTierSchema,
    actor: messageActorSchema,
    status: messageStatusSchema,
    body: z.string().trim().min(1).max(1_000),
    createdAt: isoInstantSchema,
    sentAt: isoInstantSchema.nullable(),
    suppressedAt: isoInstantSchema.nullable(),
    suppressionReason: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();
export const runAccountabilityRequestSchema = z
  .object({ clientId: uuidSchema, effectiveAt: isoInstantSchema.optional() })
  .strict();
export const accountabilityDetailSchema = z
  .object({
    state: accountabilityStateSchema,
    latestScore: engagementScoreSchema.nullable(),
    messages: z.array(inAppMessageSchema).max(100),
  })
  .strict();

export type AccountabilityTier = z.infer<typeof accountabilityTierSchema>;
export type EngagementInputs = z.infer<typeof engagementInputsSchema>;
export type AccountabilityState = z.infer<typeof accountabilityStateSchema>;
