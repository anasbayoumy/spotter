import { readFile } from "node:fs/promises";
import path from "node:path";

import { calibrationLabelsSchema } from "../agents/calibration/labels.js";

const applicationRoot = path.resolve(import.meta.dirname, "../../..");
const labelsPath = path.join(applicationRoot, "backend/resources/calibration/labels.json");
const labels = calibrationLabelsSchema.parse(
  JSON.parse(await readFile(labelsPath, "utf8")) as unknown,
);

if (labels.labels.length === 0) {
  process.stdout.write(
    `Kappa cannot be reported until a human scores the cases. Add labels to ${labelsPath}\n`,
  );
} else {
  throw new Error(
    "Calibration labels exist, but reproducible judge predictions are not present; kappa was not calculated.",
  );
}
