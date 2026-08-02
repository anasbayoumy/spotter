import postgres from "postgres";

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

const networkDependencyCodes = new Set([
  "EADDRNOTAVAIL",
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ERR_SOCKET_CLOSED",
  "ETIMEDOUT",
]);

const postgresJsConnectionCodes = new Set([
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
]);

const postgresUnavailableSqlStates = new Set(["53300", "57P01", "57P02", "57P03"]);

function property(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function isUnavailablePostgresState(code: string): boolean {
  return /^08[A-Z0-9]{3}$/u.test(code) || postgresUnavailableSqlStates.has(code);
}

export function isDatabaseDependencyUnavailable(error: unknown): boolean {
  const visited = new Set<Error>();
  let current: unknown = error;

  for (let depth = 0; depth < maximumCauseDepth; depth += 1) {
    if (!(current instanceof Error) || visited.has(current)) return false;
    const code = property(current, "code");
    if (
      typeof code === "string" &&
      (networkDependencyCodes.has(code) ||
        postgresJsConnectionCodes.has(code) ||
        (current instanceof postgres.PostgresError && isUnavailablePostgresState(code)))
    ) {
      return true;
    }

    visited.add(current);
    current = property(current, "cause");
  }

  return false;
}

export function isUniqueViolation(error: unknown): boolean {
  const visited = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < maximumCauseDepth; depth += 1) {
    if (typeof current !== "object" || current === null || visited.has(current)) return false;
    if (property(current, "code") === "23505") return true;

    visited.add(current);
    current = property(current, "cause");
  }

  return false;
}
