import type { ApiError, ResponseMeta } from "@spotter/contracts";
import type { z } from "zod";

import { getApiConfiguration } from "./config";
import { ApiClientError } from "./errors";

export interface RequestOptions {
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly method?: "GET" | "PATCH" | "POST";
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

type ApiEnvelope<T> =
  | { readonly data: null; readonly error: ApiError; readonly meta: ResponseMeta }
  | { readonly data: T; readonly error: null; readonly meta: ResponseMeta };

function requestUrl(path: string): string {
  const { baseUrl } = getApiConfiguration();
  return `${baseUrl}${path}`;
}

function requestIdFrom(response: Response): string | null {
  const value = response.headers.get("x-request-id")?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

export async function requestJson<T>(
  path: string,
  responseSchema: z.ZodType<ApiEnvelope<T>>,
  options: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort("timeout");
  }, options.timeoutMs ?? 12_000);
  const abortFromCaller = (): void => {
    controller.abort(options.signal?.reason);
  };
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey !== undefined) headers["Idempotency-Key"] = options.idempotencyKey;
    const response = await fetch(requestUrl(path), {
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      headers,
      method: options.method ?? "GET",
      signal: controller.signal,
    });
    const fallbackRequestId = requestIdFrom(response);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ApiClientError({
        code: "invalid_response",
        kind: "contract",
        message: "The server returned an unreadable response.",
        requestId: fallbackRequestId,
        retryable: response.status >= 500,
        status: response.status,
      });
    }
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiClientError({
        code: "invalid_response",
        kind: "contract",
        message: "The server response did not match the public API contract.",
        requestId: fallbackRequestId,
        retryable: false,
        status: response.status,
      });
    }
    if (parsed.data.error !== null) {
      throw new ApiClientError({
        code: parsed.data.error.code,
        kind: "api",
        message: parsed.data.error.message,
        requestId: parsed.data.meta.requestId,
        retryable: response.status === 429 || response.status >= 500,
        status: response.status,
      });
    }
    if (!response.ok) {
      throw new ApiClientError({
        code: "invalid_response",
        kind: "contract",
        message: "The server returned success data with an error status.",
        requestId: parsed.data.meta.requestId,
        retryable: response.status >= 500,
        status: response.status,
      });
    }
    return parsed.data.data;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (controller.signal.aborted) {
      throw new ApiClientError({
        code: "request_timeout",
        kind: "timeout",
        message: "The request timed out. Your entered data is still here.",
        retryable: true,
      });
    }
    throw new ApiClientError({
      code: "network_unavailable",
      kind: "network",
      message: "Spotter could not reach the server. Check your connection and retry.",
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
