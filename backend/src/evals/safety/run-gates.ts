import type { GateResult, SafetyEvaluation } from "../types.js";
import { safetyInputSchema } from "./contracts.js";
import { deterministicGates } from "./gates/gates.js";
import { detectRedFlags } from "./red-flags.js";

export function runDeterministicSafety(rawInput: unknown): SafetyEvaluation {
  const input = safetyInputSchema.parse(rawInput);
  const escalationReasons = detectRedFlags(input.checkInText);
  if (escalationReasons.length > 0) {
    return { escalationReasons, gates: [], outcome: "escalated" };
  }

  const gates = deterministicGates.map(({ name, run }): GateResult => {
    try {
      return run(input);
    } catch {
      return {
        findings: [
          {
            code: "gate_evaluation_error",
            detail: `${name} could not complete and failed closed.`,
          },
        ],
        name,
        passed: false,
        rationale: `${name} failed closed because evaluation did not complete.`,
      };
    }
  });
  return {
    escalationReasons: [],
    gates,
    outcome: gates.every((gate) => gate.passed) ? "passed" : "blocked",
  };
}

export function maximumAutomatedMessages(rawInput: unknown): 0 | 1 {
  const input = safetyInputSchema.parse(rawInput);
  if (!input.nudge?.automated) return 0;
  const nudgeGate = deterministicGates.find(({ name }) => name === "nudge_rate");
  if (nudgeGate === undefined) return 0;
  return nudgeGate.run(input).passed ? 1 : 0;
}
