import { canSendAutomatedMessage } from "../../../domain/accountability";
import { isCurrentAt } from "../../../domain/temporal";
import type { GateFinding, GateName, GateResult } from "../../types";
import type { SafetyConstraint, SafetyInput } from "../contracts";
import { resolveMovementFamily } from "../movement-taxonomy";

type Gate = (input: SafetyInput) => GateResult;

function result(name: GateName, findings: readonly GateFinding[]): GateResult {
  return {
    findings,
    name,
    passed: findings.length === 0,
    rationale:
      findings.length === 0
        ? `${name} passed.`
        : `${name} blocked ${String(findings.length)} unsafe condition${findings.length === 1 ? "" : "s"}.`,
  };
}

export function activeHardConstraints(input: SafetyInput): readonly SafetyConstraint[] {
  return input.constraints.filter(
    (constraint) =>
      constraint.severity === "hard" &&
      isCurrentAt(
        {
          supersededBy: constraint.supersededBy,
          validFrom: constraint.validFrom,
          validUntil: constraint.validUntil,
        },
        input.asOf,
      ),
  );
}

export const unknownFamilyGate: Gate = (input) => {
  const findings: GateFinding[] = [];
  for (const exercise of input.exercises) {
    if (resolveMovementFamily(exercise.family) === null) {
      findings.push({
        code: "unknown_exercise_family",
        detail: `Exercise ${exercise.name} has unknown family ${exercise.family}.`,
        referenceId: exercise.id,
      });
    }
  }
  for (const constraint of activeHardConstraints(input)) {
    for (const family of constraint.forbids) {
      if (resolveMovementFamily(family) === null) {
        findings.push({
          code: "unknown_constraint_family",
          detail: `Constraint ${constraint.id} contains unknown family ${family}.`,
          referenceId: constraint.id,
        });
      }
    }
  }
  return result("unknown_family", findings);
};

export const forbiddenMovementGate: Gate = (input) => {
  const forbidden = new Map<string, string>();
  for (const constraint of activeHardConstraints(input)) {
    for (const rawFamily of constraint.forbids) {
      const family = resolveMovementFamily(rawFamily);
      if (family !== null) forbidden.set(family, constraint.id);
    }
  }

  const findings: GateFinding[] = [];
  for (const exercise of input.exercises) {
    const family = resolveMovementFamily(exercise.family);
    const constraintId = family === null ? undefined : forbidden.get(family);
    if (family !== null && constraintId !== undefined) {
      findings.push({
        code: "forbidden_movement_family",
        detail: `Exercise ${exercise.name} resolves to forbidden family ${family} from constraint ${constraintId}.`,
        referenceId: exercise.id,
      });
    }
  }
  return result("forbidden_movement", findings);
};

export const volumeSpikeGate: Gate = (input) => {
  const findings = input.volumeChanges.flatMap((change): readonly GateFinding[] => {
    if (input.adherence14d === null || input.adherence14d >= 0.6) return [];
    const increaseRatio =
      change.previousSets === 0
        ? change.proposedSets > 0
          ? Number.POSITIVE_INFINITY
          : 0
        : (change.proposedSets - change.previousSets) / change.previousSets;
    return increaseRatio > 0.3
      ? [
          {
            code: "low_adherence_volume_spike",
            detail: `${change.muscleGroup} volume rises from ${String(change.previousSets)} to ${String(change.proposedSets)} sets at ${String(input.adherence14d)} adherence.`,
          },
        ]
      : [];
  });
  return result("volume_spike", findings);
};

export const intensityCeilingGate: Gate = (input) => {
  const hasHardInjury = activeHardConstraints(input).some(
    (constraint) => constraint.kind === "injury" || constraint.kind === "medical",
  );
  const findings = hasHardInjury
    ? input.exercises
        .filter((exercise) => exercise.rpe >= 9)
        .map(
          (exercise): GateFinding => ({
            code: "hard_injury_high_intensity",
            detail: `${exercise.name} prescribes RPE ${String(exercise.rpe)} with an active hard injury constraint.`,
            referenceId: exercise.id,
          }),
        )
    : [];
  return result("intensity_ceiling", findings);
};

export const frequencyBreachGate: Gate = (input) => {
  const findings =
    input.allowedSessions !== null && input.plannedSessions > input.allowedSessions
      ? [
          {
            code: "schedule_frequency_exceeded",
            detail: `${String(input.plannedSessions)} planned sessions exceed the ${String(input.allowedSessions)} session limit.`,
          },
        ]
      : [];
  return result("frequency_breach", findings);
};

export const adjustmentOperationScopeGate: Gate = (input) => {
  if (input.adjustment === null) return result("adjustment_operation_scope", []);
  const findings: GateFinding[] = [];
  if (input.adjustment.autoApply) {
    findings.push({
      code: "v1_auto_apply_prohibited",
      detail: "V1 requires coach approval for every adjustment.",
    });
  }
  for (const [index, operation] of input.adjustment.operations.entries()) {
    switch (operation.type) {
      case "reduce_load":
        if (
          operation.direction === "increase" ||
          operation.percent === undefined ||
          operation.percent <= 0 ||
          operation.percent > 100
        ) {
          findings.push({
            code: "invalid_load_reduction",
            detail: `Operation ${String(index)} is not a valid load reduction.`,
          });
        }
        break;
      case "reduce_volume":
        if (
          operation.direction === "increase" ||
          operation.setsToRemove === undefined ||
          !Number.isInteger(operation.setsToRemove) ||
          operation.setsToRemove < 1
        ) {
          findings.push({
            code: "invalid_volume_reduction",
            detail: `Operation ${String(index)} is not a valid volume reduction.`,
          });
        }
        break;
      case "swap_exercise":
        if (
          operation.equivalenceId === undefined ||
          operation.replacementFamily === undefined ||
          resolveMovementFamily(operation.replacementFamily) === null
        ) {
          findings.push({
            code: "undocumented_exercise_swap",
            detail: `Operation ${String(index)} lacks a documented known equivalent.`,
          });
        }
        break;
      default:
        findings.push({
          code: "unsupported_adjustment_operation",
          detail: `Operation ${String(index)} uses unsupported type ${operation.type}.`,
        });
    }
  }
  return result("adjustment_operation_scope", findings);
};

export const nudgeRateGate: Gate = (input) => {
  if (!input.nudge?.automated) return result("nudge_rate", []);
  const findings: GateFinding[] = [];
  if (input.nudge.owner === "coach" || input.nudge.tier >= 3) {
    findings.push({
      code: "human_owned_escalation",
      detail: "Automated contact is prohibited for human-owned or tier 3/4 escalation.",
    });
  }
  if (!canSendAutomatedMessage(input.nudge.lastAutomatedSentAt, input.nudge.attemptedAt)) {
    findings.push({
      code: "automated_message_within_48h",
      detail: "Previous automated contact is inside the rolling 48-hour suppression window.",
    });
  }
  return result("nudge_rate", findings);
};

const medicalPatterns: readonly Readonly<{ code: string; pattern: RegExp }>[] = [
  {
    code: "diagnostic_claim",
    pattern: /\b(?:you\s+have|you\s+are\s+suffering\s+from|diagnos(?:e|ed|is))\b/iu,
  },
  {
    code: "condition_as_fact",
    pattern: /\bthis\s+(?:is|means)\s+(?:a|an)?\s*(?:fracture|tear|infection|disease|syndrome)\b/iu,
  },
  {
    code: "medication_advice",
    pattern:
      /\b(?:start|stop|increase|decrease|change|take|skip)\b.{0,48}\b(?:medication|medicine|dose|dosage|mg)\b/iu,
  },
];

export const medicalLanguageGate: Gate = (input) => {
  const findings = medicalPatterns.flatMap(({ code, pattern }): readonly GateFinding[] => {
    pattern.lastIndex = 0;
    return pattern.test(input.outputText)
      ? [{ code, detail: "Output contains prohibited diagnostic or medication language." }]
      : [];
  });
  return result("medical_language", findings);
};

export const deterministicGates: readonly Readonly<{ name: GateName; run: Gate }>[] = [
  { name: "unknown_family", run: unknownFamilyGate },
  { name: "forbidden_movement", run: forbiddenMovementGate },
  { name: "volume_spike", run: volumeSpikeGate },
  { name: "intensity_ceiling", run: intensityCeilingGate },
  { name: "frequency_breach", run: frequencyBreachGate },
  { name: "adjustment_operation_scope", run: adjustmentOperationScopeGate },
  { name: "nudge_rate", run: nudgeRateGate },
  { name: "medical_language", run: medicalLanguageGate },
];
