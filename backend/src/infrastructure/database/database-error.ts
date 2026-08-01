export type DatabaseInvariantCode =
  | "blocked_requires_override"
  | "dependency_unavailable"
  | "idempotency_key_reused"
  | "invalid_state_transition"
  | "not_found"
  | "operation_in_progress"
  | "override_reason_required"
  | "publication_conflict";

export class DatabaseInvariantError extends Error {
  readonly code: DatabaseInvariantCode;

  constructor(code: DatabaseInvariantCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseInvariantError";
    this.code = code;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return (error as { readonly code?: unknown }).code === "23505";
}
