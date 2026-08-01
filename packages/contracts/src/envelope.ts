import { z } from "zod";

import { requestIdSchema } from "./primitives";

export const apiErrorCodeSchema = z.enum([
  "validation_failed",
  "invalid_date_range",
  "invalid_cron_secret",
  "not_found",
  "client_not_found",
  "programme_not_found",
  "version_conflict",
  "idempotency_key_reused",
  "operation_in_progress",
  "invalid_state_transition",
  "blocked_requires_override",
  "override_reason_required",
  "stale_programme",
  "stale_adjustment",
  "context_hard_constraints_exceed_budget",
  "unsupported_adjustment",
  "model_timeout",
  "model_output_invalid",
  "model_run_failed",
  "recording_not_found",
  "non_synthetic_data_prohibited",
  "rate_limited",
  "dependency_unavailable",
  "internal_error",
]);

export const errorDetailValueSchema = z.union([
  z.string().max(1_000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(100),
]);

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(500),
    details: z.record(z.string().max(100), errorDetailValueSchema).optional(),
  })
  .strict();

export const responseMetaSchema = z
  .object({
    requestId: requestIdSchema,
    cursor: z.string().max(512).nullable().optional(),
    hasMore: z.boolean().optional(),
    total: z.number().int().min(0).optional(),
  })
  .strict();

export type ApiSuccessSchema<T extends z.ZodType> = z.ZodObject<{
  data: T;
  error: z.ZodNull;
  meta: typeof responseMetaSchema;
}>;
export type ApiFailureSchema = z.ZodObject<{
  data: z.ZodNull;
  error: typeof apiErrorSchema;
  meta: typeof responseMetaSchema;
}>;
export type ApiResponseSchema<T extends z.ZodType> = z.ZodUnion<
  readonly [ApiSuccessSchema<T>, ApiFailureSchema]
>;

export function apiSuccessSchema<T extends z.ZodType>(dataSchema: T): ApiSuccessSchema<T> {
  return z.object({ data: dataSchema, error: z.null(), meta: responseMetaSchema }).strict();
}

export function apiFailureSchema(): ApiFailureSchema {
  return z.object({ data: z.null(), error: apiErrorSchema, meta: responseMetaSchema }).strict();
}

export function apiResponseSchema<T extends z.ZodType>(dataSchema: T): ApiResponseSchema<T> {
  return z.union([apiSuccessSchema(dataSchema), apiFailureSchema()]);
}

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ResponseMeta = z.infer<typeof responseMetaSchema>;
