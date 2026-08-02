import { describe, expect, it } from "vitest";

import { safetyConstraintSchema, safetyInputSchema } from "../safety/contracts.js";
import {
  adjustmentOperationScopeGate,
  frequencyBreachGate,
  medicalLanguageGate,
} from "../safety/gates/gates.js";
import { detectRedFlags } from "../safety/red-flags.js";

describe("safety blocker mutation audit", () => {
  it("defaults an omitted forbidden-family list to an empty list", () => {
    expect(
      safetyConstraintSchema.parse({
        id: "constraint-1",
        kind: "injury",
        severity: "hard",
        validFrom: new Date("2026-08-02T12:00:00.000Z"),
      }).forbids,
    ).toEqual([]);
  });

  it("blocks a swap missing only its equivalence proof", () => {
    const input = safetyInputSchema.parse({
      adjustment: {
        autoApply: false,
        operations: [{ replacementFamily: "hinge", type: "swap_exercise" }],
      },
      asOf: new Date("2026-08-02T12:00:00.000Z"),
      intent: "adjustment",
    });

    expect(adjustmentOperationScopeGate(input).findings).toEqual([
      {
        code: "undocumented_exercise_swap",
        detail: "Operation 0 lacks a documented known equivalent.",
      },
    ]);
  });

  it("retains exact frequency evidence", () => {
    const input = safetyInputSchema.parse({
      allowedSessions: 2,
      asOf: new Date("2026-08-02T12:00:00.000Z"),
      intent: "programme",
      plannedSessions: 3,
    });
    expect(frequencyBreachGate(input).findings).toEqual([
      {
        code: "schedule_frequency_exceeded",
        detail: "3 planned sessions exceed the 2 session limit.",
      },
    ]);
  });

  it("retains exact invalid-volume-reduction evidence", () => {
    const input = safetyInputSchema.parse({
      adjustment: {
        autoApply: false,
        operations: [{ direction: "decrease", setsToRemove: 0, type: "reduce_volume" }],
      },
      asOf: new Date("2026-08-02T12:00:00.000Z"),
      intent: "adjustment",
    });
    expect(adjustmentOperationScopeGate(input).findings).toEqual([
      {
        code: "invalid_volume_reduction",
        detail: "Operation 0 is not a valid volume reduction.",
      },
    ]);
  });

  it("detects red-flag chest symptoms across repeated whitespace", () => {
    expect(detectRedFlags("Sudden chest   pressure during training.")).toEqual(["chest_pain"]);
  });

  it("retains exact prohibited medical-language evidence", () => {
    const input = safetyInputSchema.parse({
      asOf: new Date("2026-08-02T12:00:00.000Z"),
      intent: "accountability",
      outputText: "You have a fracture.",
    });

    expect(medicalLanguageGate(input).findings).toEqual([
      {
        code: "diagnostic_claim",
        detail: "Output contains prohibited diagnostic or medication language.",
      },
    ]);
  });
});
