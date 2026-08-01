import type { ApiErrorCode } from "@spotter/contracts";

export type ClientErrorKind = "api" | "configuration" | "contract" | "network" | "timeout";

export class ApiClientError extends Error {
  readonly code: ApiErrorCode | "invalid_response" | "network_unavailable" | "request_timeout";
  readonly kind: ClientErrorKind;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly status: number | null;

  public constructor(input: {
    readonly code: ApiClientError["code"];
    readonly kind: ClientErrorKind;
    readonly message: string;
    readonly requestId?: string | null;
    readonly retryable: boolean;
    readonly status?: number | null;
  }) {
    super(input.message);
    this.name = "ApiClientError";
    this.code = input.code;
    this.kind = input.kind;
    this.requestId = input.requestId ?? null;
    this.retryable = input.retryable;
    this.status = input.status ?? null;
  }
}

export function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  if (error instanceof Error) {
    return new ApiClientError({
      code: "network_unavailable",
      kind: "network",
      message: error.message,
      retryable: true,
    });
  }
  return new ApiClientError({
    code: "network_unavailable",
    kind: "network",
    message: "The request could not be completed.",
    retryable: true,
  });
}

export function isStaleConflict(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 409 &&
    ["stale_programme", "version_conflict", "invalid_state_transition"].includes(error.code)
  );
}
