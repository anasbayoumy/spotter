import { z } from "zod";

import { isoInstantSchema } from "./primitives";

const measuredMetricSchema = z
  .object({
    value: z.number().nullable(),
    sampleSize: z.number().int().min(0),
    availability: z.enum(["available", "unavailable"]),
  })
  .strict()
  .refine(
    (metric) => (metric.availability === "available") === (metric.value !== null),
    "Availability and value disagree",
  );
const unavailableMetric = { availability: "unavailable" as const, sampleSize: 0, value: null };
export const scorecardSchema = z
  .object({
    generatedAt: isoInstantSchema,
    mode: z.enum(["recorded", "live", "mixed"]),
    safetyPassRateByGate: z.record(z.string().min(1).max(100), measuredMetricSchema),
    judgeDistribution: z.record(
      z.string().min(1).max(100),
      z.array(z.number().int().min(0)).length(5),
    ),
    calibrationKappaByJudge: z.record(z.string().min(1).max(100), measuredMetricSchema),
    bandAccuracy: measuredMetricSchema,
    costPerPublishedPlanUsd: measuredMetricSchema,
    latencyP50Ms: measuredMetricSchema,
    latencyP95Ms: measuredMetricSchema,
    schemaFailureRate: measuredMetricSchema.default(unavailableMetric),
    schemaRetryCount: measuredMetricSchema.default(unavailableMetric),
  })
  .strict();

export type Scorecard = z.infer<typeof scorecardSchema>;
