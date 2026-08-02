import { describe, expect, it } from "vitest";

import { breakpoints, motion, palette, radius, reviewState, spacing, typography } from "./index";

describe("design-token public surface", () => {
  it("exposes stable shared values for coach and client presentation", () => {
    expect(reviewState.clear.foreground).toBe(palette.clear);
    expect(reviewState.attention.label).toBe("Needs attention");
    expect(reviewState.blocked.foreground).toBe(palette.blocked);
    expect(spacing.none).toBe(0);
    expect(radius.pill).toBe(999);
    expect(typography.family.sans).toBe("Inter");
    expect(breakpoints.desktop).toBe(1_024);
    expect(motion.normalMs).toBe(200);
  });
});
