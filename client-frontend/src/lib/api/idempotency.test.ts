import { describe, expect, it } from "vitest";

import { bindKeyToPayload, createIdempotencyKey, payloadFingerprint } from "./idempotency";

describe("payload-bound idempotency keys", () => {
  it("keeps the unattempted key, preserves exact retries, and rotates corrections", () => {
    const initial = createIdempotencyKey("check-in", "client-1");
    const first = bindKeyToPayload(initial, null, "check-in", "client-1", {
      body: "Low recovery",
      readiness: 2,
    });
    const retry = bindKeyToPayload(first.key, first.fingerprint, "check-in", "client-1", {
      readiness: 2,
      body: "Low recovery",
    });
    const corrected = bindKeyToPayload(retry.key, retry.fingerprint, "check-in", "client-1", {
      body: "Recovered after sleep",
      readiness: 3,
    });

    expect(first.key).toBe(initial);
    expect(retry.key).toBe(initial);
    expect(corrected.key).not.toBe(initial);
  });

  it("uses canonical fingerprints for nested payloads", () => {
    expect(payloadFingerprint({ b: [{ y: 2, x: 1 }], a: true })).toBe(
      payloadFingerprint({ a: true, b: [{ x: 1, y: 2 }] }),
    );
  });
});
