import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { calculateCalibration } from "../calibration/cohens-kappa.js";
import {
  evaluateGoldenFixture,
  evaluatePinnedContextBudget,
  goldenManifestSchema,
} from "../golden-fixture.js";
import { assertIndependentModels } from "../judges/run-judges.js";
import { resolveMovementFamily } from "../safety/movement-taxonomy.js";
import { maximumAutomatedMessages, runDeterministicSafety } from "../safety/run-gates.js";
import { aggregateScorecard } from "../scorecard/aggregate-scorecard.js";
import type { GateResult, JudgeResult } from "../types.js";

const manifestUrl = new URL("../../../../fixtures/golden/safety/manifest.json", import.meta.url);
const rawManifest: unknown = JSON.parse(await readFile(manifestUrl, "utf8"));
const manifest = goldenManifestSchema.parse(rawManifest);

describe("canonical safety golden set", () => {
  it("contains exactly the canonical sequential QA-SAF-001 through QA-SAF-050 IDs", () => {
    expect(manifest.cases).toHaveLength(50);
    expect(manifest.cases.map(({ id }) => id)).toEqual(
      Array.from({ length: 50 }, (_, index) => `QA-SAF-${String(index + 1).padStart(3, "0")}`),
    );
    expect(new Set(manifest.cases.map(({ id }) => id)).size).toBe(50);
  });

  it.each(manifest.cases)("$id: $description", async (fixture) => {
    const actual = await evaluateGoldenFixture(fixture);

    expect(actual.outcome).toBe(fixture.expected.outcome);
    if (fixture.expected.band !== undefined) expect(actual.band).toBe(fixture.expected.band);
    if (fixture.expected.gate !== undefined) expect(actual.blockedGate).toBe(fixture.expected.gate);
    if (fixture.expected.tier !== undefined) expect(actual.tier).toBe(fixture.expected.tier);
    if (fixture.expected.maxMessages !== undefined)
      expect(actual.maxMessages).toBe(fixture.expected.maxMessages);
    if (fixture.expected.selectedRecordIds !== undefined)
      expect(actual.selectedRecordIds).toEqual(fixture.expected.selectedRecordIds);
    if (fixture.expected.budgetOutcome !== undefined)
      expect(actual.budget?.outcome).toBe(fixture.expected.budgetOutcome);
    if (fixture.expected.selectedOptionalSections !== undefined)
      expect(actual.budget?.selectedOptionalSections).toEqual(
        fixture.expected.selectedOptionalSections,
      );
  });
});

const safeInput = {
  adherence14d: 0.8,
  adjustment: null,
  allowedSessions: 3,
  asOf: new Date("2026-08-03T06:00:00.000Z"),
  checkInText: "",
  constraints: [],
  exercises: [
    {
      family: "horizontal_pull",
      id: "safe",
      muscleGroups: ["back"],
      name: "Cable row",
      rpe: 7,
      sets: 3,
    },
  ],
  intent: "programme" as const,
  nudge: null,
  outputText: "Safe proposal.",
  plannedSessions: 3,
  volumeChanges: [],
};

describe("safety properties and exact boundaries", () => {
  it("fails closed for every normalized unknown-family spelling", () => {
    for (const family of ["unknown", " Unknown ", "UNKNOWN!!!", "not-a-real-family"]) {
      const evaluation = runDeterministicSafety({
        ...safeInput,
        exercises: [{ ...safeInput.exercises[0], family }],
      });
      expect(evaluation.outcome).toBe("blocked");
      expect(evaluation.gates.find(({ name }) => name === "unknown_family")?.passed).toBe(false);
    }
  });

  it("normalizes every critical overhead alias to one family", () => {
    for (const alias of ["overhead_press", "Push Press", "snatch", "handstand-push-up"]) {
      expect(resolveMovementFamily(alias)).toBe("overhead_press");
    }
  });

  it("pins hard constraints and never evicts them as budget shrinks", () => {
    for (const budget of [1000, 999, 1]) {
      const result = evaluatePinnedContextBudget({
        budget,
        hardConstraintTokens: 1000,
        optionalSections: [{ id: "optional", tokens: 1 }],
      });
      expect(result.outcome).toBe(budget === 1000 ? "proceed" : "failed");
      expect(result.selectedOptionalSections).toEqual([]);
    }
  });

  it("blocks prohibited V1 auto-application and increasing operations", () => {
    const evaluation = runDeterministicSafety({
      ...safeInput,
      adjustment: {
        autoApply: true,
        operations: [{ direction: "increase", percent: 10, type: "reduce_load" }],
      },
    });
    const gate = evaluation.gates.find(({ name }) => name === "adjustment_operation_scope");
    expect(gate?.passed).toBe(false);
    expect(gate?.findings.map(({ code }) => code)).toEqual([
      "v1_auto_apply_prohibited",
      "invalid_load_reduction",
    ]);
  });

  it("keeps the automated-message result capped at one under concurrent attempts", () => {
    for (const concurrentAttempts of [1, 2, 20, 1000]) {
      expect(
        maximumAutomatedMessages({
          ...safeInput,
          intent: "accountability",
          nudge: {
            attemptedAt: safeInput.asOf,
            automated: true,
            concurrentAttempts,
            lastAutomatedSentAt: null,
            owner: "automation",
            tier: 1,
          },
        }),
      ).toBe(1);
    }
  });

  it("rejects malformed safety input instead of silently allowing it", () => {
    expect(() =>
      runDeterministicSafety({ ...safeInput, exercises: [{ id: "incomplete" }] }),
    ).toThrow();
  });
});

describe("independent judging, calibration, and scorecard reporting", () => {
  it("requires generator and judge model independence", () => {
    expect(() => {
      assertIndependentModels("model-a", "MODEL-A");
    }).toThrow(/differ/u);
    expect(() => {
      assertIndependentModels("model-a", "judge-b");
    }).not.toThrow();
  });

  it("computes Cohen's kappa including empty and perfect calibration sets", () => {
    expect(calculateCalibration([])).toEqual({
      confusionMatrix: [
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ],
      exactMatchRate: null,
      kappa: null,
      sampleSize: 0,
    });
    expect(
      calculateCalibration([
        { human: 1, predicted: 1 },
        { human: 2, predicted: 2 },
        { human: 5, predicted: 5 },
      ]).kappa,
    ).toBe(1);
  });

  it("aggregates gate rates, distributions, latency, accuracy, cost, and mode", () => {
    const gate: GateResult = {
      findings: [],
      name: "unknown_family",
      passed: true,
      rationale: "passed",
    };
    const judge: JudgeResult = {
      judgeModel: "recorded/grounding-v1",
      name: "grounding",
      rationale: "grounded",
      rubricVersion: "v1",
      score: 5,
    };
    const scorecard = aggregateScorecard({
      calibrationKappaByJudge: { grounding: 0.8 },
      generatedAt: new Date("2026-08-03T06:00:00.000Z"),
      runs: [
        {
          costUsd: 0.2,
          gates: [gate],
          judges: [judge],
          latencyMs: 100,
          mode: "recorded",
          published: true,
          reviewBand: "clear",
          wasEdited: false,
        },
        {
          costUsd: 0.3,
          gates: [{ ...gate, findings: [{ code: "x", detail: "x" }], passed: false }],
          judges: [{ ...judge, score: 3 }],
          latencyMs: 300,
          mode: "live",
          published: false,
          reviewBand: "attention",
          wasEdited: true,
        },
      ],
    });
    expect(scorecard.mode).toBe("mixed");
    expect(scorecard.safetyPassRateByGate["unknown_family"]?.value).toBe(0.5);
    expect(scorecard.judgeDistribution["grounding"]).toEqual([0, 0, 1, 0, 1]);
    expect(scorecard.latencyP50Ms.value).toBe(100);
    expect(scorecard.latencyP95Ms.value).toBe(300);
    expect(scorecard.bandAccuracy.value).toBe(1);
    expect(scorecard.costPerPublishedPlanUsd.value).toBe(0.5);
  });
});
