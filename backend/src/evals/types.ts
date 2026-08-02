export type GateName =
  | "adjustment_operation_scope"
  | "forbidden_movement"
  | "frequency_breach"
  | "intensity_ceiling"
  | "medical_language"
  | "nudge_rate"
  | "unknown_family"
  | "volume_spike";

export interface GateFinding {
  readonly code: string;
  readonly detail: string;
  readonly referenceId?: string;
}

export interface GateResult {
  readonly findings: readonly GateFinding[];
  readonly name: GateName;
  readonly passed: boolean;
  readonly rationale: string;
}

export type JudgeName = "coherence" | "consistency" | "grounding" | "intervention";
export type JudgeScore = 1 | 2 | 3 | 4 | 5;

export interface JudgeResult {
  readonly judgeModel: string;
  readonly name: JudgeName;
  readonly rationale: string;
  readonly rubricVersion: string;
  readonly score: JudgeScore;
}

export type ReviewBand = "attention" | "blocked" | "clear";
export type EvaluationIntent = "accountability" | "adjustment" | "programme";

export interface SafetyEvaluation {
  readonly escalationReasons: readonly string[];
  readonly gates: readonly GateResult[];
  readonly outcome: "blocked" | "escalated" | "passed";
}

export interface EvaluatedProposal extends SafetyEvaluation {
  readonly judges: readonly JudgeResult[];
  readonly reviewBand: ReviewBand;
}
