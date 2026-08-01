import { randomUUID } from "node:crypto";

import {
  apiErrorCodeSchema,
  apiErrorSchema,
  idempotencyKeySchema,
  requestIdSchema,
  type ApiError,
  type ApiErrorCode,
} from "@spotter/contracts";
import { z } from "zod";

export interface ApiRequestContext {
  readonly effectiveAt: Date;
  readonly idempotencyKey?: string;
  readonly requestId: string;
}

interface ApiRouteOptions {
  readonly mutation?: boolean;
  readonly successStatus?: number;
  readonly authorize?: (request: Request) => void;
}

const listPageMarker = Symbol("api-list-page");

interface ApiListPage<T> {
  readonly [listPageMarker]: true;
  readonly items: readonly T[];
  readonly limit: number;
  readonly offset: number;
}

const maximumBodyBytes = 1_000_000;

function cursorOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const match = /^v1:(0|[1-9]\d*)$/.exec(cursor);
  const offset = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw Object.assign(new Error("Cursor is invalid or no longer supported."), {
      code: "validation_failed",
    });
  }
  return offset;
}

export function listPage<T>(
  items: readonly T[],
  input: { readonly cursor?: string | undefined; readonly limit: number },
): ApiListPage<T> {
  return {
    [listPageMarker]: true,
    items,
    limit: input.limit,
    offset: cursorOffset(input.cursor),
  };
}

function isListPage(value: unknown): value is ApiListPage<unknown> {
  return typeof value === "object" && value !== null && listPageMarker in value;
}

function statusFor(code: ApiErrorCode): number {
  const statuses: Readonly<Record<ApiErrorCode, number>> = {
    blocked_requires_override: 422,
    client_not_found: 404,
    context_hard_constraints_exceed_budget: 422,
    dependency_unavailable: 503,
    idempotency_key_reused: 409,
    internal_error: 500,
    invalid_cron_secret: 401,
    invalid_date_range: 400,
    invalid_state_transition: 409,
    model_output_invalid: 503,
    model_run_failed: 503,
    model_timeout: 503,
    non_synthetic_data_prohibited: 409,
    not_found: 404,
    operation_in_progress: 409,
    override_reason_required: 400,
    programme_not_found: 404,
    rate_limited: 429,
    recording_not_found: 503,
    stale_adjustment: 409,
    stale_programme: 409,
    unsupported_adjustment: 422,
    validation_failed: 400,
    version_conflict: 409,
  };
  return statuses[code];
}

function requestId(request: Request): string {
  const supplied = requestIdSchema.safeParse(request.headers.get("x-request-id"));
  return supplied.success ? supplied.data : randomUUID();
}

function readProperty(value: object, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

function errorDetails(error: unknown): ApiError["details"] {
  if (error instanceof z.ZodError) {
    return {
      issues: error.issues
        .slice(0, 20)
        .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`),
    };
  }
  if (typeof error !== "object" || error === null || !("details" in error)) return undefined;
  const parsed = apiErrorSchema.shape.details.safeParse(readProperty(error, "details"));
  return parsed.success ? parsed.data : undefined;
}

function errorFrom(error: unknown): ApiError {
  if (error instanceof z.ZodError) {
    return {
      code: "validation_failed",
      details: errorDetails(error),
      message: "The request did not match the required schema.",
    };
  }
  const candidate =
    typeof error === "object" && error !== null ? readProperty(error, "code") : undefined;
  const code = apiErrorCodeSchema.safeParse(candidate);
  if (!code.success) {
    return { code: "internal_error", message: "The operation could not be completed." };
  }
  const rawMessage =
    error instanceof Error ? error.message : "The operation could not be completed.";
  const details = errorDetails(error);
  return {
    code: code.data,
    message: rawMessage.slice(0, 500) || "The operation could not be completed.",
    ...(details === undefined ? {} : { details }),
  };
}

export async function apiRoute<Output>(
  request: Request,
  responseSchema: z.ZodType,
  handler: (context: ApiRequestContext) => Promise<Output>,
  options: ApiRouteOptions = {},
): Promise<Response> {
  const id = requestId(request);
  try {
    options.authorize?.(request);
    const idempotencyKey = options.mutation
      ? idempotencyKeySchema.parse(request.headers.get("idempotency-key"))
      : undefined;
    const context: ApiRequestContext = {
      effectiveAt: new Date(),
      requestId: id,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    };
    const result: unknown = await handler(context);
    const data = isListPage(result)
      ? result.items.slice(result.offset, result.offset + result.limit)
      : result;
    const meta = {
      requestId: id,
      ...(isListPage(result)
        ? {
            cursor:
              result.offset + result.limit < result.items.length
                ? `v1:${String(result.offset + result.limit)}`
                : null,
            hasMore: result.offset + result.limit < result.items.length,
            total: result.items.length,
          }
        : Array.isArray(data)
          ? { cursor: null, hasMore: false, total: data.length }
          : {}),
    };
    const envelope = responseSchema.parse({ data, error: null, meta });
    return Response.json(envelope, {
      headers: { "cache-control": "no-store", "x-request-id": id },
      status: options.successStatus ?? 200,
    });
  } catch (error: unknown) {
    const apiError = errorFrom(error);
    const envelope = responseSchema.parse({ data: null, error: apiError, meta: { requestId: id } });
    return Response.json(envelope, {
      headers: { "cache-control": "no-store", "x-request-id": id },
      status: statusFor(apiError.code),
    });
  }
}

export async function parseBody<Input>(request: Request, schema: z.ZodType<Input>): Promise<Input> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBodyBytes) {
    throw Object.assign(new Error("Request body exceeds the configured limit."), {
      code: "validation_failed",
    });
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumBodyBytes) {
    throw Object.assign(new Error("Request body exceeds the configured limit."), {
      code: "validation_failed",
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), {
      code: "validation_failed",
    });
  }
  return schema.parse(value);
}

export function parseQuery<Input>(request: Request, schema: z.ZodType<Input>): Input {
  const query: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) query[key] = value;
  return schema.parse(query);
}

export async function parseParams<Input>(
  params: Promise<Record<string, string | string[] | undefined>>,
  schema: z.ZodType<Input>,
): Promise<Input> {
  return schema.parse(await params);
}
