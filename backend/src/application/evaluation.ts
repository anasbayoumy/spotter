import type { GateResult, JudgeResult, ReviewBand } from "@spotter/contracts";

import { calculateReviewBand } from "../domain/index";
import { ApplicationError } from "./core";

function judgeScore(score: number): 1 | 2 | 3 | 4 | 5 {
  if (score === 1 || score === 2 || score === 3 || score === 4 || score === 5) return score;
  throw new ApplicationError("model_output_invalid", "Judge returned an out-of-range score.");
}

export function reviewBandFromResults(
  gates: readonly GateResult[],
  judges: readonly JudgeResult[],
): ReviewBand {
  return calculateReviewBand(
    gates,
    judges.map((judge) => ({ score: judgeScore(judge.score) })),
  );
}
