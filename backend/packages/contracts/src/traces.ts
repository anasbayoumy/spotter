import { z } from "zod";

import { isoInstantSchema, limits, uuidSchema } from "./primitives";

export const agentIntentSchema = z.enum(["programme", "adjustment", "accountability"]);
export const contextSectionKindSchema = z.enum([
  "hard_constraints",
  "goal_profile_equipment_schedule",
  "current_programme",
  "recent_sessions_adherence",
  "check_ins_metrics",
  "valid_notes",
  "soft_constraints_older_summaries",
]);
export const selectedContextRecordSchema = z
  .object({
    recordId: uuidSchema,
    recordVersion: z.number().int().min(1).nullable(),
    source: z.string().trim().min(1).max(100),
  })
  .strict();
export const contextSectionSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    kind: contextSectionKindSchema,
    pinned: z.boolean(),
    tokenEstimate: z.number().int().min(0),
    records: z.array(selectedContextRecordSchema).max(1_000),
    rendered: z.string().max(100_000),
  })
  .strict();
export const contextTraceAttemptSchema = z
  .object({
    id: uuidSchema,
    clientId: uuidSchema,
    turnId: uuidSchema,
    intent: agentIntentSchema,
    sections: z.array(contextSectionSchema).max(100),
    rendered: z.string().max(500_000),
    tokenCount: z.number().int().min(0),
    budget: z.number().int().positive(),
    createdAt: isoInstantSchema,
  })
  .strict();

export const contextTraceSchema = contextTraceAttemptSchema.refine(
  (trace) => trace.tokenCount <= trace.budget,
  "Trace token count exceeds budget",
);
export const traceSummarySchema = contextTraceAttemptSchema
  .omit({ rendered: true })
  .extend({ renderedPreview: z.string().max(limits.longText) })
  .strict();

export type ContextTrace = z.infer<typeof contextTraceSchema>;
export type ContextTraceAttempt = z.infer<typeof contextTraceAttemptSchema>;
