import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { calibrationLabelsSchema } from "./labels.js";

describe("calibration labels", () => {
  it("validates hand labels and enforces generator/judge independence", async () => {
    const text = await readFile(
      new URL("../../../resources/calibration/labels.json", import.meta.url),
      "utf8",
    );
    const value: unknown = JSON.parse(text);
    const labels = calibrationLabelsSchema.parse(value);
    expect(labels.labels).toHaveLength(4);
    expect(labels.generatorModel).not.toBe(labels.judgeModel);
    expect(
      calibrationLabelsSchema.safeParse({ ...labels, judgeModel: labels.generatorModel }).success,
    ).toBe(false);
    expect(
      calibrationLabelsSchema.safeParse({ ...labels, labels: [labels.labels[0], labels.labels[0]] })
        .success,
    ).toBe(false);
  });
});
