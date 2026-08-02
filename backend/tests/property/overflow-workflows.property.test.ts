import {
  accountabilityDetailSchema,
  contextTraceAttemptSchema,
  programmeReviewSchema,
  type EngagementInputs,
  type ProgrammePayload,
} from "@spotter/contracts";
import { describe, expect, it } from "vitest";

import { RunAccountabilityForClient } from "../../src/application/accountability";
import { GenerateAdjustment } from "../../src/application/adjustments";
import type { ExecutionContext, IdempotencyPort } from "../../src/application/core";
import { EditProgrammeProposal } from "../../src/application/programmes";
import type {
  AccountabilityPort,
  AdjustmentPort,
  AgentAuditPort,
  ContextAssemblerPort,
  EvaluationPort,
  ModelGatewayPort,
  ProgrammePort,
  TracePort,
} from "../../src/application/ports";

const ids = {
  adjustment: "00000000-0000-4000-8000-000000004001",
  client: "00000000-0000-4000-8000-000000004002",
  coach: "00000000-0000-4000-8000-000000004003",
  exercise: "00000000-0000-4000-8000-000000004004",
  programme: "00000000-0000-4000-8000-000000004005",
  record: "00000000-0000-4000-8000-000000004006",
  run: "00000000-0000-4000-8000-000000004007",
  trace: "00000000-0000-4000-8000-000000004008",
  turn: "00000000-0000-4000-8000-000000004009",
} as const;
const effectiveAt = new Date("2026-08-03T06:00:00.000Z");
const context: ExecutionContext = {
  actorId: ids.coach,
  effectiveAt,
  idempotencyKey: "property-overflow-workflow",
  requestId: "property-overflow-workflow-request",
};
const overflowTrace = contextTraceAttemptSchema.parse({
  budget: 1,
  clientId: ids.client,
  createdAt: effectiveAt.toISOString(),
  id: ids.trace,
  intent: "adjustment",
  rendered: "Pinned hard constraint evidence exceeds one token.",
  sections: [],
  tokenCount: 10,
  turnId: ids.turn,
});
const payload: ProgrammePayload = {
  days: [
    {
      dayIndex: 1,
      exercises: [
        {
          family: "squat",
          id: ids.exercise,
          muscleGroups: ["quadriceps"],
          name: "Goblet squat",
          notes: null,
          reps: 8,
          restSeconds: 90,
          rpe: 7,
          sets: 3,
        },
      ],
      focus: "Synthetic session",
      scheduledDate: "2026-08-03",
    },
  ],
  summary: "Synthetic programme.",
};

function idempotency(): IdempotencyPort {
  return {
    claim: () => Promise.resolve({ kind: "claimed", recordId: ids.record }),
    complete: () => Promise.resolve(),
    fail: () => Promise.resolve(),
  };
}

function overflowAssembler(): ContextAssemblerPort {
  return {
    assemble: () => Promise.resolve({ status: "hard_constraint_overflow", trace: overflowTrace }),
  };
}

function traceRecorder(events: string[]): TracePort {
  return {
    get: () => Promise.resolve(overflowTrace),
    persistBeforeModel: () => {
      events.push("persist");
      return Promise.resolve();
    },
  };
}

function forbiddenGateway(calls: { value: number }): ModelGatewayPort {
  const reject = (): Promise<never> => {
    calls.value += 1;
    return Promise.reject(new Error("Overflow must prevent gateway access"));
  };
  return {
    draftAccountability: reject,
    generateAdjustment: reject,
    generateProgramme: reject,
  };
}

function forbiddenEvaluation(calls: { value: number }): EvaluationPort {
  const reject = (): Promise<never> => {
    calls.value += 1;
    return Promise.reject(new Error("Overflow must prevent evaluation"));
  };
  return { runGates: reject, runJudges: reject };
}

function forbiddenAudit(calls: { value: number }): AgentAuditPort {
  return {
    recordFailure: () => {
      calls.value += 1;
      return Promise.resolve();
    },
    recordSuccess: () => {
      calls.value += 1;
      return Promise.resolve(ids.run);
    },
  };
}

describe("overflow ordering across application workflows", () => {
  it("persists adjustment overflow before failing with no downstream calls", async () => {
    const events: string[] = [];
    const gatewayCalls = { value: 0 };
    const evaluationCalls = { value: 0 };
    const auditCalls = { value: 0 };
    let queueCalls = 0;
    const adjustments: AdjustmentPort = {
      approve: () => Promise.reject(new Error("unused")),
      edit: () => Promise.reject(new Error("unused")),
      get: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      queueGenerated: () => {
        queueCalls += 1;
        return Promise.reject(new Error("Overflow must prevent queueing"));
      },
      reject: () => Promise.reject(new Error("unused")),
      resolveGenerationInput: () =>
        Promise.resolve({
          baseProgrammeId: ids.programme,
          sourceEventKey: "property:explicit-coach",
          trigger: { coachId: ids.coach, type: "explicit_coach" },
        }),
    };
    await expect(
      new GenerateAdjustment({
        adjustments,
        assembler: overflowAssembler(),
        audit: forbiddenAudit(auditCalls),
        evaluation: forbiddenEvaluation(evaluationCalls),
        fingerprint: { fingerprint: (value) => JSON.stringify(value) },
        gateway: forbiddenGateway(gatewayCalls),
        idempotency: idempotency(),
        traces: traceRecorder(events),
      }).execute({ clientId: ids.client }, context),
    ).rejects.toMatchObject({ code: "context_hard_constraints_exceed_budget" });
    expect(events).toEqual(["persist"]);
    expect(gatewayCalls.value).toBe(0);
    expect(evaluationCalls.value).toBe(0);
    expect(auditCalls.value).toBe(0);
    expect(queueCalls).toBe(0);
  });

  it("persists accountability overflow before failing with no downstream calls", async () => {
    const events: string[] = [];
    const gatewayCalls = { value: 0 };
    const evaluationCalls = { value: 0 };
    const auditCalls = { value: 0 };
    let commitCalls = 0;
    const inputs: EngagementInputs = {
      baselineCheckInCount: 0,
      baselineCheckInLatencyHours: null,
      completedDue14d: 1,
      completedDue7d: 0,
      currentCheckInLatencyHours: null,
      daysSinceOpen: 1,
      missedDue14d: 1,
      missedDue7d: 1,
      plannedDue14d: 2,
      plannedDue7d: 1,
      rpeDrift: null,
    };
    const accountability: AccountabilityPort = {
      commitDecision: () => {
        commitCalls += 1;
        return Promise.reject(new Error("Overflow must prevent committing"));
      },
      get: () =>
        Promise.resolve(
          accountabilityDetailSchema.parse({
            latestScore: null,
            messages: [],
            state: {
              automationPaused: false,
              churnFlagged: false,
              clientId: ids.client,
              lastTransitionAt: effectiveAt.toISOString(),
              owner: "none",
              tier: 0,
              version: 1,
            },
          }),
        ),
      loadInputs: () => Promise.resolve(inputs),
    };
    await expect(
      new RunAccountabilityForClient({
        accountability,
        assembler: overflowAssembler(),
        audit: forbiddenAudit(auditCalls),
        evaluation: forbiddenEvaluation(evaluationCalls),
        fingerprint: { fingerprint: (value) => JSON.stringify(value) },
        gateway: forbiddenGateway(gatewayCalls),
        idempotency: idempotency(),
        traces: traceRecorder(events),
      }).execute(ids.client, context),
    ).rejects.toMatchObject({ code: "context_hard_constraints_exceed_budget" });
    expect(events).toEqual(["persist"]);
    expect(gatewayCalls.value).toBe(0);
    expect(evaluationCalls.value).toBe(0);
    expect(auditCalls.value).toBe(0);
    expect(commitCalls).toBe(0);
  });

  it("rejects an overflow attempt retrieved for proposal editing before evaluation", async () => {
    let evaluationCalls = 0;
    const programmes: ProgrammePort = {
      edit: () => Promise.reject(new Error("Invalid trace must prevent editing")),
      getReview: () =>
        Promise.resolve(
          programmeReviewSchema.parse({
            citations: [
              {
                claim: "Synthetic evidence.",
                recordIds: [ids.client],
                sectionId: "ctx-02-goal-profile-equipment-schedule",
              },
            ],
            gates: [],
            judges: [],
            model: "recorded-model",
            programme: {
              approvedAt: null,
              approvedBy: null,
              clientId: ids.client,
              createdAt: effectiveAt.toISOString(),
              generatedBy: ids.run,
              id: ids.programme,
              mesocycle: 1,
              payload,
              reviewBand: "attention",
              status: "queued",
              supersededBy: null,
              validFrom: null,
              version: 1,
              week: 1,
            },
            promptVersion: "property-v1",
            traceId: ids.trace,
          }),
        ),
      list: () => Promise.resolve([]),
      publish: () => Promise.reject(new Error("unused")),
      queueGenerated: () => Promise.reject(new Error("unused")),
      reject: () => Promise.reject(new Error("unused")),
    };
    await expect(
      new EditProgrammeProposal({
        evaluation: {
          runGates: () => {
            evaluationCalls += 1;
            return Promise.resolve([]);
          },
          runJudges: () => Promise.resolve([]),
        },
        programmes,
        traces: {
          get: () => Promise.resolve(overflowTrace),
          persistBeforeModel: () => Promise.resolve(),
        },
      }).execute(ids.programme, { expectedVersion: 1, payload }, context),
    ).rejects.toMatchObject({ code: "dependency_unavailable" });
    expect(evaluationCalls).toBe(0);
  });
});
