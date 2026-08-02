import { describe, expect, it, vi } from "vitest";

import { AccountabilityAgent } from "../accountability-agent.js";
import { DeterministicContextAssembler } from "../context/assemble.js";
import type { ContextRecord, ContextSourceInput, ContextTraceAttempt } from "../context/types.js";
import { AgentRuntimeError } from "../errors.js";
import type {
  ModelGateway,
  ModelGatewayRequest,
  ModelGatewayResponse,
} from "../gateway/model-gateway.js";
import { PromptRegistry } from "../prompts/registry.js";
import type { AgentClock, AgentRunPort, AgentRunTelemetry, ContextTracePort } from "./ports.js";
import { AgentRunner } from "./runner.js";

function record(id: number): ContextRecord {
  return {
    recordId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    recordVersion: 1,
    source: "runtime_edge_fixture",
    content: { value: id },
    createdAt: "2026-08-01T00:00:00.000Z",
    validFrom: null,
    validUntil: null,
    supersededBy: null,
    similarity: null,
  };
}

function context(): ContextSourceInput {
  return {
    clientId: "00000000-0000-4000-8000-000000000101",
    effectiveAt: "2026-08-02T12:00:00.000Z",
    budget: 10_000,
    hardConstraints: [record(201)],
    goalProfileEquipmentSchedule: [],
    currentProgramme: [],
    recentSessionsAdherence: [record(204)],
    checkInsMetrics: [],
    notes: [],
    softConstraintsOlderSummaries: [],
  };
}

class RuntimeClock implements AgentClock {
  public constructor(private readonly monotonicValues: number[] = [100, 105]) {}

  public monotonicMilliseconds(): number {
    return this.monotonicValues.shift() ?? 0;
  }

  public now(): Date {
    return new Date("2026-08-02T12:00:00.000Z");
  }
}

class RuntimeIds {
  private index = 0;

  public next(): string {
    this.index += 1;
    return `00000000-0000-4000-8000-${String(900 + this.index).padStart(12, "0")}`;
  }
}

class TraceMemory implements ContextTracePort {
  public readonly values: ContextTraceAttempt[] = [];

  public create(trace: ContextTraceAttempt): Promise<void> {
    this.values.push(trace);
    return Promise.resolve();
  }
}

class RunMemory implements AgentRunPort {
  public readonly values: AgentRunTelemetry[] = [];

  public create(run: AgentRunTelemetry): Promise<void> {
    this.values.push(run);
    return Promise.resolve();
  }
}

class RuntimeGateway implements ModelGateway {
  public readonly mode = "live" as const;
  public readonly modelId = "runtime-edge-model";
  public readonly generate =
    vi.fn<(request: ModelGatewayRequest) => Promise<ModelGatewayResponse>>();

  public constructor(result: ModelGatewayResponse | Error) {
    if (result instanceof Error) this.generate.mockRejectedValue(result);
    else this.generate.mockResolvedValue(result);
  }
}

interface RuntimeState {
  readonly gateway: RuntimeGateway;
  readonly runner: AgentRunner;
  readonly runs: RunMemory;
  readonly traces: TraceMemory;
}

function setup(
  result: ModelGatewayResponse | Error,
  clock: AgentClock = new RuntimeClock(),
): RuntimeState {
  const gateway = new RuntimeGateway(result);
  const runs = new RunMemory();
  const traces = new TraceMemory();
  return {
    gateway,
    runs,
    traces,
    runner: new AgentRunner(
      new DeterministicContextAssembler(),
      traces,
      runs,
      gateway,
      new PromptRegistry(),
      clock,
      new RuntimeIds(),
      { timeoutMilliseconds: 500 },
    ),
  };
}

function executeIdentity(runner: AgentRunner): Promise<unknown> {
  return runner.execute(
    {
      intent: "programme",
      attemptKey: "runtime:edge",
      recordingKey: "runtime.edge",
      context: context(),
    },
    (value) => value,
  );
}

const citation = {
  sectionId: "ctx-04-recent-sessions-adherence",
  recordIds: ["00000000-0000-4000-8000-000000000204"],
  claim: "The stored adherence context supports this draft.",
};

describe("agent runtime edge cases", () => {
  it("rejects timeout values on both sides of the supported interval", () => {
    const state = setup({ output: null, usage: null });
    const dependencies = [
      new DeterministicContextAssembler(),
      state.traces,
      state.runs,
      state.gateway,
      new PromptRegistry(),
      new RuntimeClock(),
      new RuntimeIds(),
    ] as const;

    expect(() => new AgentRunner(...dependencies, { timeoutMilliseconds: 0 })).toThrowError(
      "Invalid model timeout",
    );
    expect(() => new AgentRunner(...dependencies, { timeoutMilliseconds: 120_001 })).toThrowError(
      "Invalid model timeout",
    );
    expect(() => new AgentRunner(...dependencies)).not.toThrow();
  });

  it("stops before gateway execution when durable trace creation fails", async () => {
    const gateway = new RuntimeGateway({ output: null, usage: null });
    const traceFailure = new Error("trace persistence failed");
    const traces: ContextTracePort = { create: vi.fn().mockRejectedValue(traceFailure) };
    const runs = new RunMemory();
    const runner = new AgentRunner(
      new DeterministicContextAssembler(),
      traces,
      runs,
      gateway,
      new PromptRegistry(),
      new RuntimeClock(),
      new RuntimeIds(),
    );

    await expect(executeIdentity(runner)).rejects.toBe(traceFailure);
    expect(gateway.generate).not.toHaveBeenCalled();
    expect(runs.values).toHaveLength(0);
  });

  it("maps an unknown gateway failure and clamps negative latency", async () => {
    const state = setup(new Error("provider socket failed"), new RuntimeClock([100, 90]));

    await expect(executeIdentity(state.runner)).rejects.toMatchObject({
      code: "dependency_unavailable",
      retryable: true,
    });
    expect(state.runs.values[0]).toMatchObject({
      errorCode: "dependency_unavailable",
      latencyMs: 0,
      output: null,
      usage: null,
    });
  });

  it("maps a gateway AbortError to timeout telemetry", async () => {
    const state = setup(new DOMException("provider aborted", "AbortError"));

    await expect(executeIdentity(state.runner)).rejects.toMatchObject({
      code: "model_timeout",
      retryable: true,
    });
    expect(state.runs.values[0]?.errorCode).toBe("model_timeout");
  });

  it("preserves a typed gateway failure without changing retryability", async () => {
    const failure = new AgentRuntimeError("recording_not_found", "missing fixture", false);
    const state = setup(failure);

    await expect(executeIdentity(state.runner)).rejects.toBe(failure);
    expect(state.runs.values[0]?.errorCode).toBe("recording_not_found");
  });

  it.each([
    [1, "client_nudge"],
    [2, "reduced_plan_offer"],
    [3, "coach_context_brief"],
  ] as const)("accepts the deterministic tier %i accountability kind", async (tier, kind) => {
    const output = { kind, tier, body: `Tier ${String(tier)} draft`, citations: [citation] };
    const state = setup({ output, usage: null });

    await expect(
      new AccountabilityAgent(state.runner).generate({
        attemptKey: `accountability:tier-${String(tier)}`,
        recordingKey: `accountability.tier-${String(tier)}`,
        deterministicTier: tier,
        context: context(),
      }),
    ).resolves.toEqual(output);
    expect(state.runs.values[0]?.output).toEqual(output);
  });

  it("rejects malformed and wrong-kind accountability drafts", async () => {
    const malformed = setup({ output: { tier: 1 }, usage: null });
    await expect(
      new AccountabilityAgent(malformed.runner).generate({
        attemptKey: "accountability:malformed",
        recordingKey: "accountability.malformed",
        deterministicTier: 1,
        context: context(),
      }),
    ).rejects.toMatchObject({ code: "model_output_invalid" });

    const wrongKind = setup({
      output: { kind: "reduced_plan_offer", tier: 1, body: "Wrong kind", citations: [citation] },
      usage: null,
    });
    await expect(
      new AccountabilityAgent(wrongKind.runner).generate({
        attemptKey: "accountability:wrong-kind",
        recordingKey: "accountability.wrong-kind",
        deterministicTier: 1,
        context: context(),
      }),
    ).rejects.toMatchObject({ code: "model_output_invalid" });
  });
});
