import { DomainError } from "./core";
import type { AdjustmentOperation } from "./adjustment";
import type { ReviewBand } from "./programme";

export interface BinaryGateResult {
  readonly passed: boolean;
}

export interface GradedJudgeResult {
  readonly score: 1 | 2 | 3 | 4 | 5;
}

export function calculateReviewBand(
  gates: readonly BinaryGateResult[],
  judges: readonly GradedJudgeResult[],
): ReviewBand {
  if (gates.some((gate) => !gate.passed)) return "blocked";
  if (judges.length > 0 && judges.every((judge) => judge.score >= 4)) return "clear";
  return "attention";
}

export function isMovementAllowed(
  family: string,
  knownFamilies: ReadonlySet<string>,
  forbiddenFamilies: ReadonlySet<string>,
): boolean {
  const normalized = family.trim();
  return (
    normalized.length > 0 && knownFamilies.has(normalized) && !forbiddenFamilies.has(normalized)
  );
}

export function isVolumeSpike(
  previousSets: number,
  proposedSets: number,
  adherence14d: number | null,
): boolean {
  if (
    ![previousSets, proposedSets].every((value) => Number.isInteger(value) && value >= 0) ||
    (adherence14d !== null && (adherence14d < 0 || adherence14d > 1))
  ) {
    throw new DomainError("invalid_value", "Invalid volume/adherence input");
  }
  if (adherence14d === null || adherence14d >= 0.6) return false;
  return previousSets === 0 ? proposedSets > 0 : (proposedSets - previousSets) / previousSets > 0.3;
}

export function breachesIntensityCeiling(rpe: number, hasActiveHardInjury: boolean): boolean {
  if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10)
    throw new DomainError("invalid_value", "Invalid RPE");
  return hasActiveHardInjury && rpe >= 9;
}

export function breachesFrequency(plannedSessions: number, allowedSessions: number): boolean {
  if (![plannedSessions, allowedSessions].every((value) => Number.isInteger(value) && value >= 0))
    throw new DomainError("invalid_value", "Invalid frequency");
  return plannedSessions > allowedSessions;
}

export function adjustmentOperationsAreReducing(
  operations: readonly AdjustmentOperation[],
): boolean {
  return operations.length > 0;
}

export function containsConfiguredPattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function inferredConstraintSeverityIsValid(
  source: "client_reported" | "coach_entered" | "inferred",
  severity: "hard" | "soft",
): boolean {
  return source !== "inferred" || severity === "soft";
}
