import { describe, expect, it } from "vitest";

import { contextRecordSchema } from "./types.js";

describe("context record temporal diagnostics", () => {
  it("emits the stable custom issue at the invalid upper boundary", () => {
    const instant = "2026-08-02T12:00:00.000Z";
    const result = contextRecordSchema.safeParse({
      content: {},
      recordId: "10000000-0000-4000-8000-000000000001",
      source: "coach",
      validFrom: instant,
      validUntil: instant,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual({
        code: "custom",
        message: "validUntil must be after validFrom",
        path: ["validUntil"],
      });
    }
  });
});
