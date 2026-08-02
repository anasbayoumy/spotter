import { z } from "zod";

import { agentIntentSchema, isoInstantSchema, uuidSchema } from "@spotter/contracts";
import type { contextSectionSchema } from "@spotter/contracts";

export type AgentIntent = z.infer<typeof agentIntentSchema>;
export type ContextSection = z.infer<typeof contextSectionSchema>;

export const contextRecordSchema = z
  .object({
    recordId: uuidSchema,
    recordVersion: z.number().int().min(1).nullable().default(null),
    source: z.string().trim().min(1).max(100),
    content: z.json(),
    createdAt: isoInstantSchema.nullable().default(null),
    validFrom: isoInstantSchema.nullable().default(null),
    validUntil: isoInstantSchema.nullable().default(null),
    supersededBy: uuidSchema.nullable().default(null),
    similarity: z.number().min(0).max(1).nullable().default(null),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.validFrom !== null &&
      record.validUntil !== null &&
      new Date(record.validUntil).valueOf() <= new Date(record.validFrom).valueOf()
    ) {
      context.addIssue({
        code: "custom",
        message: "validUntil must be after validFrom",
        path: ["validUntil"],
      });
    }
  });

const recordListSchema = z.array(contextRecordSchema).max(1_000);

export const contextSourceInputSchema = z
  .object({
    clientId: uuidSchema,
    effectiveAt: isoInstantSchema,
    budget: z.number().int().positive().max(1_000_000),
    hardConstraints: recordListSchema,
    goalProfileEquipmentSchedule: recordListSchema,
    currentProgramme: recordListSchema,
    recentSessionsAdherence: recordListSchema,
    checkInsMetrics: recordListSchema,
    notes: recordListSchema,
    softConstraintsOlderSummaries: recordListSchema,
  })
  .strict();

export const contextAssemblyRequestSchema = contextSourceInputSchema
  .extend({
    traceId: uuidSchema,
    turnId: uuidSchema,
    intent: agentIntentSchema,
    createdAt: isoInstantSchema,
  })
  .strict();

export type ContextRecord = z.infer<typeof contextRecordSchema>;
export type ContextSourceInput = z.infer<typeof contextSourceInputSchema>;

export interface ContextEviction {
  readonly recordId: string;
  readonly sectionKind: ContextSection["kind"];
  readonly reason: "not_active_at_effective_time" | "superseded" | "token_budget";
}

export interface ContextTraceAttempt {
  readonly id: string;
  readonly clientId: string;
  readonly turnId: string;
  readonly intent: AgentIntent;
  readonly effectiveAt: string;
  readonly sections: readonly ContextSection[];
  readonly rendered: string;
  readonly tokenCount: number;
  readonly budget: number;
  readonly evictions: readonly ContextEviction[];
  readonly createdAt: string;
}

export type ContextAssemblyRequest = z.input<typeof contextAssemblyRequestSchema>;

export type ContextAssemblyResult =
  | { readonly status: "ready"; readonly trace: ContextTraceAttempt }
  | { readonly status: "hard_constraint_overflow"; readonly trace: ContextTraceAttempt };
