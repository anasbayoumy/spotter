import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const filesystem = vi.hoisted(() => ({ readFile: vi.fn() }));

vi.mock("node:fs/promises", () => ({ readFile: filesystem.readFile }));

const emptyLabels = {
  generatorModel: "generator-a",
  judgeModel: null,
  labelSource: "pending_human_review",
  labels: [],
  schemaVersion: 1,
};

describe("calibration CLI", () => {
  beforeEach(() => {
    filesystem.readFile.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the exact human-label path when calibration is pending", async () => {
    filesystem.readFile.mockResolvedValue(JSON.stringify(emptyLabels));
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await import("./calibrate.js");

    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toMatch(
      /Kappa cannot be reported until a human scores the cases\. Add labels to .*backend\/resources\/calibration\/labels\.json\n/u,
    );
  });

  it("refuses to invent kappa when human labels exist without predictions", async () => {
    filesystem.readFile.mockResolvedValue(
      JSON.stringify({
        ...emptyLabels,
        judgeModel: "judge-a",
        labelSource: "human_reviewed_synthetic",
        labels: [
          {
            id: "human-label-1",
            judge: "grounding",
            rationale: "A human supplied this score.",
            recordingId: "programme-baseline-v1",
            score: 4,
          },
        ],
      }),
    );

    await expect(import("./calibrate.js")).rejects.toThrow(
      /reproducible judge predictions are not present/u,
    );
  });
});
