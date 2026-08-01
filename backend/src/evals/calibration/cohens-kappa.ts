import type { JudgeScore } from "../types.js";

export interface CalibrationLabel {
  readonly human: JudgeScore;
  readonly predicted: JudgeScore;
}

export interface CalibrationMetrics {
  readonly confusionMatrix: readonly (readonly number[])[];
  readonly exactMatchRate: number | null;
  readonly kappa: number | null;
  readonly sampleSize: number;
}

const scores = [1, 2, 3, 4, 5] as const;

function isRuntimeJudgeScore(value: unknown): value is JudgeScore {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

function emptyCounts(): Record<JudgeScore, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

export function calculateCalibration(labels: readonly CalibrationLabel[]): CalibrationMetrics {
  const counts: Record<JudgeScore, Record<JudgeScore, number>> = {
    1: emptyCounts(),
    2: emptyCounts(),
    3: emptyCounts(),
    4: emptyCounts(),
    5: emptyCounts(),
  };
  const humanMargins = emptyCounts();
  const predictedMargins = emptyCounts();
  for (const label of labels) {
    if (!isRuntimeJudgeScore(label.human)) {
      throw new Error("Invalid human calibration score.");
    }
    if (!isRuntimeJudgeScore(label.predicted)) {
      throw new Error("Invalid predicted calibration score.");
    }
    counts[label.human][label.predicted] += 1;
    humanMargins[label.human] += 1;
    predictedMargins[label.predicted] += 1;
  }
  const matrix = scores.map((human) => scores.map((predicted) => counts[human][predicted]));
  if (labels.length === 0) {
    return { confusionMatrix: matrix, exactMatchRate: null, kappa: null, sampleSize: 0 };
  }

  const exact = labels.filter((label) => label.human === label.predicted).length;
  const observed = exact / labels.length;
  const expected = scores.reduce(
    (sum, score) =>
      sum + (humanMargins[score] / labels.length) * (predictedMargins[score] / labels.length),
    0,
  );
  // If expected agreement is one, both raters use the same single class, so observed is also one.
  const kappa = expected === 1 ? 1 : (observed - expected) / (1 - expected);
  return { confusionMatrix: matrix, exactMatchRate: observed, kappa, sampleSize: labels.length };
}
