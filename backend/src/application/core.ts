import type { ApiErrorCode } from "@spotter/contracts";

import { DomainError } from "../domain/index";

export interface ExecutionContext {
  readonly requestId: string;
  readonly actorId: string;
  readonly effectiveAt: Date;
  readonly idempotencyKey: string;
}

export class ApplicationError extends Error {
  public constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, string | number | boolean>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApplicationError";
  }
}

export type ApplicationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApplicationError };

export function success<T>(value: T): ApplicationResult<T> {
  return { ok: true, value };
}

export function failure<T>(error: ApplicationError): ApplicationResult<T> {
  return { ok: false, error };
}

export async function executeSafely<T>(work: () => Promise<T>): Promise<ApplicationResult<T>> {
  try {
    return success(await work());
  } catch (error: unknown) {
    if (error instanceof ApplicationError) return failure(error);
    if (error instanceof DomainError) {
      const codeByDomain = {
        blocked_requires_override: "blocked_requires_override",
        invalid_state_transition: "invalid_state_transition",
        invalid_value: "validation_failed",
        override_reason_required: "override_reason_required",
        stale_adjustment: "stale_adjustment",
        unsupported_adjustment: "unsupported_adjustment",
        version_conflict: "version_conflict",
      } as const;
      return failure(
        new ApplicationError(codeByDomain[error.code], error.message, error.details, {
          cause: error,
        }),
      );
    }
    return failure(
      new ApplicationError(
        "internal_error",
        "The operation could not be completed.",
        {},
        { cause: error },
      ),
    );
  }
}

export interface IdempotencyClaim<T> {
  readonly kind: "claimed" | "completed";
  readonly recordId: string;
  readonly value?: T;
}

export interface IdempotencyPort {
  claim<T>(input: {
    readonly scope: string;
    readonly actorId: string;
    readonly key: string;
    readonly requestFingerprint: string;
  }): Promise<IdempotencyClaim<T>>;
  complete(recordId: string, value: unknown, completedAt: Date): Promise<void>;
  fail(recordId: string, code: string, failedAt: Date): Promise<void>;
}

export interface FingerprintPort {
  fingerprint(value: unknown): string;
}

export async function executeIdempotently<T>(
  ports: { readonly idempotency: IdempotencyPort; readonly fingerprint: FingerprintPort },
  context: ExecutionContext,
  scope: string,
  input: unknown,
  work: (recordId: string) => Promise<T>,
): Promise<T> {
  const claim = await ports.idempotency.claim<T>({
    scope,
    actorId: context.actorId,
    key: context.idempotencyKey,
    requestFingerprint: ports.fingerprint.fingerprint(input),
  });
  if (claim.kind === "completed") {
    if (claim.value === undefined)
      throw new ApplicationError(
        "dependency_unavailable",
        "Stored idempotent result is unavailable.",
      );
    return claim.value;
  }
  try {
    const result = await work(claim.recordId);
    await ports.idempotency.complete(claim.recordId, result, context.effectiveAt);
    return result;
  } catch (error: unknown) {
    const code =
      error instanceof ApplicationError
        ? error.code
        : error instanceof DomainError
          ? error.code
          : "internal_error";
    await ports.idempotency.fail(claim.recordId, code, context.effectiveAt);
    throw error;
  }
}
