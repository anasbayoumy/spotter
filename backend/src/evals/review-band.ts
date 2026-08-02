import type {
  EvaluatedProposal,
  EvaluationIntent,
  JudgeResult,
  ReviewBand,
  SafetyEvaluation,
} from "./types";
import { requiredJudgeNames } from "./judges/judge";

export function calculateReviewBand(
  safety: SafetyEvaluation,
  judges: readonly JudgeResult[],
  intent: EvaluationIntent,
  attentionReasons: readonly string[] = [],
): ReviewBand {
  if (safety.outcome === "blocked" || safety.outcome === "escalated") return "blocked";
  if (attentionReasons.length > 0) return "attention";
  const scores = new Map(judges.map((judge) => [judge.name, judge.score]));
  const required = requiredJudgeNames(intent);
  return required.every((name) => (scores.get(name) ?? 0) >= 4) ? "clear" : "attention";
}

export function combineEvaluation(
  safety: SafetyEvaluation,
  judges: readonly JudgeResult[],
  intent: EvaluationIntent,
  attentionReasons: readonly string[] = [],
): EvaluatedProposal {
  return {
    ...safety,
    judges,
    reviewBand: calculateReviewBand(safety, judges, intent, attentionReasons),
  };
}
