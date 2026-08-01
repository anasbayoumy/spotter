import { describe, expect, it, vi } from "vitest";

vi.mock("../safety/gates/gates.js", () => ({
  deterministicGates: [
    {
      name: "unknown_family",
      run: () => {
        throw new Error("simulated deterministic gate failure");
      },
    },
  ],
}));

import { maximumAutomatedMessages, runDeterministicSafety } from "../safety/run-gates.js";

const input = {
  adherence14d: null,
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
  intent: "programme",
  nudge: null,
  outputText: "Safe proposal.",
  plannedSessions: 3,
  volumeChanges: [],
};

describe("deterministic safety runner fail-closed behavior", () => {
  it("converts a thrown deterministic gate into a blocking finding", () => {
    expect(runDeterministicSafety(input)).toEqual({
      escalationReasons: [],
      gates: [
        {
          findings: [
            {
              code: "gate_evaluation_error",
              detail: "unknown_family could not complete and failed closed.",
            },
          ],
          name: "unknown_family",
          passed: false,
          rationale: "unknown_family failed closed because evaluation did not complete.",
        },
      ],
      outcome: "blocked",
    });
  });

  it("returns zero when no nudge-rate gate is configured", () => {
    expect(
      maximumAutomatedMessages({
        ...input,
        intent: "accountability",
        nudge: {
          attemptedAt: input.asOf,
          automated: true,
          concurrentAttempts: 1,
          lastAutomatedSentAt: null,
          owner: "automation",
          tier: 1,
        },
      }),
    ).toBe(0);
  });
});
