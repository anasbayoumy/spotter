export type DomainErrorCode =
  | "invalid_value"
  | "invalid_state_transition"
  | "version_conflict"
  | "blocked_requires_override"
  | "override_reason_required"
  | "stale_adjustment"
  | "unsupported_adjustment";

export class DomainError extends Error {
  public constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, string | number | boolean>> = {},
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EntityId {
  public readonly value: string;

  public constructor(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!uuidPattern.test(normalized)) {
      throw new DomainError("invalid_value", "Entity ID must be a UUID");
    }
    this.value = normalized;
    Object.freeze(this);
  }

  public equals(other: EntityId): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }
}

export class IdempotencyKey {
  public readonly value: string;

  public constructor(value: string) {
    const normalized = value.trim();
    if (
      normalized.length < 8 ||
      normalized.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/.test(normalized)
    ) {
      throw new DomainError("invalid_value", "Invalid idempotency key");
    }
    this.value = normalized;
    Object.freeze(this);
  }

  public toString(): string {
    return this.value;
  }
}

export class RequestFingerprint {
  public readonly value: string;

  public constructor(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
      throw new DomainError("invalid_value", "Request fingerprint must be a SHA-256 hex digest");
    }
    this.value = normalized;
    Object.freeze(this);
  }
}

export function assertExpectedVersion(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected < 1 || actual !== expected) {
    throw new DomainError("version_conflict", "The resource version changed", { actual, expected });
  }
}
