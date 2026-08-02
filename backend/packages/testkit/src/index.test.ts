import { describe, expect, it } from "vitest";

import { FixedClock, SequenceIdGenerator } from "./index.js";

describe("deterministic test helpers", () => {
  it("advances without exposing mutable date state", () => {
    const clock = new FixedClock(new Date("2026-08-02T00:00:00.000Z"));
    const first = clock.now();
    first.setUTCFullYear(2030);
    expect(clock.now().toISOString()).toBe("2026-08-02T00:00:00.000Z");
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe("2026-08-02T00:01:00.000Z");
  });

  it("returns stable IDs and fails visibly when exhausted", () => {
    const ids = new SequenceIdGenerator(["first", "second"]);
    expect(ids.next()).toBe("first");
    expect(ids.next()).toBe("second");
    expect(() => ids.next()).toThrow(/exhausted/u);
  });
});
