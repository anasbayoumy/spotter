import {
  accountabilityDetailSchema,
  contextTraceSchema,
  type AccountabilityModelOutput,
  type AccountabilityTier,
  type EngagementInputs,
  type GateResult,
  type JudgeResult,
} from "@spotter/contracts";
import { describe, expect, it, vi } from "vitest";

import { AccountabilityState } from "../domain/index.js";
import { RunAccountabilityForClient } from "./accountability.js";
import { type ExecutionContext, type FingerprintPort, type IdempotencyPort } from "./core.js";
import type {
  AccountabilityPort,
  AgentAuditPort,
  ContextAssemblerPort,
  EvaluationPort,
  ModelGatewayPort,
  TracePort,
} from "./ports.js";
import type { AccountabilityDetail, InAppMessage } from "./read-models.js";

const ids = {
  client: "00000000-0000-4000-8000-000000000401",
  coach: "00000000-0000-4000-8000-000000000402",
  run: "00000000-0000-4000-8000-000000000403",
  trace: "00000000-0000-4000-8000-000000000404",
  turn: "00000000-0000-4000-8000-000000000405",
  gate: "00000000-0000-4000-8000-000000000406",
  judge: "00000000-0000-4000-8000-000000000407",
  message1: "00000000-0000-4000-8000-000000000408",
  message2: "00000000-0000-4000-8000-000000000409",
  message3: "00000000-0000-4000-8000-000000000410",
  message4: "00000000-0000-4000-8000-000000000411",
  message5: "00000000-0000-4000-8000-000000000412",
} as const;
const now = new Date("2026-08-02T12:00:00.000Z");
const context: ExecutionContext = {
  requestId: "accountability-coverage",
  actorId: ids.coach,
  effectiveAt: now,
  idempotencyKey: "accountability:coverage:001",
};
const trace = contextTraceSchema.parse({
  id: ids.trace,
  clientId: ids.client,
  turnId: ids.turn,
  intent: "accountability",
  sections: [],
  rendered: "synthetic accountability context",
  tokenCount: 10,
  budget: 1_000,
  createdAt: now.toISOString(),
});
const passingGate: GateResult = {
  id: ids.gate,
  name: "medical_language",
  passed: true,
  rationale: "Safe",
};
const blockingGate: GateResult = { ...passingGate, passed: false };
const judge: JudgeResult = {
  id: ids.judge,
  name: "intervention",
  score: 5,
  rationale: "Appropriate",
  judgeModel: "recorded-judge",
};
const baseInputs: EngagementInputs = {
  plannedDue7d: 2,
  completedDue7d: 2,
  plannedDue14d: 2,
  completedDue14d: 2,
  missedDue7d: 0,
  missedDue14d: 0,
  currentCheckInLatencyHours: null,
  baselineCheckInLatencyHours: null,
  baselineCheckInCount: 0,
  daysSinceOpen: 1,
  rpeDrift: null,
};
const inputsByTier: Record<AccountabilityTier, EngagementInputs> = {
  0: baseInputs,
  1: { ...baseInputs, missedDue7d: 1, missedDue14d: 1 },
  2: { ...baseInputs, missedDue14d: 2 },
  3: { ...baseInputs, daysSinceOpen: 7 },
  4: { ...baseInputs, daysSinceOpen: 21 },
};

function message(id: string, overrides: Partial<InAppMessage> = {}): InAppMessage {
  return {
    id,
    clientId: ids.client,
    tier: 1,
    actor: "agent",
    status: "sent",
    body: "Synthetic message",
    createdAt: now.toISOString(),
    sentAt: new Date(now.valueOf() - 72 * 60 * 60 * 1_000).toISOString(),
    suppressedAt: null,
    suppressionReason: null,
    ...overrides,
  };
}

function current(
  tier: AccountabilityTier = 0,
  messages: readonly InAppMessage[] = [],
): AccountabilityDetail {
  const coachOwned = tier >= 3;
  return accountabilityDetailSchema.parse({
    state: {
      clientId: ids.client,
      tier,
      owner: coachOwned ? "coach" : tier === 0 ? "none" : "automation",
      lastTransitionAt: now.toISOString(),
      automationPaused: coachOwned,
      churnFlagged: tier === 4,
      version: 1,
    },
    latestScore: null,
    messages,
  });
}

function output(tier: 1 | 2 | 3): AccountabilityModelOutput {
  return {
    kind: tier === 1 ? "client_nudge" : tier === 2 ? "reduced_plan_offer" : "coach_context_brief",
    tier,
    body: `Tier ${String(tier)} synthetic guidance`,
    citations: [{ sectionId: "profile", recordIds: [ids.client], claim: "Uses schedule" }],
  };
}

interface TestOverrides {
  readonly assemblyStatus?: "hard_constraint_overflow" | "ready";
  readonly current?: AccountabilityDetail | undefined;
  readonly inputs?: EngagementInputs;
  readonly gatewayOutput?: unknown;
  readonly gates?: readonly GateResult[];
  readonly gatewayFailure?: Error;
}

interface AccountabilitySetup {
  readonly assemble: ReturnType<typeof vi.fn<ContextAssemblerPort["assemble"]>>;
  readonly useCase: RunAccountabilityForClient;
  readonly claims: readonly {
    readonly scope: string;
    readonly actorId: string;
    readonly key: string;
    readonly requestFingerprint: string;
  }[];
  readonly commitDecision: ReturnType<typeof vi.fn<AccountabilityPort["commitDecision"]>>;
  readonly draftAccountability: ReturnType<typeof vi.fn<ModelGatewayPort["draftAccountability"]>>;
  readonly recordSuccess: ReturnType<typeof vi.fn<AgentAuditPort["recordSuccess"]>>;
  readonly recordFailure: ReturnType<typeof vi.fn<AgentAuditPort["recordFailure"]>>;
  readonly runGates: ReturnType<typeof vi.fn<EvaluationPort["runGates"]>>;
  readonly runJudges: ReturnType<typeof vi.fn<EvaluationPort["runJudges"]>>;
}

function dependencies(overrides: TestOverrides = {}): AccountabilitySetup {
  const claims: {
    readonly scope: string;
    readonly actorId: string;
    readonly key: string;
    readonly requestFingerprint: string;
  }[] = [];
  const commitDecision = vi.fn<AccountabilityPort["commitDecision"]>().mockImplementation((input) =>
    Promise.resolve(
      accountabilityDetailSchema.parse({
        state: {
          clientId: input.clientId,
          tier: input.nextState.tier,
          owner: input.nextState.owner,
          lastTransitionAt: input.context.effectiveAt.toISOString(),
          automationPaused: input.nextState.automationPaused,
          churnFlagged: input.nextState.churnFlagged,
          version: input.nextState.version,
        },
        latestScore: null,
        messages: [],
      }),
    ),
  );
  const accountability: AccountabilityPort = {
    get: () => Promise.resolve(overrides.current ?? current()),
    loadInputs: () => Promise.resolve(overrides.inputs ?? inputsByTier[1]),
    commitDecision,
  };
  const assemble = vi
    .fn<ContextAssemblerPort["assemble"]>()
    .mockResolvedValue({ status: overrides.assemblyStatus ?? "ready", trace });
  const assembler: ContextAssemblerPort = { assemble };
  const traces: TracePort = {
    persistBeforeModel: () => Promise.resolve(),
    get: () => Promise.resolve(trace),
  };
  const draftAccountability = vi
    .fn<ModelGatewayPort["draftAccountability"]>()
    .mockImplementation((_trace, tier) => {
      if (overrides.gatewayFailure !== undefined) return Promise.reject(overrides.gatewayFailure);
      return Promise.resolve(
        (overrides.gatewayOutput ?? output(tier)) as AccountabilityModelOutput,
      );
    });
  const gateway: ModelGatewayPort = {
    generateProgramme: () => Promise.reject(new Error("unused")),
    generateAdjustment: () => Promise.reject(new Error("unused")),
    draftAccountability,
  };
  const runGates = vi
    .fn<EvaluationPort["runGates"]>()
    .mockResolvedValue(overrides.gates ?? [passingGate]);
  const runJudges = vi.fn<EvaluationPort["runJudges"]>().mockResolvedValue([judge]);
  const evaluation: EvaluationPort = { runGates, runJudges };
  const recordSuccess = vi.fn<AgentAuditPort["recordSuccess"]>().mockResolvedValue(ids.run);
  const recordFailure = vi.fn<AgentAuditPort["recordFailure"]>().mockResolvedValue(undefined);
  const audit: AgentAuditPort = { recordSuccess, recordFailure };
  const idempotency: IdempotencyPort = {
    claim: (input) => {
      claims.push(input);
      return Promise.resolve({ kind: "claimed", recordId: ids.run });
    },
    complete: () => Promise.resolve(),
    fail: () => Promise.resolve(),
  };
  const fingerprint: FingerprintPort = { fingerprint: (value) => JSON.stringify(value) };
  return {
    useCase: new RunAccountabilityForClient({
      accountability,
      assembler,
      traces,
      gateway,
      evaluation,
      audit,
      idempotency,
      fingerprint,
    }),
    assemble,
    commitDecision,
    draftAccountability,
    recordSuccess,
    recordFailure,
    claims,
    runGates,
    runJudges,
  };
}

describe("critical accountability orchestration", () => {
  it("releases an automation-owned tier to no owner when engagement recovers", () => {
    const recovered = new AccountabilityState({
      tier: 1,
      owner: "automation",
      automationPaused: false,
      churnFlagged: false,
      version: 2,
    }).transition(0);
    expect(recovered.snapshot()).toEqual({
      tier: 0,
      owner: "none",
      automationPaused: false,
      churnFlagged: false,
      version: 3,
    });
  });

  it("fails when the client state does not exist", async () => {
    const setup = dependencies();
    const accountability: AccountabilityPort = {
      get: () => Promise.resolve(undefined),
      loadInputs: () => Promise.resolve(baseInputs),
      commitDecision: setup.commitDecision,
    };
    const idempotency: IdempotencyPort = {
      claim: () => Promise.resolve({ kind: "claimed", recordId: ids.run }),
      complete: () => Promise.resolve(),
      fail: () => Promise.resolve(),
    };
    const useCase = new RunAccountabilityForClient({
      accountability,
      assembler: { assemble: () => Promise.resolve({ status: "ready", trace }) },
      traces: { persistBeforeModel: () => Promise.resolve(), get: () => Promise.resolve(trace) },
      gateway: {
        generateProgramme: () => Promise.reject(new Error("unused")),
        generateAdjustment: () => Promise.reject(new Error("unused")),
        draftAccountability: () => Promise.resolve(output(1)),
      },
      evaluation: { runGates: () => Promise.resolve([]), runJudges: () => Promise.resolve([]) },
      audit: {
        recordSuccess: () => Promise.resolve(ids.run),
        recordFailure: () => Promise.resolve(),
      },
      idempotency,
      fingerprint: { fingerprint: (value) => JSON.stringify(value) },
    });
    await expect(useCase.execute(ids.client, context)).rejects.toMatchObject({
      code: "client_not_found",
      message: "Client does not exist.",
    });
  });

  it.each([0, 4] as const)("commits tier %s without model work", async (tier) => {
    const setup = dependencies({ inputs: inputsByTier[tier] });
    await setup.useCase.execute(ids.client, context);
    expect(setup.draftAccountability).not.toHaveBeenCalled();
    expect(setup.commitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        tier,
        draftedContent: null,
        automatedSendAllowed: false,
        traceId: null,
        runId: null,
      }),
    );
  });

  it.each([1, 2, 3] as const)("drafts, evaluates, audits, and commits tier %s", async (tier) => {
    const setup = dependencies({ inputs: inputsByTier[tier] });
    await setup.useCase.execute(ids.client, context);
    expect(setup.recordSuccess).toHaveBeenCalled();
    expect(setup.assemble).toHaveBeenCalledWith({
      kind: "accountability",
      clientId: ids.client,
      effectiveAt: now,
    });
    expect(setup.runGates).toHaveBeenCalledWith("accountability", trace, output(tier));
    expect(setup.runJudges).toHaveBeenCalledWith("accountability", trace, output(tier));
    expect(setup.commitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        tier,
        draftedContent: `Tier ${String(tier)} synthetic guidance`,
        automatedSendAllowed: tier === 1,
        traceId: ids.trace,
        runId: ids.run,
      }),
    );
    expect(setup.claims).toEqual([
      {
        scope: "accountability.run",
        actorId: ids.coach,
        key: context.idempotencyKey,
        requestFingerprint: JSON.stringify({
          clientId: ids.client,
          effectiveAt: now.toISOString(),
        }),
      },
    ]);
  });

  it("fails closed with stable evidence when hard constraints exceed the context budget", async () => {
    const setup = dependencies({ assemblyStatus: "hard_constraint_overflow" });
    await expect(setup.useCase.execute(ids.client, context)).rejects.toMatchObject({
      code: "context_hard_constraints_exceed_budget",
      message: "Active hard constraints exceed the context budget.",
    });
    expect(setup.draftAccountability).not.toHaveBeenCalled();
  });

  it("selects the latest eligible sent-agent message and enforces the exact 48-hour window", async () => {
    const messages = [
      message(ids.message1, { actor: "coach" }),
      message(ids.message2, { status: "drafted" }),
      message(ids.message3, { sentAt: null }),
      message(ids.message4, {
        sentAt: new Date(now.valueOf() - 96 * 60 * 60 * 1_000).toISOString(),
      }),
      message(ids.message5, {
        sentAt: new Date(now.valueOf() - 48 * 60 * 60 * 1_000).toISOString(),
      }),
    ];
    const setup = dependencies({ current: current(0, messages), inputs: inputsByTier[1] });
    await setup.useCase.execute(ids.client, context);
    expect(setup.commitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ automatedSendAllowed: true }),
    );
  });

  it("suppresses a nudge within 48 hours", async () => {
    const recent = message(ids.message1, {
      sentAt: new Date(now.valueOf() - 47 * 60 * 60 * 1_000).toISOString(),
    });
    const setup = dependencies({ current: current(0, [recent]), inputs: inputsByTier[1] });
    await setup.useCase.execute(ids.client, context);
    expect(setup.commitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ automatedSendAllowed: false }),
    );
  });

  it("ignores recent non-agent and unsent messages but sorts eligible sends newest first", async () => {
    const ignoredRecentCoach = message(ids.message1, {
      actor: "coach",
      sentAt: new Date(now.valueOf() - 60 * 60 * 1_000).toISOString(),
    });
    const ignoredRecentDraft = message(ids.message2, {
      status: "drafted",
      sentAt: new Date(now.valueOf() - 2 * 60 * 60 * 1_000).toISOString(),
    });
    const eligibleOld = message(ids.message3, {
      sentAt: new Date(now.valueOf() - 72 * 60 * 60 * 1_000).toISOString(),
    });
    const eligibleRecent = message(ids.message4, {
      sentAt: new Date(now.valueOf() - 47 * 60 * 60 * 1_000).toISOString(),
    });

    const ignoresIneligible = dependencies({
      current: current(0, [ignoredRecentCoach, ignoredRecentDraft, eligibleOld]),
      inputs: inputsByTier[1],
    });
    await ignoresIneligible.useCase.execute(ids.client, context);
    expect(ignoresIneligible.commitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ automatedSendAllowed: true }),
    );

    const sortsEligible = dependencies({
      current: current(0, [eligibleOld, eligibleRecent]),
      inputs: inputsByTier[1],
    });
    await sortsEligible.useCase.execute(ids.client, context);
    expect(sortsEligible.commitDecision).toHaveBeenCalledWith(
      expect.objectContaining({ automatedSendAllowed: false }),
    );
  });

  it("keeps coach ownership and suppresses automation when the computed tier falls", async () => {
    const setup = dependencies({ current: current(3), inputs: inputsByTier[1] });
    await setup.useCase.execute(ids.client, context);
    expect(setup.commitDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: 1,
        automatedSendAllowed: false,
      }),
    );
    expect(setup.commitDecision.mock.calls[0]?.[0].nextState).toMatchObject({
      tier: 3,
      owner: "coach",
    });
  });

  it("audits and rejects a model-selected tier mismatch", async () => {
    const setup = dependencies({ inputs: inputsByTier[1], gatewayOutput: output(2) });
    await expect(setup.useCase.execute(ids.client, context)).rejects.toMatchObject({
      code: "model_output_invalid",
      message: "Accountability output cannot select a different tier.",
    });
    expect(setup.recordFailure).toHaveBeenCalledWith({
      kind: "accountability",
      traceId: ids.trace,
      errorCode: "model_output_invalid",
      context,
    });
  });

  it("audits and rejects a blocking gate", async () => {
    const setup = dependencies({ inputs: inputsByTier[2], gates: [passingGate, blockingGate] });
    await expect(setup.useCase.execute(ids.client, context)).rejects.toMatchObject({
      code: "model_output_invalid",
      message: "Accountability content failed a blocking safety gate.",
    });
    expect(setup.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "model_output_invalid" }),
    );
  });

  it("audits schema-invalid and gateway failures as invalid model output", async () => {
    const invalid = dependencies({ inputs: inputsByTier[2], gatewayOutput: { invalid: true } });
    await expect(invalid.useCase.execute(ids.client, context)).rejects.toThrow();
    expect(invalid.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "model_output_invalid" }),
    );

    const failure = new Error("gateway unavailable");
    const failed = dependencies({ inputs: inputsByTier[3], gatewayFailure: failure });
    await expect(failed.useCase.execute(ids.client, context)).rejects.toBe(failure);
    expect(failed.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "model_output_invalid" }),
    );
  });
});
