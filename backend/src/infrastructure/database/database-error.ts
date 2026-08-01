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

const maximumCauseDepth = 8;

export function isUniqueViolation(error: unknown): boolean {
  const visited = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < maximumCauseDepth; depth += 1) {
    if (typeof current !== "object" || current === null || visited.has(current)) return false;
    if (Reflect.get(current, "code") === "23505") return true;

    visited.add(current);
    current = Reflect.get(current, "cause");
  }

  return false;
}
