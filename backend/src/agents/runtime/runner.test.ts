import { describe, expect, it } from "vitest";

import { AccountabilityAgent } from "../accountability-agent.js";
import { AdjustmentAgent } from "../adjustment-agent.js";
import { DeterministicContextAssembler } from "../context/assemble.js";
import type { ContextRecord, ContextSourceInput, ContextTraceAttempt } from "../context/types.js";
import { AgentRuntimeError } from "../errors.js";
import type { ModelGateway, ModelGatewayResponse } from "../gateway/model-gateway.js";
import { ProgrammeAgent } from "../programme-agent.js";
import { PromptRegistry } from "../prompts/registry.js";
import type { AgentClock, AgentRunPort, AgentRunTelemetry, ContextTracePort } from "./ports.js";
import { AgentRunner } from "./runner.js";

const clientId = "00000000-0000-4000-8000-000000000101";
const goalId = "00000000-0000-4000-8000-000000000202";

function record(recordId: string, content: ContextRecord["content"]): ContextRecord {
  return {
    recordId,
    recordVersion: 1,
    source: "synthetic_fixture",
    content,
    createdAt: "2026-08-01T00:00:00.000Z",
    validFrom: "2026-07-01T00:00:00.000Z",
    validUntil: null,
    supersededBy: null,
    similarity: null,
  };
}

function context(hardDetail = "no active contraindication"): ContextSourceInput {
  return {
    clientId,
    effectiveAt: "2026-08-02T12:00:00.000Z",
    budget: 10_000,
    hardConstraints: [record("00000000-0000-4000-8000-000000000201", { hardDetail })],
    goalProfileEquipmentSchedule: [record(goalId, { goal: "synthetic race", sessionsPerWeek: 3 })],
    currentProgramme: [],
    recentSessionsAdherence: [
      record("00000000-0000-4000-8000-000000000204", { missedSessions: 1 }),
    ],
    checkInsMetrics: [],
    notes: [],
    softConstraintsOlderSummaries: [],
  };
}

const programmeOutput = {
  payload: {
    summary: "A grounded synthetic programme.",
    days: [
      {
        dayIndex: 1,
        scheduledDate: "2026-08-03",
        focus: "Aerobic intervals",
        exercises: [
          {
            id: "00000000-0000-4000-8000-000000000301",
            name: "Row intervals",
            family: "horizontal_pull",
            muscleGroups: ["back"],
            sets: 4,
            reps: 8,
            rpe: 7,
            restSeconds: 90,
            notes: null,
          },
        ],
      },
    ],
  },
  citations: [
    {
      sectionId: "ctx-02-goal-profile-equipment-schedule",
      recordIds: [goalId],
      claim: "The programme follows the synthetic schedule.",
    },
  ],
};

class FixedAgentClock implements AgentClock {
  private monotonic = 100;

  public monotonicMilliseconds(): number {
    this.monotonic += 5;
    return this.monotonic;
  }

  public now(): Date {
    return new Date("2026-08-02T12:00:00.000Z");
  }
}

class SequenceIds {
  private index = 0;
  public next(): string {
    this.index += 1;
    return `00000000-0000-4000-8000-${String(900 + this.index).padStart(12, "0")}`;
  }
}

class TraceMemory implements ContextTracePort {
  public readonly values: ContextTraceAttempt[] = [];
  public constructor(private readonly events: string[]) {}
  public create(trace: Parameters<ContextTracePort["create"]>[0]): Promise<void> {
    this.events.push("trace");
    this.values.push(trace);
    return Promise.resolve();
  }
}

class RunMemory implements AgentRunPort {
  public readonly values: AgentRunTelemetry[] = [];
  public constructor(private readonly events: string[]) {}
  public create(run: AgentRunTelemetry): Promise<void> {
    this.events.push("run");
    this.values.push(run);
    return Promise.resolve();
  }
}

class StubGateway implements ModelGateway {
  public readonly mode = "recorded" as const;
  public readonly modelId = "synthetic-generator";
  public calls = 0;
  public constructor(
    private readonly events: string[],
    private readonly response: ModelGatewayResponse | (() => Promise<ModelGatewayResponse>),
  ) {}
  public generate(): Promise<ModelGatewayResponse> {
    this.calls += 1;
    this.events.push("gateway");
    return typeof this.response === "function" ? this.response() : Promise.resolve(this.response);
  }
}

function setup(
  response: ModelGatewayResponse | (() => Promise<ModelGatewayResponse>),
  timeout = 500,
): {
  readonly events: string[];
  readonly gateway: StubGateway;
  readonly runner: AgentRunner;
  readonly runs: RunMemory;
  readonly traces: TraceMemory;
} {
  const events: string[] = [];
  const traces = new TraceMemory(events);
  const runs = new RunMemory(events);
  const gateway = new StubGateway(events, response);
  const runner = new AgentRunner(
    new DeterministicContextAssembler(),
    traces,
    runs,
    gateway,
    new PromptRegistry(),
    new FixedAgentClock(),
    new SequenceIds(),
    { timeoutMilliseconds: timeout },
  );
  return { events, gateway, runner, runs, traces };
}

describe("agent runner", () => {
  it("commits the trace before the gateway and stores structured telemetry", async () => {
    const state = setup({
      output: programmeOutput,
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0 },
    });
    const output = await new ProgrammeAgent(state.runner).generate({
      attemptKey: "programme:client:week",
      recordingKey: "programme.baseline",
      context: context(),
    });
    expect(output.payload.summary).toContain("grounded");
    expect(state.events).toEqual(["trace", "gateway", "run"]);
    expect(state.runs.values[0]).toMatchObject({ errorCode: null, output: programmeOutput });
    expect(state.runs.values[0]).not.toHaveProperty("reasoning");
  });

  it("persists an invalid-output run without exposing raw invalid output", async () => {
    const state = setup({ output: { reasoning: "not persisted", payload: {} }, usage: null });
    await expect(
      new ProgrammeAgent(state.runner).generate({
        attemptKey: "programme:invalid",
        recordingKey: "programme.invalid",
        context: context(),
      }),
    ).rejects.toMatchObject({ code: "model_output_invalid" });
    expect(state.runs.values[0]).toMatchObject({ errorCode: "model_output_invalid", output: null });
  });

  it("validates adjustment operations through the shared contract", async () => {
    const state = setup({
      output: {
        operations: [
          {
            type: "reduce_volume",
            exerciseId: "00000000-0000-4000-8000-000000000301",
            setsToRemove: 1,
            rationale: "Readiness is low.",
          },
        ],
        citations: [
          {
            sectionId: "ctx-02-goal-profile-equipment-schedule",
            recordIds: [goalId],
            claim: "The adjustment remains within the current plan.",
          },
        ],
      },
      usage: null,
    });
    await expect(
      new AdjustmentAgent(state.runner).generate({
        attemptKey: "adjustment:low-readiness",
        recordingKey: "adjustment.low-readiness",
        context: context(),
      }),
    ).resolves.toMatchObject({ operations: [{ type: "reduce_volume" }] });
  });

  it("persists overflow trace and never invokes the gateway", async () => {
    const state = setup({ output: programmeOutput, usage: null });
    await expect(
      new ProgrammeAgent(state.runner).generate({
        attemptKey: "programme:overflow",
        recordingKey: "programme.baseline",
        context: { ...context("x".repeat(3_000)), budget: 10 },
      }),
    ).rejects.toMatchObject({ code: "context_hard_constraints_exceed_budget" });
    expect(state.traces.values).toHaveLength(1);
    expect(state.gateway.calls).toBe(0);
    expect(state.runs.values).toHaveLength(0);
  });

  it("maps ignored aborts to a bounded timeout and records failure telemetry", async () => {
    const state = setup(() => new Promise(() => undefined), 5);
    await expect(
      new ProgrammeAgent(state.runner).generate({
        attemptKey: "programme:timeout",
        recordingKey: "programme.baseline",
        context: context(),
      }),
    ).rejects.toMatchObject({ code: "model_timeout", retryable: true });
    expect(state.runs.values[0]?.errorCode).toBe("model_timeout");
  });

  it("does not let accountability output select a different deterministic tier", async () => {
    const state = setup({
      output: {
        kind: "reduced_plan_offer",
        tier: 2,
        body: "A mismatched draft.",
        citations: [
          {
            sectionId: "ctx-04-recent-sessions-adherence",
            recordIds: ["00000000-0000-4000-8000-000000000204"],
            claim: "One session was missed.",
          },
        ],
      },
      usage: null,
    });
    await expect(
      new AccountabilityAgent(state.runner).generate({
        attemptKey: "accountability:tier-1",
        recordingKey: "accountability.tier-1",
        deterministicTier: 1,
        context: context(),
      }),
    ).rejects.toBeInstanceOf(AgentRuntimeError);
    expect(state.runs.values[0]?.errorCode).toBe("model_output_invalid");
  });
});
