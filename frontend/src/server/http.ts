import { randomUUID } from "node:crypto";

import {
  apiErrorCodeSchema,
  idempotencyKeySchema,
  requestIdSchema,
  type ApiError,
  type ApiErrorCode,
} from "@spotter/contracts";
import { parseServerEnvironment } from "@spotter/config";
import { z } from "zod";

import { ClusterAdmissionClient, type ClusterAdmissionTransport } from "./cluster-admission";
import {
  requestClassFor,
  requestLimitsFor,
  type RequestClass,
  type RequestLimitProfile,
} from "./deployment-admission.mjs";

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
const dangerousObjectKeys = new Set(["__proto__", "constructor", "prototype"]);
class HttpBoundaryError extends Error {
  public constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "HttpBoundaryError";
  }
}

interface RateWindow {
  count: number;
  startedAt: number;
}

class HttpRequestGuard {
  readonly #windows = new Map<RequestClass, RateWindow>();
  #generationInFlight = 0;
  #limits: Readonly<Record<RequestClass, number>> | undefined;
  #profile: RequestLimitProfile | undefined;

  #requestPolicy(): {
    readonly limits: Readonly<Record<RequestClass, number>>;
    readonly profile: RequestLimitProfile;
  } {
    if (this.#limits === undefined) {
      try {
        this.#profile = parseServerEnvironment(process.env).SPOTTER_RATE_LIMIT_PROFILE;
        this.#limits = requestLimitsFor(this.#profile);
      } catch {
        throw new HttpBoundaryError(
          "internal_error",
          "The server request policy is unavailable.",
          500,
        );
      }
    }
    return { limits: this.#limits, profile: this.#profile ?? "default" };
  }

  public async acquire(request: Request, mutation: boolean): Promise<() => void> {
    const path = new URL(request.url).pathname;
    const requestClass = requestClassFor(path, mutation);
    const policy = this.#requestPolicy();
    if (clusterAdmission !== undefined) {
      return clusterAdmission.acquire(requestClass, policy.profile);
    }
    const now = Date.now();
    const current = this.#windows.get(requestClass);
    const window =
      current === undefined || now - current.startedAt >= 60_000
        ? { count: 0, startedAt: now }
        : current;
    window.count += 1;
    this.#windows.set(requestClass, window);
    if (window.count > policy.limits[requestClass]) {
      throw new HttpBoundaryError(
        "rate_limited",
        "The request limit was reached. Retry after the current window.",
        429,
      );
    }
    if (requestClass !== "generation") return (): void => undefined;
    if (this.#generationInFlight >= 4) {
      throw new HttpBoundaryError(
        "rate_limited",
        "The generation queue is full. Retry after an active request completes.",
        429,
      );
    }
    this.#generationInFlight += 1;
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      this.#generationInFlight -= 1;
    };
  }

  public reset(): void {
    this.#windows.clear();
    this.#generationInFlight = 0;
    this.#limits = undefined;
    this.#profile = undefined;
  }
}

function createClusterAdmission(): ClusterAdmissionClient | undefined {
  if (process.env["SPOTTER_WEB_CLUSTER_WORKER"] !== "true" || process.send === undefined) {
    return undefined;
  }
  const transport: ClusterAdmissionTransport = {
    isConnected: () => process.connected,
    send: (message, callback) => {
      if (process.send === undefined) {
        callback?.(new Error("Cluster IPC is unavailable."));
        return;
      }
      process.send(message, undefined, undefined, (error: Error | null) => {
        callback?.(error ?? null);
      });
    },
    subscribe: (onMessage, onDisconnect) => {
      process.on("message", onMessage);
      process.on("disconnect", onDisconnect);
      return (): void => {
        process.off("message", onMessage);
        process.off("disconnect", onDisconnect);
      };
    },
  };
  return new ClusterAdmissionClient(transport);
}

const clusterAdmission = createClusterAdmission();
const requestGuard = new HttpRequestGuard();

export function resetHttpSecurityStateForTests(): void {
  requestGuard.reset();
}

function responseHeaders(id: string): Readonly<Record<string, string>> {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "permissions-policy": "camera=(), geolocation=(), microphone=()",
    "referrer-policy": "no-referrer",
    vary: "Origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-request-id": id,
  };
}

function enforceSameOrigin(request: Request): void {
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin === null) return;
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    throw new HttpBoundaryError("validation_failed", "Request URL is invalid.", 400);
  }
  if (suppliedOrigin !== requestOrigin) {
    throw new HttpBoundaryError(
      "validation_failed",
      "Cross-origin requests are not permitted by this deployment.",
      403,
    );
  }
}

function assertNoDangerousObjectKeys(value: unknown): void {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    visited += 1;
    if (visited > 20_000) {
      throw new HttpBoundaryError("validation_failed", "Request structure is too complex.", 400);
    }
    if (typeof current !== "object" || current === null) continue;
    for (const key of Object.keys(current)) {
      if (dangerousObjectKeys.has(key)) {
        throw new HttpBoundaryError(
          "validation_failed",
          "Request contains a prohibited object key.",
          400,
        );
      }
      pending.push(Reflect.get(current, key));
    }
  }
}

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
  return undefined;
}

const unsafeErrorText =
  /(?:\b(?:api[_-]?key|authorization|bearer|password|secret|token)\b|postgres(?:ql)?:\/\/|\bsk-[A-Za-z0-9_-]+|\/(?:app|home|Users|workspace)\/|\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^\r\n]{0,120}\b(?:FROM|INTO|SET)\b|provider[^\r\n]{0,40}(?:body|response)|[\r\n])/iu;

const safeErrorMessages: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  dependency_unavailable: "A required service is temporarily unavailable.",
  internal_error: "The operation could not be completed.",
  model_output_invalid: "The model response could not be validated.",
  model_run_failed: "The model request could not be completed.",
  model_timeout: "The model request exceeded its deadline.",
  recording_not_found: "The required recorded fixture is unavailable.",
};

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
  const fallback = safeErrorMessages[code.data] ?? "The operation could not be completed.";
  const message =
    code.data === "internal_error" || unsafeErrorText.test(rawMessage)
      ? fallback
      : rawMessage.slice(0, 500) || fallback;
  return {
    code: code.data,
    message,
    ...(details === undefined ? {} : { details }),
  };
}

function statusFrom(error: unknown, code: ApiErrorCode): number {
  return error instanceof HttpBoundaryError ? error.status : statusFor(code);
}

export async function apiRoute<Output>(
  request: Request,
  responseSchema: z.ZodType,
  handler: (context: ApiRequestContext) => Promise<Output>,
  options: ApiRouteOptions = {},
): Promise<Response> {
  const id = requestId(request);
  let release = (): void => undefined;
  try {
    enforceSameOrigin(request);
    release = await requestGuard.acquire(request, options.mutation === true);
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
      headers: responseHeaders(id),
      status: options.successStatus ?? 200,
    });
  } catch (error: unknown) {
    const apiError = errorFrom(error);
    const envelope = responseSchema.parse({ data: null, error: apiError, meta: { requestId: id } });
    return Response.json(envelope, {
      headers: responseHeaders(id),
      status: statusFrom(error, apiError.code),
    });
  } finally {
    release();
  }
}

async function readBoundedBody(request: Request): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/u.test(declared)) {
      throw new HttpBoundaryError("validation_failed", "Content-Length is invalid.", 400);
    }
    if (Number(declared) > maximumBodyBytes) {
      throw new HttpBoundaryError(
        "validation_failed",
        "Request body exceeds the configured limit.",
        413,
      );
    }
  }
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maximumBodyBytes) {
      await reader.cancel();
      throw new HttpBoundaryError(
        "validation_failed",
        "Request body exceeds the configured limit.",
        413,
      );
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new HttpBoundaryError("validation_failed", "Request body must be valid UTF-8.", 400);
  }
}

export async function parseBody<Input>(request: Request, schema: z.ZodType<Input>): Promise<Input> {
  const text = await readBoundedBody(request);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpBoundaryError("validation_failed", "Request body must be valid JSON.", 400);
  }
  assertNoDangerousObjectKeys(value);
  return schema.parse(value);
}

export function parseQuery<Input>(request: Request, schema: z.ZodType<Input>): Input {
  const query: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (dangerousObjectKeys.has(key)) {
      throw new HttpBoundaryError("validation_failed", "Query key is prohibited.", 400);
    }
    if (Object.hasOwn(query, key)) {
      throw new HttpBoundaryError("validation_failed", "Duplicate query keys are prohibited.", 400);
    }
    query[key] = value;
  }
  return schema.parse(query);
}

export async function parseParams<Input>(
  params: Promise<Record<string, string | string[] | undefined>>,
  schema: z.ZodType<Input>,
): Promise<Input> {
  const value = await params;
  assertNoDangerousObjectKeys(value);
  return schema.parse(value);
}
