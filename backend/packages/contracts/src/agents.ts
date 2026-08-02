import { z } from "zod";

import { adjustmentOperationSchema } from "./adjustments";
import { accountabilityTierSchema } from "./accountability";
import { citationSchema, programmePayloadSchema } from "./programmes";
import { isoInstantSchema, uuidSchema } from "./primitives";
import { agentIntentSchema } from "./traces";

export const programmeModelOutputSchema = z
  .object({ payload: programmePayloadSchema, citations: z.array(citationSchema).min(1).max(100) })
  .strict();
export const adjustmentModelOutputSchema = z
  .object({
    operations: z.array(adjustmentOperationSchema).min(1).max(100),
    citations: z.array(citationSchema).min(1).max(100),
  })
  .strict();
export const accountabilityModelOutputSchema = z
  .object({
    kind: z.enum(["client_nudge", "reduced_plan_offer", "coach_context_brief"]),
    tier: accountabilityTierSchema,
    body: z.string().trim().min(1).max(1_000),
    citations: z.array(citationSchema).min(1).max(100),
  })
  .strict()
  .refine((value) => value.tier >= 1 && value.tier <= 3, "Only tiers 1 through 3 can draft content")
  .refine(
    (value) =>
      value.kind ===
      (
        {
          1: "client_nudge",
          2: "reduced_plan_offer",
          3: "coach_context_brief",
        } as const
      )[value.tier as 1 | 2 | 3],
    "Accountability content kind must match its deterministic tier",
  );

export const modelModeSchema = z.enum(["recorded", "live"]);
export const modelUsageSchema = z
  .object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    costUsd: z.number().min(0),
  })
  .strict();
export const agentRunSchema = z
  .object({
    id: uuidSchema,
    agent: agentIntentSchema,
    mode: modelModeSchema,
    promptVersion: z.string().trim().min(1).max(128),
    model: z.string().trim().min(1).max(200),
    traceId: uuidSchema,
    usage: modelUsageSchema.nullable(),
    latencyMs: z.number().int().min(0),
    output: z
      .union([
        programmeModelOutputSchema,
        adjustmentModelOutputSchema,
        accountabilityModelOutputSchema,
      ])
      .nullable(),
    errorCode: z.string().trim().min(1).max(100).nullable(),
    createdAt: isoInstantSchema,
  })
  .strict()
  .refine(
    (run) => (run.output === null) !== (run.errorCode === null),
    "A run has exactly one output or error",
  );

export type ProgrammeModelOutput = z.infer<typeof programmeModelOutputSchema>;
export type AdjustmentModelOutput = z.infer<typeof adjustmentModelOutputSchema>;
export type AccountabilityModelOutput = z.infer<typeof accountabilityModelOutputSchema>;
