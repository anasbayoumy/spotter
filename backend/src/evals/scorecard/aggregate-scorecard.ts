import type { Scorecard } from "@spotter/contracts";

import type { GateResult, JudgeResult, JudgeName, ReviewBand } from "../types";

export interface ScorecardRun {
  readonly costUsd: number;
  readonly gates: readonly GateResult[];
  readonly judges: readonly JudgeResult[];
  readonly latencyMs: number;
  readonly mode: "live" | "recorded";
  readonly published: boolean;
  readonly reviewBand: ReviewBand;
  readonly schemaFailure?: boolean;
  readonly schemaRetryCount?: number;
  readonly wasEdited: boolean;
}

export interface ScorecardInput {
  readonly calibrationKappaByJudge: Readonly<Partial<Record<JudgeName, number>>>;
  readonly generatedAt: Date;
  readonly runs: readonly ScorecardRun[];
}

const unavailable = (): Readonly<{ availability: "unavailable"; sampleSize: 0; value: null }> => ({
  availability: "unavailable",
  sampleSize: 0,
  value: null,
});

function measured(value: number | null, sampleSize: number): Scorecard["bandAccuracy"] {
  return value === null ? unavailable() : { availability: "available", sampleSize, value };
}

function percentile(values: readonly number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[rank] ?? null;
}

export function aggregateScorecard(input: ScorecardInput): Scorecard {
  const gateNames = new Set(input.runs.flatMap((run) => run.gates.map((gate) => gate.name)));
  const safetyPassRateByGate = Object.fromEntries(
    [...gateNames].sort().map((name) => {
      const results = input.runs.flatMap((run) => run.gates.filter((gate) => gate.name === name));
      return [
        name,
        measured(results.filter((gate) => gate.passed).length / results.length, results.length),
      ];
    }),
  );
  const judgeNames = new Set(input.runs.flatMap((run) => run.judges.map((judge) => judge.name)));
  const judgeDistribution = Object.fromEntries(
    [...judgeNames].sort().map((name) => {
      const counts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const judge of input.runs.flatMap((run) =>
        run.judges.filter((item) => item.name === name),
      )) {
        counts[judge.score] += 1;
      }
      return [name, [counts[1], counts[2], counts[3], counts[4], counts[5]]];
    }),
  );
  const calibrationKappaByJudge = Object.fromEntries(
    Object.entries(input.calibrationKappaByJudge).map(([name, value]) => [
      name,
      measured(value, 1),
    ]),
  );
  const clearRuns = input.runs.filter((run) => run.reviewBand === "clear");
  const published = input.runs.filter((run) => run.published);
  const modes = new Set(input.runs.map((run) => run.mode));
  const mode: Scorecard["mode"] = modes.size > 1 ? "mixed" : (input.runs[0]?.mode ?? "recorded");
  const latencies = input.runs.map((run) => run.latencyMs);
  const schemaFailures = input.runs.filter((run) => run.schemaFailure === true).length;
  const schemaRetryCount = input.runs.reduce(
    (total, run) => total + (run.schemaRetryCount ?? 0),
    0,
  );

  return {
    bandAccuracy: measured(
      clearRuns.length === 0
        ? null
        : clearRuns.filter((run) => !run.wasEdited).length / clearRuns.length,
      clearRuns.length,
    ),
    calibrationKappaByJudge,
    costPerPublishedPlanUsd: measured(
      published.length === 0
        ? null
        : input.runs.reduce((sum, run) => sum + run.costUsd, 0) / published.length,
      published.length,
    ),
    generatedAt: input.generatedAt.toISOString(),
    judgeDistribution,
    latencyP50Ms: measured(percentile(latencies, 0.5), latencies.length),
    latencyP95Ms: measured(percentile(latencies, 0.95), latencies.length),
    mode,
    safetyPassRateByGate,
    schemaFailureRate: measured(
      input.runs.length === 0 ? null : schemaFailures / input.runs.length,
      input.runs.length,
    ),
    schemaRetryCount: measured(
      input.runs.length === 0 ? null : schemaRetryCount,
      input.runs.length,
    ),
  };
}
