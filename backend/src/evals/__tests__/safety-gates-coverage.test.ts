import { describe, expect, it } from "vitest";

import type { SafetyInput } from "../safety/contracts.js";
import {
  rawAdjustmentOperationSchema,
  safetyConstraintSchema,
  safetyExerciseSchema,
  safetyInputSchema,
  volumeChangeSchema,
} from "../safety/contracts.js";
import {
  activeHardConstraints,
  adjustmentOperationScopeGate,
  deterministicGates,
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
  MOVEMENT_TAXONOMY_VERSION,
  movementAliases,
  normalizeMovementIdentifier,
  resolveMovementFamily,
} from "../safety/movement-taxonomy.js";
import { detectRedFlags } from "../safety/red-flags.js";
import { maximumAutomatedMessages, runDeterministicSafety } from "../safety/run-gates.js";

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
  it("pins the reviewed taxonomy version used by safety evidence", () => {
    expect(MOVEMENT_TAXONOMY_VERSION).toBe("2026-08-02.v1");
  });

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

describe("safety input boundary contracts", () => {
  it("trims bounded text and rejects text beyond its reviewed maximum", () => {
    expect(input({ checkInText: "  symptom report  " }).checkInText).toBe("symptom report");
    expect(
      safetyInputSchema.safeParse({ ...input(), checkInText: "x".repeat(10_001) }).success,
    ).toBe(false);
  });

  it("normalizes exercise and constraint identifiers while preserving safe defaults", () => {
    const exercise = safetyExerciseSchema.parse({
      family: "  hinge  ",
      id: "  exercise-1  ",
      muscleGroups: ["  posterior chain  "],
      name: "  Deadlift  ",
      rpe: 7,
      sets: 3,
    });
    expect(exercise.name).toBe("Deadlift");
    expect(exercise.family).toBe("hinge");
    expect(exercise.id).toBe("exercise-1");
    expect(exercise.muscleGroups).toEqual(["posterior chain"]);

    expect(
      safetyExerciseSchema.parse({
        family: "hinge",
        id: "exercise-defaults",
        name: "Deadlift",
        rpe: 7,
        sets: 3,
      }).muscleGroups,
    ).toEqual([]);

    const parsedConstraint = safetyConstraintSchema.parse({
      forbids: ["  squat  "],
      id: "  constraint-1  ",
      kind: "injury",
      severity: "hard",
      validFrom: AS_OF,
    });
    expect(parsedConstraint.id).toBe("constraint-1");
    expect(parsedConstraint.forbids).toEqual(["squat"]);
  });

  it("rejects an empty half-open validity interval with a stable explanation", () => {
    const parsed = safetyConstraintSchema.safeParse({
      id: "constraint-1",
      kind: "injury",
      severity: "hard",
      validFrom: AS_OF,
      validUntil: AS_OF,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map(({ message }) => message)).toContain(
        "validUntil must be after validFrom",
      );
    }
  });

  it("trims adjustment metadata and accepts all documented input enum variants", () => {
    expect(
      rawAdjustmentOperationSchema.parse({
        equivalenceId: "  equivalent-1  ",
        replacementFamily: "  hinge  ",
        type: "  swap_exercise  ",
      }),
    ).toEqual({
      equivalenceId: "equivalent-1",
      replacementFamily: "hinge",
      type: "swap_exercise",
    });

    const parsed = input({
      intent: "adjustment",
      nudge: {
        attemptedAt: AS_OF,
        automated: false,
        concurrentAttempts: 2,
        lastAutomatedSentAt: null,
        owner: "none",
        tier: 0,
      },
    });
    expect(parsed.intent).toBe("adjustment");
    expect(parsed.nudge).toEqual(expect.objectContaining({ concurrentAttempts: 2, owner: "none" }));

    expect(
      safetyConstraintSchema.parse({
        id: "schedule-constraint",
        kind: "schedule",
        severity: "soft",
        validFrom: AS_OF,
      }).kind,
    ).toBe("schedule");
    for (const kind of [
      "allergy",
      "equipment",
      "injury",
      "medical",
      "preference",
      "schedule",
    ] as const) {
      expect(
        safetyConstraintSchema.parse({
          id: `constraint-${kind}`,
          kind,
          severity: "soft",
          supersededBy: "  replacement-id  ",
          validFrom: AS_OF,
        }),
      ).toMatchObject({ kind, supersededBy: "replacement-id" });
    }
    expect(
      volumeChangeSchema.parse({
        muscleGroup: "  posterior chain  ",
        previousSets: 10,
        proposedSets: 11,
      }).muscleGroup,
    ).toBe("posterior chain");
  });

  it("applies empty text defaults rather than fabricating safety input", () => {
    const parsed = safetyInputSchema.parse({
      asOf: AS_OF,
      intent: "programme",
    });
    expect(parsed.checkInText).toBe("");
    expect(parsed.outputText).toBe("");
    expect(
      safetyInputSchema.parse({
        asOf: AS_OF,
        intent: "adjustment",
        adjustment: { operations: [] },
      }).adjustment?.autoApply,
    ).toBe(false);
  });
});

describe("red-flag phrase coverage", () => {
  it("returns stable reason codes for every escalation family", () => {
    expect(detectRedFlags("Chest pain, then I fainted, and now I may self-harm.")).toEqual([
      "chest_pain",
      "loss_of_consciousness",
      "self_harm",
    ]);
  });

  it.each([
    ["loss  of consciousness", "loss_of_consciousness"],
    ["loss of  consciousness", "loss_of_consciousness"],
    ["passed out", "loss_of_consciousness"],
    ["passed  out", "loss_of_consciousness"],
    ["faint", "loss_of_consciousness"],
    ["kill  myself", "self_harm"],
    ["hurt  myself", "self_harm"],
    ["self-harm", "self_harm"],
    ["self harm", "self_harm"],
    ["selfharm", "self_harm"],
  ])("detects spacing-sensitive phrase %s", (text, expectedCode) => {
    expect(detectRedFlags(text)).toEqual([expectedCode]);
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

  it("reports exact evidence for an unknown exercise family", () => {
    const result = unknownFamilyGate(
      input({
        exercises: [
          {
            family: "unknown-family",
            id: "exercise-1",
            muscleGroups: [],
            name: "Mystery press",
            rpe: 7,
            sets: 3,
          },
        ],
      }),
    );
    expect(result.findings).toEqual([
      {
        code: "unknown_exercise_family",
        detail: "Exercise Mystery press has unknown family unknown-family.",
        referenceId: "exercise-1",
      },
    ]);
    expect(
      unknownFamilyGate(input({ constraints: [constraint({ forbids: ["unknown-family"] })] }))
        .findings,
    ).toEqual([
      {
        code: "unknown_constraint_family",
        detail: "Constraint constraint-active contains unknown family unknown-family.",
        referenceId: "constraint-active",
      },
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
    expect(result.rationale).toBe("unknown_family blocked 2 unsafe conditions.");
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

  it("returns a stable passing gate result", () => {
    expect(unknownFamilyGate(input({ constraints: [], exercises: [] }))).toEqual({
      findings: [],
      name: "unknown_family",
      passed: true,
      rationale: "unknown_family passed.",
    });
  });

  it("returns a stable single-finding rationale and exact forbidden evidence", () => {
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
        ],
      }),
    );
    expect(result.rationale).toBe("forbidden_movement blocked 1 unsafe condition.");
    expect(result.findings).toEqual([
      {
        code: "forbidden_movement_family",
        detail:
          "Exercise Push press resolves to forbidden family overhead_press from constraint constraint-active.",
        referenceId: "forbidden",
      },
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
    expect(volume(0.59, 10, 14).findings).toEqual([
      {
        code: "low_adherence_volume_spike",
        detail: "legs volume rises from 10 to 14 sets at 0.59 adherence.",
      },
    ]);
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
        input({ constraints: [constraint({ kind: "injury" })], exercises: [highExercise] }),
      ).findings,
    ).toEqual([
      {
        code: "hard_injury_high_intensity",
        detail: "Deadlift prescribes RPE 9 with an active hard injury constraint.",
        referenceId: "high-rpe",
      },
    ]);
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
    expect(blocked.name).toBe("frequency_breach");
    expect(blocked.passed).toBe(false);
    expect(blocked.findings[0]?.code).toBe("schedule_frequency_exceeded");
  });
});

describe("adjustment operation scope gate", () => {
  it("passes an absent proposal and every allowed coach-reviewed reduction or documented swap", () => {
    expect(adjustmentOperationScopeGate(input())).toMatchObject({
      name: "adjustment_operation_scope",
      passed: true,
    });
    const result = adjustmentOperationScopeGate(
      input({
        adjustment: {
          autoApply: false,
          operations: [
            { direction: "decrease", percent: 25, type: "reduce_load" },
            { direction: "decrease", percent: 100, type: "reduce_load" },
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
    expect(result.findings.every(({ detail }) => detail.length > 0)).toBe(true);
    expect(result.findings[0]?.detail).toBe("V1 requires coach approval for every adjustment.");
    expect(result.findings[1]?.detail).toBe("Operation 0 is not a valid load reduction.");
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
    expect(result.findings.at(-1)?.detail).toBe("Operation 7 uses unsupported type increase_load.");
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
    expect(nudgeRateGate(input()).name).toBe("nudge_rate");
    expect(nudgeRateGate(input({ nudge: nudge({ automated: false }) })).passed).toBe(true);
    expect(nudgeRateGate(input({ nudge: nudge() })).passed).toBe(true);
    expect(nudgeRateGate(input({ nudge: nudge({ owner: "coach" }) })).passed).toBe(false);
    expect(
      nudgeRateGate(input({ nudge: nudge({ owner: "coach" }) })).findings.map(({ code }) => code),
    ).toEqual(["human_owned_escalation"]);
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
    expect(combined.findings.map(({ detail }) => detail)).toEqual([
      "Automated contact is prohibited for human-owned or tier 3/4 escalation.",
      "Previous automated contact is inside the rolling 48-hour suppression window.",
    ]);
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
    expect(medicalLanguageGate(input({ outputText: "You  have a fracture." })).passed).toBe(false);
    expect(
      medicalLanguageGate(input({ outputText: "You are suffering from a fracture." })).passed,
    ).toBe(false);
    expect(
      medicalLanguageGate(input({ outputText: "You  are suffering from a fracture." })).passed,
    ).toBe(false);
    expect(
      medicalLanguageGate(input({ outputText: "You are  suffering from a fracture." })).passed,
    ).toBe(false);
    expect(medicalLanguageGate(input({ outputText: "This  means fracture." })).passed).toBe(false);
    expect(medicalLanguageGate(input({ outputText: "This is fracture." })).passed).toBe(false);
    expect(
      medicalLanguageGate(input({ outputText: "You are suffering  from soreness." })).findings.map(
        ({ code }) => code,
      ),
    ).toEqual(["diagnostic_claim"]);
    expect(
      medicalLanguageGate(input({ outputText: "This is  a fracture." })).findings.map(
        ({ code }) => code,
      ),
    ).toEqual(["condition_as_fact"]);
  });

  it("exposes exact fail-closed runner outcomes and automated-message eligibility", () => {
    expect(runDeterministicSafety(input({ checkInText: "chest pain" }))).toMatchObject({
      escalationReasons: ["chest_pain"],
      gates: [],
      outcome: "escalated",
    });
    expect(runDeterministicSafety(input({ constraints: [], exercises: [] })).outcome).toBe(
      "passed",
    );
    expect(maximumAutomatedMessages(input())).toBe(0);
    expect(
      maximumAutomatedMessages(
        input({
          nudge: {
            attemptedAt: AS_OF,
            automated: false,
            concurrentAttempts: 1,
            lastAutomatedSentAt: null,
            owner: "none",
            tier: 0,
          },
        }),
      ),
    ).toBe(0);
  });

  it("keeps the reviewed deterministic gate inventory stable", () => {
    expect(deterministicGates.map(({ name }) => name)).toEqual([
      "unknown_family",
      "forbidden_movement",
      "volume_spike",
      "intensity_ceiling",
      "frequency_breach",
      "adjustment_operation_scope",
      "nudge_rate",
      "medical_language",
    ]);
  });
});
