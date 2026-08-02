import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

const runId = "coverage-safety-report";
const reportDirectory = path.resolve(
  import.meta.dirname,
  "../../../artifacts/verification",
  runId,
  "reports/safety",
);

describe("safety report command", () => {
  afterAll(async () => {
    delete process.env["SPOTTER_VERIFICATION_RUN_ID"];
    await rm(path.resolve(reportDirectory, "../../..", runId), { force: true, recursive: true });
  });

  it("executes the complete golden set and emits machine and human evidence", async () => {
    process.env["SPOTTER_VERIFICATION_RUN_ID"] = runId;
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await import("./report-safety.js");

    const report = JSON.parse(
      await readFile(path.join(reportDirectory, "results.json"), "utf8"),
    ) as {
      readonly runId: string;
      readonly summary: {
        readonly executed: number;
        readonly falseNegatives: number;
        readonly falsePositives: number;
        readonly matched: number;
      };
    };
    const markdown = await readFile(path.join(reportDirectory, "results.md"), "utf8");
    expect(report.runId).toBe(runId);
    expect(report.summary.executed).toBeGreaterThan(0);
    expect(report.summary.matched).toBe(report.summary.executed);
    expect(report.summary.falseNegatives).toBe(0);
    expect(report.summary.falsePositives).toBe(0);
    expect(markdown).toContain("False negatives\n\nNone.");
    expect(output).toHaveBeenCalledWith(expect.stringContaining(reportDirectory));
    output.mockRestore();
  });
});
