import { describe, expect, it } from "vitest";

import { calculateCalibration } from "../calibration/cohens-kappa.js";
import { judgeInputSchema, requiredJudgeNames, type JudgeInput } from "../judges/judge.js";
import {
  RecordedCoherenceJudge,
  RecordedConsistencyJudge,
  RecordedGroundingJudge,
  RecordedInterventionJudge,
} from "../judges/recorded-judges.js";
import { assertIndependentModels, runRecordedJudges } from "../judges/run-judges.js";
import { calculateReviewBand, combineEvaluation } from "../review-band.js";
import { aggregateScorecard, type ScorecardRun } from "../scorecard/aggregate-scorecard.js";
import type { GateResult, JudgeResult, JudgeScore, SafetyEvaluation } from "../types.js";

type JudgeInputPatch = Readonly<
  Omit<Partial<JudgeInput>, "signals"> & {
    readonly signals?: Readonly<Partial<JudgeInput["signals"]>>;
  }
>;

function judgeInput(patch: JudgeInputPatch = {}): JudgeInput {
  return judgeInputSchema.parse({
    citations: ["goal"],
    claims: ["claim"],
    fixtureId: "coverage-fixture",
    intent: "programme",
    sectionIds: ["goal"],
    signals: {},
    ...patch,
  });
}

const passedSafety: SafetyEvaluation = {
  escalationReasons: [],
  gates: [],
  outcome: "passed",
};

function judgeResult(name: JudgeResult["name"], score: JudgeScore): JudgeResult {
  return {
    judgeModel: `recorded/${name}-v1`,
    name,
    rationale: `${name} score ${String(score)}`,
    rubricVersion: "v1",
    score,
  };
}

describe("recorded judge rubrics", () => {
  it("scores every grounding branch", async () => {
    const judge = new RecordedGroundingJudge();
    await expect(
      judge.evaluate(judgeInput({ signals: { fabricatedCitation: true } })),
    ).resolves.toMatchObject({ judgeModel: "recorded/grounding-v1", score: 1 });
    await expect(judge.evaluate(judgeInput({ citations: ["missing"] }))).resolves.toMatchObject({
      score: 1,
    });
    await expect(judge.evaluate(judgeInput({ citations: [] }))).resolves.toMatchObject({
      score: 1,
    });
    await expect(
      judge.evaluate(judgeInput({ signals: { unsupportedSpecifics: true } })),
    ).resolves.toMatchObject({ score: 3 });
    await expect(judge.evaluate(judgeInput())).resolves.toMatchObject({ score: 5 });
  });

  it("scores critical, multiple, single, and absent coherence issues", async () => {
    const judge = new RecordedCoherenceJudge();
    await expect(
      judge.evaluate(judgeInput({ signals: { criticalCoherenceIssue: true } })),
    ).resolves.toMatchObject({ score: 1 });
    await expect(
      judge.evaluate(judgeInput({ signals: { coherenceIssues: 2 } })),
    ).resolves.toMatchObject({ score: 2 });
    await expect(
      judge.evaluate(judgeInput({ signals: { coherenceIssues: 1 } })),
    ).resolves.toMatchObject({ score: 3 });
    await expect(judge.evaluate(judgeInput())).resolves.toMatchObject({ score: 5 });
  });

  it("scores acknowledged, unacknowledged, and absent history contradictions", async () => {
    const judge = new RecordedConsistencyJudge();
    await expect(
      judge.evaluate(judgeInput({ signals: { contradictsHistory: true } })),
    ).resolves.toMatchObject({ score: 2 });
    await expect(
      judge.evaluate(
        judgeInput({ signals: { acknowledgesChange: true, contradictsHistory: true } }),
      ),
    ).resolves.toMatchObject({ score: 4 });
    await expect(judge.evaluate(judgeInput())).resolves.toMatchObject({ score: 5 });
  });

  it("scores intervention context at all four satisfaction levels", async () => {
    const judge = new RecordedInterventionJudge();
    await expect(judge.evaluate(judgeInput())).resolves.toMatchObject({ score: 5 });
    await expect(
      judge.evaluate(judgeInput({ signals: { tierProportionate: false } })),
    ).resolves.toMatchObject({ score: 4 });
    await expect(
      judge.evaluate(
        judgeInput({
          signals: { interventionReferencesGoal: false, interventionReferencesSession: false },
        }),
      ),
    ).resolves.toMatchObject({ score: 2 });
    await expect(
      judge.evaluate(
        judgeInput({
          signals: {
            interventionReferencesGoal: false,
            interventionReferencesSession: false,
            tierProportionate: false,
          },
        }),
      ),
    ).resolves.toMatchObject({ score: 1 });
  });
});

describe("judge orchestration and model separation", () => {
  it("selects the exact required rubrics for both intents", () => {
    expect(requiredJudgeNames("accountability")).toEqual(["grounding", "intervention"]);
    expect(requiredJudgeNames("programme")).toEqual(["grounding", "coherence", "consistency"]);
    expect(requiredJudgeNames("adjustment")).toEqual(["grounding", "coherence", "consistency"]);
  });

  it("runs required judges and rejects intent mismatch or missing configuration", async () => {
    await expect(runRecordedJudges("programme", judgeInput())).resolves.toHaveLength(3);
    await expect(
      runRecordedJudges("accountability", judgeInput({ intent: "accountability" })),
    ).resolves.toHaveLength(2);
    await expect(runRecordedJudges("adjustment", judgeInput())).rejects.toThrow(/intent/u);
    await expect(runRecordedJudges("programme", judgeInput(), [])).rejects.toThrow(
      /not configured/u,
    );
  });

  it("rejects either blank identifier and equal normalized model identifiers", () => {
    expect(() => {
      assertIndependentModels("", "judge");
    }).toThrow(/non-empty/u);
    expect(() => {
      assertIndependentModels("generator", "  ");
    }).toThrow(/non-empty/u);
    expect(() => {
      assertIndependentModels(" Model-A ", "model-a");
    }).toThrow(/differ/u);
    expect(() => {
      assertIndependentModels("generator-a", "judge-b");
    }).not.toThrow();
  });
});

describe("review bands", () => {
  const clearProgrammeJudges: readonly JudgeResult[] = [
    judgeResult("grounding", 4),
    judgeResult("coherence", 5),
    judgeResult("consistency", 4),
  ];

  it("blocks either deterministic safety outcome before attention and judges", () => {
    expect(
      calculateReviewBand({ ...passedSafety, outcome: "blocked" }, [], "programme", ["reason"]),
    ).toBe("blocked");
    expect(calculateReviewBand({ ...passedSafety, outcome: "escalated" }, [], "programme")).toBe(
      "blocked",
    );
  });

  it("routes explicit attention and missing or low required judges", () => {
    expect(calculateReviewBand(passedSafety, clearProgrammeJudges, "programme", ["novel"])).toBe(
      "attention",
    );
    expect(calculateReviewBand(passedSafety, [], "programme")).toBe("attention");
    expect(
      calculateReviewBand(
        passedSafety,
        [judgeResult("grounding", 4), judgeResult("coherence", 3), judgeResult("consistency", 5)],
        "programme",
      ),
    ).toBe("attention");
  });

  it("returns clear and combines judges with safety evidence", () => {
    expect(calculateReviewBand(passedSafety, clearProgrammeJudges, "programme")).toBe("clear");
    expect(combineEvaluation(passedSafety, clearProgrammeJudges, "programme")).toEqual({
      ...passedSafety,
      judges: clearProgrammeJudges,
      reviewBand: "clear",
    });
  });
});

describe("calibration", () => {
  it("returns unavailable values for an empty calibration set", () => {
    expect(calculateCalibration([])).toMatchObject({
      exactMatchRate: null,
      kappa: null,
      sampleSize: 0,
    });
  });

  it("builds the confusion matrix and computes non-degenerate disagreement", () => {
    const result = calculateCalibration([
      { human: 1, predicted: 1 },
      { human: 1, predicted: 2 },
      { human: 2, predicted: 1 },
      { human: 5, predicted: 5 },
    ]);
    expect(result.confusionMatrix[0]).toEqual([1, 1, 0, 0, 0]);
    expect(result.confusionMatrix[1]).toEqual([1, 0, 0, 0, 0]);
    expect(result.exactMatchRate).toBe(0.5);
    expect(result.kappa).toBeCloseTo(0.2);
  });

  it("returns perfect kappa for a single-class perfect degenerate set", () => {
    expect(
      calculateCalibration([
        { human: 5, predicted: 5 },
        { human: 5, predicted: 5 },
      ]).kappa,
    ).toBe(1);
  });

  it("fails visibly if an impossible typed human label crosses the boundary", () => {
    expect(() => {
      Reflect.apply(calculateCalibration, null, [[{ human: 0, predicted: 1 }]]);
    }).toThrow(/human calibration score/u);
  });

  it("fails visibly if an impossible typed predicted label crosses the boundary", () => {
    expect(() => {
      Reflect.apply(calculateCalibration, null, [[{ human: 1, predicted: 6 }]]);
    }).toThrow(/predicted calibration score/u);
  });
});

const gate = (passed: boolean): GateResult => ({
  findings: passed ? [] : [{ code: "blocked", detail: "blocked" }],
  name: "unknown_family",
  passed,
  rationale: passed ? "passed" : "blocked",
});

const run = (patch: Readonly<Partial<ScorecardRun>> = {}): ScorecardRun => ({
  costUsd: 0.1,
  gates: [gate(true)],
  judges: [judgeResult("grounding", 5)],
  latencyMs: 100,
  mode: "recorded",
  published: true,
  reviewBand: "clear",
  wasEdited: false,
  ...patch,
});

describe("scorecard aggregation", () => {
  it("uses explicit unavailable metrics and recorded mode for an empty run", () => {
    const result = aggregateScorecard({
      calibrationKappaByJudge: {},
      generatedAt: new Date("2026-08-03T06:00:00.000Z"),
      runs: [],
    });
    expect(result).toMatchObject({
      bandAccuracy: { availability: "unavailable", sampleSize: 0, value: null },
      costPerPublishedPlanUsd: { availability: "unavailable", sampleSize: 0, value: null },
      latencyP50Ms: { availability: "unavailable", sampleSize: 0, value: null },
      latencyP95Ms: { availability: "unavailable", sampleSize: 0, value: null },
      mode: "recorded",
    });
  });

  it("aggregates every judge score and both gate outcomes in a single mode", () => {
    const result = aggregateScorecard({
      calibrationKappaByJudge: { grounding: 0 },
      generatedAt: new Date("2026-08-03T06:00:00.000Z"),
      runs: [
        run({
          judges: [
            judgeResult("grounding", 1),
            judgeResult("grounding", 2),
            judgeResult("grounding", 3),
            judgeResult("grounding", 4),
            judgeResult("grounding", 5),
          ],
          latencyMs: 300,
        }),
        run({
          gates: [gate(false)],
          latencyMs: 100,
          published: false,
          reviewBand: "attention",
          wasEdited: true,
        }),
      ],
    });
    expect(result.mode).toBe("recorded");
    expect(result.safetyPassRateByGate["unknown_family"]?.value).toBe(0.5);
    expect(result.judgeDistribution["grounding"]).toEqual([1, 1, 1, 1, 2]);
    expect(result.calibrationKappaByJudge["grounding"]).toEqual({
      availability: "available",
      sampleSize: 1,
      value: 0,
    });
    expect(result.bandAccuracy.value).toBe(1);
    expect(result.costPerPublishedPlanUsd.value).toBe(0.2);
    expect(result.latencyP50Ms.value).toBe(100);
    expect(result.latencyP95Ms.value).toBe(300);
  });

  it("marks mixed execution and measures edited clear-band accuracy", () => {
    const result = aggregateScorecard({
      calibrationKappaByJudge: {},
      generatedAt: new Date("2026-08-03T06:00:00.000Z"),
      runs: [run(), run({ mode: "live", wasEdited: true })],
    });
    expect(result.mode).toBe("mixed");
    expect(result.bandAccuracy.value).toBe(0.5);
  });
});
