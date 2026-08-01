import { describe, expect, it } from "vitest";

import type { SafetyInput } from "../safety/contracts.js";
import { safetyInputSchema } from "../safety/contracts.js";
import {
  activeHardConstraints,
  adjustmentOperationScopeGate,
  forbiddenMovementGate,
  frequencyBreachGate,
  intensityCeilingGate,
  medicalLanguageGate,
  nudgeRateGate,
  unknownFamilyGate,
  volumeSpikeGate,
} from "../safety/gates/gates.js";
import {
  knownMovementFamilies,
  movementAliases,
  normalizeMovementIdentifier,
  resolveMovementFamily,
} from "../safety/movement-taxonomy.js";

const AS_OF = new Date("2026-08-03T06:00:00.000Z");

function input(patch: Readonly<Partial<SafetyInput>> = {}): SafetyInput {
  return safetyInputSchema.parse({
    adherence14d: null,
    adjustment: null,
    allowedSessions: 3,
    asOf: AS_OF,
    checkInText: "",
    constraints: [],
    exercises: [
      {
        family: "horizontal_pull",
        id: "exercise-safe",
        muscleGroups: ["back"],
        name: "Cable row",
        rpe: 7,
        sets: 3,
      },
    ],
    intent: "programme",
    nudge: null,
    outputText: "A safe proposal.",
    plannedSessions: 3,
    volumeChanges: [],
    ...patch,
  });
}

function constraint(
  patch: Readonly<Partial<SafetyInput["constraints"][number]>> = {},
): SafetyInput["constraints"][number] {
  return {
    forbids: ["overhead_press"],
    id: "constraint-active",
    kind: "injury",
    severity: "hard",
    supersededBy: null,
    validFrom: new Date("2026-08-01T00:00:00.000Z"),
    validUntil: null,
    ...patch,
  };
}

describe("movement taxonomy complete behavior", () => {
  it("normalizes case, surrounding punctuation, whitespace, and repeated separators", () => {
    expect(normalizeMovementIdentifier("  HANDSTAND---Push__Up!!  ")).toBe("handstand_push_up");
    expect(normalizeMovementIdentifier("___")).toBe("");
  });

  it("resolves every declared alias and exposes each canonical alias list", () => {
    for (const family of knownMovementFamilies) {
      const aliases = movementAliases(family);
      expect(aliases.length).toBeGreaterThan(0);
      for (const alias of aliases) expect(resolveMovementFamily(alias)).toBe(family);
    }
    expect(resolveMovementFamily("not registered")).toBeNull();
  });
});

describe("constraint and family gates", () => {
  it("selects only active, current hard constraints", () => {
    const constraints = [
      constraint(),
      constraint({ id: "soft", severity: "soft" }),
      constraint({ id: "superseded", supersededBy: "replacement" }),
      constraint({ id: "expired", validUntil: AS_OF }),
      constraint({ id: "future", validFrom: new Date("2026-08-03T06:00:00.001Z") }),
    ];
    expect(activeHardConstraints(input({ constraints })).map(({ id }) => id)).toEqual([
      "constraint-active",
    ]);
  });

  it("reports unknown exercise and active-constraint families with exact references", () => {
    const result = unknownFamilyGate(
      input({
        constraints: [constraint({ forbids: ["made_up_constraint_family"] })],
        exercises: [
          {
            family: "made_up_exercise_family",
            id: "unknown-exercise",
            muscleGroups: [],
            name: "Mystery drill",
            rpe: 5,
            sets: 1,
          },
        ],
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.rationale).toContain("2 unsafe conditions");
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: "unknown_exercise_family",
        referenceId: "unknown-exercise",
      }),
      expect.objectContaining({
        code: "unknown_constraint_family",
        referenceId: "constraint-active",
      }),
    ]);
  });

  it("ignores unknown constraint mappings here while blocking all known forbidden matches", () => {
    const unknownConstraint = forbiddenMovementGate(
      input({ constraints: [constraint({ forbids: ["not_registered"] })] }),
    );
    expect(unknownConstraint.passed).toBe(true);

    const result = forbiddenMovementGate(
      input({
        constraints: [constraint()],
        exercises: [
          {
            family: "push_press",
            id: "forbidden",
            muscleGroups: ["shoulders"],
            name: "Push press",
            rpe: 7,
            sets: 3,
          },
          {
            family: "unknown_but_handled_by_prior_gate",
            id: "unknown",
            muscleGroups: [],
            name: "Unknown",
            rpe: 7,
            sets: 1,
          },
          {
            family: "hinge",
            id: "allowed",
            muscleGroups: ["hamstrings"],
            name: "Deadlift",
            rpe: 7,
            sets: 3,
          },
        ],
      }),
    );
    expect(result.findings).toEqual([
      expect.objectContaining({ code: "forbidden_movement_family", referenceId: "forbidden" }),
    ]);
  });
});

describe("volume, intensity, and frequency boundaries", () => {
  it("covers absent/high adherence and every zero-baseline volume branch", () => {
    const volume = (
      adherence14d: number | null,
      previousSets: number,
      proposedSets: number,
    ): ReturnType<typeof volumeSpikeGate> =>
      volumeSpikeGate(
        input({
          adherence14d,
          volumeChanges: [{ muscleGroup: "legs", previousSets, proposedSets }],
        }),
      );

    expect(volume(null, 10, 20).passed).toBe(true);
    expect(volume(0.6, 10, 20).passed).toBe(true);
    expect(volume(0.59, 0, 0).passed).toBe(true);
    expect(volume(0.59, 0, 1).passed).toBe(false);
    expect(volume(0.59, 10, 13).passed).toBe(true);
    expect(volume(0.59, 10, 14).passed).toBe(false);
  });

  it("applies the intensity ceiling only for active hard injury or medical constraints", () => {
    const highExercise = {
      family: "hinge",
      id: "high-rpe",
      muscleGroups: ["hamstrings"],
      name: "Deadlift",
      rpe: 9,
      sets: 2,
    };
    expect(intensityCeilingGate(input({ exercises: [highExercise] })).passed).toBe(true);
    expect(
      intensityCeilingGate(
        input({ constraints: [constraint({ kind: "equipment" })], exercises: [highExercise] }),
      ).passed,
    ).toBe(true);
    expect(
      intensityCeilingGate(
        input({ constraints: [constraint({ kind: "injury" })], exercises: [highExercise] }),
      ).passed,
    ).toBe(false);
    expect(
      intensityCeilingGate(
        input({ constraints: [constraint({ kind: "medical" })], exercises: [highExercise] }),
      ).passed,
    ).toBe(false);
    expect(
      intensityCeilingGate(
        input({
          constraints: [constraint()],
          exercises: [{ ...highExercise, rpe: 8.9 }],
        }),
      ).passed,
    ).toBe(true);
  });

  it("passes an absent or inclusive frequency cap and blocks only an exceeded cap", () => {
    expect(frequencyBreachGate(input({ allowedSessions: null, plannedSessions: 14 })).passed).toBe(
      true,
    );
    expect(frequencyBreachGate(input({ allowedSessions: 3, plannedSessions: 3 })).passed).toBe(
      true,
    );
    const blocked = frequencyBreachGate(input({ allowedSessions: 3, plannedSessions: 4 }));
    expect(blocked.passed).toBe(false);
    expect(blocked.findings[0]?.code).toBe("schedule_frequency_exceeded");
  });
});

describe("adjustment operation scope gate", () => {
  it("passes an absent proposal and every allowed coach-reviewed reduction or documented swap", () => {
    expect(adjustmentOperationScopeGate(input()).passed).toBe(true);
    const result = adjustmentOperationScopeGate(
      input({
        adjustment: {
          autoApply: false,
          operations: [
            { direction: "decrease", percent: 25, type: "reduce_load" },
            { direction: "decrease", setsToRemove: 1, type: "reduce_volume" },
            {
              equivalenceId: "equivalent-1",
              replacementFamily: "hinge",
              type: "swap_exercise",
            },
          ],
        },
      }),
    );
    expect(result.passed).toBe(true);
  });

  it("rejects auto-apply independently and every malformed load-reduction boundary", () => {
    const result = adjustmentOperationScopeGate(
      input({
        adjustment: {
          autoApply: true,
          operations: [
            { direction: "increase", percent: 10, type: "reduce_load" },
            { direction: "decrease", type: "reduce_load" },
            { direction: "decrease", percent: 0, type: "reduce_load" },
            { direction: "decrease", percent: 101, type: "reduce_load" },
          ],
        },
      }),
    );
    expect(result.findings.map(({ code }) => code)).toEqual([
      "v1_auto_apply_prohibited",
      "invalid_load_reduction",
      "invalid_load_reduction",
      "invalid_load_reduction",
      "invalid_load_reduction",
    ]);
  });

  it("rejects every malformed volume reduction, undocumented swap, and unknown operation", () => {
    const result = adjustmentOperationScopeGate(
      input({
        adjustment: {
          autoApply: false,
          operations: [
            { direction: "increase", setsToRemove: 1, type: "reduce_volume" },
            { direction: "decrease", type: "reduce_volume" },
            { direction: "decrease", setsToRemove: 0.5, type: "reduce_volume" },
            { direction: "decrease", setsToRemove: 0, type: "reduce_volume" },
            { type: "swap_exercise" },
            { equivalenceId: "equivalent-1", type: "swap_exercise" },
            {
              equivalenceId: "equivalent-1",
              replacementFamily: "unknown_family",
              type: "swap_exercise",
            },
            { type: "increase_load" },
          ],
        },
      }),
    );
    expect(result.findings.map(({ code }) => code)).toEqual([
      "invalid_volume_reduction",
      "invalid_volume_reduction",
      "invalid_volume_reduction",
      "invalid_volume_reduction",
      "undocumented_exercise_swap",
      "undocumented_exercise_swap",
      "undocumented_exercise_swap",
      "unsupported_adjustment_operation",
    ]);
  });
});

describe("nudge and medical-language gates", () => {
  const nudge = (
    patch: Readonly<Partial<NonNullable<SafetyInput["nudge"]>>> = {},
  ): NonNullable<SafetyInput["nudge"]> => ({
    attemptedAt: AS_OF,
    automated: true,
    concurrentAttempts: 1,
    lastAutomatedSentAt: null,
    owner: "automation",
    tier: 1,
    ...patch,
  });

  it("passes absent/manual/eligible nudges and blocks coach, tier, and recency independently", () => {
    expect(nudgeRateGate(input()).passed).toBe(true);
    expect(nudgeRateGate(input({ nudge: nudge({ automated: false }) })).passed).toBe(true);
    expect(nudgeRateGate(input({ nudge: nudge() })).passed).toBe(true);
    expect(nudgeRateGate(input({ nudge: nudge({ owner: "coach" }) })).passed).toBe(false);
    expect(nudgeRateGate(input({ nudge: nudge({ tier: 3 }) })).passed).toBe(false);
    const recent = nudgeRateGate(
      input({ nudge: nudge({ lastAutomatedSentAt: new Date(AS_OF.valueOf() - 1) }) }),
    );
    expect(recent.findings.map(({ code }) => code)).toEqual(["automated_message_within_48h"]);
    const combined = nudgeRateGate(
      input({
        nudge: nudge({
          lastAutomatedSentAt: new Date(AS_OF.valueOf() - 1),
          owner: "coach",
        }),
      }),
    );
    expect(combined.findings).toHaveLength(2);
  });

  it("detects each prohibited medical form without false positives", () => {
    expect(medicalLanguageGate(input()).passed).toBe(true);
    const result = medicalLanguageGate(
      input({
        outputText:
          "You have a shoulder issue. This is a fracture. Stop your current medication dose.",
      }),
    );
    expect(result.findings.map(({ code }) => code)).toEqual([
      "diagnostic_claim",
      "condition_as_fact",
      "medication_advice",
    ]);
  });
});
