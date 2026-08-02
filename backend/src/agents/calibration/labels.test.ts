import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { calibrationLabelsSchema } from "./labels.js";

describe("calibration labels", () => {
  it("keeps unreviewed labels empty and enforces honest source transitions", async () => {
    const text = await readFile(
      new URL("../../../resources/calibration/labels.json", import.meta.url),
      "utf8",
    );
    const value: unknown = JSON.parse(text);
    const labels = calibrationLabelsSchema.parse(value);
    expect(labels.labelSource).toBe("pending_human_review");
    expect(labels.labels).toHaveLength(0);
    expect(
      calibrationLabelsSchema.safeParse({
        ...labels,
        labels: [
          {
            id: "unreviewed",
            judge: "grounding",
            rationale: "This must not be accepted as a human score.",
            recordingId: "programme-baseline-v1",
            score: 5,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      calibrationLabelsSchema.safeParse({
        ...labels,
        generatorModel: "same",
        judgeModel: "same",
      }).success,
    ).toBe(false);
  });
});
