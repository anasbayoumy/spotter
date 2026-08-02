import { z } from "zod";

import { isoInstantSchema, limits, uuidSchema } from "./primitives";

export const readinessSchema = z.number().int().min(1).max(5);
export const checkInSchema = z
  .object({
    id: uuidSchema,
    clientId: uuidSchema,
    readiness: readinessSchema,
    body: z.string().trim().min(1).max(limits.longText),
    sentiment: z.number().min(-1).max(1).nullable(),
    respondedAt: isoInstantSchema,
    latencyHours: z
      .number()
      .min(0)
      .max(24 * 365)
      .nullable(),
    createdAt: isoInstantSchema,
    requiresHumanEscalation: z.boolean(),
  })
  .strict();
export const createCheckInRequestSchema = z
  .object({
    clientId: uuidSchema,
    readiness: readinessSchema,
    body: z.string().trim().min(1).max(limits.longText),
    respondedAt: isoInstantSchema,
  })
  .strict();

export type CheckIn = z.infer<typeof checkInSchema>;
