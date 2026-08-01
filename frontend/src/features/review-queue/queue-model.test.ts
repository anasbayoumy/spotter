import type { Adjustment, ClientSummary, Programme, ProgrammeReview } from "@spotter/contracts";
import { describe, expect, it } from "vitest";

import { buildQueueItems, groupQueue } from "./queue-model";

const ids = {
  adjustment: "00000000-0000-4000-8000-000000000301",
  client: "00000000-0000-4000-8000-000000000101",
  coach: "00000000-0000-4000-8000-000000000001",
  exercise: "00000000-0000-4000-8000-000000000401",
  gate: "00000000-0000-4000-8000-000000000501",
  judge: "00000000-0000-4000-8000-000000000502",
  programme: "00000000-0000-4000-8000-000000000201",
  run: "00000000-0000-4000-8000-000000000601",
  trace: "00000000-0000-4000-8000-000000000701",
} as const;

const client: ClientSummary = {
  coachId: ids.coach,
  createdAt: "2026-08-01T00:00:00.000Z",
  dataClassification: "synthetic",
  goals: { primary: "Complete a synthetic event", secondary: [], targetDate: null },
  handle: "c_001",
  id: ids.client,
  profile: {
    ageBand: "35_44",
    equipment: ["rower"],
    sessionsPerWeek: 3,
    sex: "not_specified",
    trainingAgeMonths: 18,
  },
  status: "active",
  timezone: "Africa/Cairo",
};

function programme(overrides: Partial<Programme> = {}): Programme {
  return {
    approvedAt: null,
    approvedBy: null,
    clientId: ids.client,
    createdAt: "2026-08-02T10:00:00.000Z",
    generatedBy: ids.run,
    id: ids.programme,
    mesocycle: 1,
    payload: {
      days: [
        {
          dayIndex: 1,
          exercises: [
            {
              family: "horizontal_pull",
              id: ids.exercise,
              muscleGroups: ["back"],
              name: "Synthetic row",
              notes: null,
              reps: 8,
              restSeconds: 90,
              rpe: 7,
              sets: 4,
            },
          ],
          focus: "Aerobic power",
          scheduledDate: "2026-08-03",
        },
      ],
      summary: "Synthetic weekly programme",
    },
    reviewBand: "blocked",
    status: "queued",
    supersededBy: null,
    validFrom: null,
    version: 1,
    week: 1,
    ...overrides,
  };
}

function review(item: Programme, gatePassed = false): ProgrammeReview {
  return {
    citations: [],
    gates: [
      {
        id: ids.gate,
        name: "forbidden_movement",
        passed: gatePassed,
        rationale: gatePassed
          ? "No forbidden movement selected."
          : "Overhead pressing conflicts with a hard constraint.",
      },
    ],
    judges: [
      {
        id: ids.judge,
        judgeModel: "independent-fixture",
        name: "grounding",
        rationale: "The schedule evidence is incomplete.",
        score: 3,
      },
    ],
    model: "recorded-generator",
    programme: item,
    promptVersion: `sha256:${"a".repeat(64)}`,
    traceId: ids.trace,
  };
}

const adjustment: Adjustment = {
  appliedProgrammeId: null,
  approvedAt: null,
  approvedBy: null,
  baseProgrammeId: ids.programme,
  clientId: ids.client,
  createdAt: "2026-08-02T09:00:00.000Z",
  id: ids.adjustment,
  operations: [
    {
      exerciseId: ids.exercise,
      percent: 15,
      rationale: "Readiness is below the stored baseline.",
      type: "reduce_load",
    },
  ],
  reviewBand: "attention",
  sourceEventKey: "check-in:synthetic",
  status: "queued",
  trigger: {
    checkInId: "00000000-0000-4000-8000-000000000302",
    readiness: 2,
    type: "low_readiness",
  },
  version: 1,
};

describe("review queue model", () => {
  it("orders by risk, oldest creation time, then stable id and groups every band", () => {
    const blockedLater = programme({ id: "00000000-0000-4000-8000-000000000209" });
    const blockedEarlier = programme({
      createdAt: "2026-08-01T09:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000208",
    });
    const clear = programme({
      id: "00000000-0000-4000-8000-000000000207",
      reviewBand: "clear",
    });
    const reviews = new Map([
      [blockedLater.id, review(blockedLater)],
      [blockedEarlier.id, review(blockedEarlier)],
      [clear.id, review(clear, true)],
    ]);

    const items = buildQueueItems(
      [blockedLater, clear, blockedEarlier],
      reviews,
      [adjustment],
      [client],
    );
    expect(items.map(({ id }) => id)).toEqual([
      blockedEarlier.id,
      blockedLater.id,
      adjustment.id,
      clear.id,
    ]);
    expect(groupQueue(items)).toMatchObject({
      attention: [{ id: adjustment.id }],
      blocked: [{ id: blockedEarlier.id }, { id: blockedLater.id }],
      clear: [{ id: clear.id }],
    });
  });

  it("surfaces concrete gate, judge, and adjustment evidence without inventing client identity", () => {
    const blocked = programme();
    const attention = programme({
      id: "00000000-0000-4000-8000-000000000210",
      reviewBand: "attention",
    });
    const items = buildQueueItems(
      [blocked, attention],
      new Map([
        [blocked.id, review(blocked)],
        [attention.id, review(attention, true)],
      ]),
      [adjustment],
      [],
    );
    expect(items[0]?.clientHandle).toBe("Unknown synthetic client");
    expect(items[0]?.finding).toContain("Overhead pressing conflicts");
    expect(items.find(({ id }) => id === attention.id)?.finding).toContain("scored 3/5");
    expect(items.find(({ id }) => id === adjustment.id)?.finding).toContain(
      "Readiness is below the stored baseline",
    );
  });

  it("omits incomplete programme list records until their full review is available", () => {
    expect(buildQueueItems([programme()], new Map(), [], [client])).toEqual([]);
    expect(
      buildQueueItems(
        [programme({ reviewBand: null })],
        new Map([[ids.programme, review(programme())]]),
        [],
        [client],
      ),
    ).toEqual([]);
  });
});
