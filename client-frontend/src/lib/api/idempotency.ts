let sequence = 0;

export function createIdempotencyKey(scope: string, resourceId: string): string {
  sequence += 1;
  const resource = resourceId.replace(/[^A-Za-z0-9._:-]/gu, "-").slice(0, 48);
  return `${scope}:${resource}:${Date.now().toString(36)}:${sequence.toString(36)}`;
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

export interface PayloadBoundKey {
  readonly fingerprint: string;
  readonly key: string;
}

/** Retains an unattempted/exact-retry key and rotates it when the submitted payload changes. */
export function bindKeyToPayload(
  currentKey: string,
  previousFingerprint: string | null | undefined,
  scope: string,
  resourceId: string,
  payload: unknown,
): PayloadBoundKey {
  const fingerprint = payloadFingerprint(payload);
  return {
    fingerprint,
    key:
      previousFingerprint === null ||
      previousFingerprint === undefined ||
      previousFingerprint === fingerprint
        ? currentKey
        : createIdempotencyKey(scope, resourceId),
  };
}
