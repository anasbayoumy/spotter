import { apiResponseSchema, type ApiErrorCode, type ResponseMeta } from "@spotter/contracts";
import type { z } from "zod";

export type ApiPath = `/api/v1${string}`;

export interface ApiResult<T> {
  readonly data: T;
  readonly meta: ResponseMeta;
}

export type ClientErrorCode = ApiErrorCode | "invalid_response" | "network_error";

export class ApiClientError extends Error {
  public constructor(
    public readonly code: ClientErrorCode,
    message: string,
    public readonly requestId: string | null,
    public readonly retryable: boolean,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

interface RequestOptions {
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly method?: "GET" | "PATCH" | "POST";
  readonly signal?: AbortSignal;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function requestHeaders(options: RequestOptions): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey !== undefined) headers.set("Idempotency-Key", options.idempotencyKey);
  return headers;
}

export async function requestApi<T>(
  path: ApiPath,
  dataSchema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    const request: RequestInit = {
      cache: "no-store",
      credentials: "same-origin",
      headers: requestHeaders(options),
      method: options.method ?? "GET",
    };
    if (options.body !== undefined) request.body = JSON.stringify(options.body);
    if (options.signal !== undefined) request.signal = options.signal;
    response = await fetch(path, request);
  } catch (error: unknown) {
    if (isAbortError(error)) throw error;
    throw new ApiClientError(
      "network_error",
      "The coach console could not reach the Spotter service.",
      null,
      true,
      null,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiClientError(
      "invalid_response",
      "The service returned an unreadable response.",
      response.headers.get("x-request-id"),
      response.status >= 500,
      response.status,
    );
  }

  const parsed = apiResponseSchema(dataSchema).safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_response",
      "The service response did not match the public contract.",
      response.headers.get("x-request-id"),
      response.status >= 500,
      response.status,
    );
  }
  if (parsed.data.error !== null) {
    throw new ApiClientError(
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.meta.requestId,
      response.status === 429 || response.status >= 500,
      response.status,
    );
  }

  return { data: parsed.data.data, meta: parsed.data.meta };
}

export function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  return new ApiClientError(
    "network_error",
    "The request could not be completed.",
    null,
    true,
    null,
  );
}

export function createIdempotencyKey(scope: string, resourceId: string): string {
  return `${scope}:${resourceId}:${crypto.randomUUID()}`;
}
