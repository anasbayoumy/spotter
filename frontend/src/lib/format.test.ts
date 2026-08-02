import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime, formatLabel, formatPercent, nextMonday } from "./format";

describe("coach-facing formatters", () => {
  it("renders absent and recorded dates without exposing raw timestamps", () => {
    expect(formatDate(null)).toBe("Unknown");
    expect(formatDate("2026-08-02T00:00:00.000Z", { timeZone: "UTC", weekday: "long" })).toBe(
      "Sunday, 2 Aug 2026",
    );
    expect(formatDateTime("2026-08-02T00:00:00.000Z")).toMatch(/^2 Aug 2026, \d{2}:\d{2} /u);
  });

  it("turns contract labels and ratios into concise display text", () => {
    expect(formatLabel("blocked_requires_override")).toBe("Blocked Requires Override");
    expect(formatLabel("")).toBe("");
    expect(formatPercent(null)).toBe("Unavailable");
    expect(formatPercent(0.874)).toBe("87%");
  });

  it.each([
    ["2026-08-02T18:00:00.000Z", "2026-08-03"],
    ["2026-08-03T18:00:00.000Z", "2026-08-10"],
    ["2026-08-05T18:00:00.000Z", "2026-08-10"],
  ])("selects the next future Monday after %s", (from, expected) => {
    expect(nextMonday(new Date(from))).toBe(expected);
  });

  it("uses the current clock when no starting date is supplied", () => {
    const result = nextMonday();
    expect(new Date(`${result}T00:00:00.000Z`).getUTCDay()).toBe(1);
  });
});
