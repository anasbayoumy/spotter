import { describe, expect, it } from "vitest";

import { PayloadIdempotencyRegistry, payloadFingerprint } from "./idempotency";

describe("PayloadIdempotencyRegistry", () => {
  it("retains a key for the exact canonical payload and rotates on correction", () => {
    const registry = new PayloadIdempotencyRegistry();
    const first = registry.keyFor("adjustment.edit", "adjustment-1", {
      expectedVersion: 1,
      operations: [{ setsToRemove: 4, type: "reduce_volume" }],
    });
    const exactRetry = registry.keyFor("adjustment.edit", "adjustment-1", {
      operations: [{ type: "reduce_volume", setsToRemove: 4 }],
      expectedVersion: 1,
    });
    const corrected = registry.keyFor("adjustment.edit", "adjustment-1", {
      expectedVersion: 1,
      operations: [{ setsToRemove: 2, type: "reduce_volume" }],
    });

    expect(exactRetry).toBe(first);
    expect(corrected).not.toBe(first);
  });

  it("clears confirmed actions so a deliberate repeat gets a fresh key", () => {
    const registry = new PayloadIdempotencyRegistry();
    const payload = { expectedVersion: 1 };
    const first = registry.keyFor("programme.approve", "programme-1", payload);
    registry.clear("programme.approve", "programme-1");
    expect(registry.keyFor("programme.approve", "programme-1", payload)).not.toBe(first);
  });

  it("fingerprints nested object keys canonically", () => {
    expect(payloadFingerprint({ z: 1, a: { y: 2, x: 3 } })).toBe(
      payloadFingerprint({ a: { x: 3, y: 2 }, z: 1 }),
    );
  });
});
