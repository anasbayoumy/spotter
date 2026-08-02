import { createIdempotencyKey } from "./client";

interface IdempotencyEntry {
  readonly fingerprint: string;
  readonly key: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function payloadFingerprint(payload: unknown): string {
  return JSON.stringify(canonicalize(payload));
}

/** Keeps an idempotency key stable only while the exact request payload is stable. */
export class PayloadIdempotencyRegistry {
  readonly #entries = new Map<string, IdempotencyEntry>();

  public keyFor(scope: string, resourceId: string, payload: unknown): string {
    const entryId = `${scope}:${resourceId}`;
    const fingerprint = payloadFingerprint(payload);
    const existing = this.#entries.get(entryId);
    if (existing?.fingerprint === fingerprint) return existing.key;

    const key = createIdempotencyKey(scope, resourceId);
    this.#entries.set(entryId, { fingerprint, key });
    return key;
  }

  public clear(scope: string, resourceId: string): void {
    this.#entries.delete(`${scope}:${resourceId}`);
  }
}
