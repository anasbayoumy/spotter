import {
  accountabilityDetailSchema,
  adjustmentModelOutputSchema,
  checkInSchema,
  contextTraceSchema,
  programmeModelOutputSchema,
  programmeReviewSchema,
  sessionSchema,
  type GateResult,
  type JudgeResult,
  type ProgrammeModelOutput,
  type ProgrammeReview,
} from "@spotter/contracts";
import { describe, expect, it } from "vitest";

import { RunAccountabilityForClient } from "./accountability.js";
import {
  ApplicationError,
  executeIdempotently,
  type ExecutionContext,
  type FingerprintPort,
  type IdempotencyClaim,
  type IdempotencyPort,
} from "./core.js";
import type {
  AccountabilityPort,
  AdjustmentTriggerPort,
  AgentAuditPort,
  CheckInPort,
  ContextAssemblerPort,
  EvaluationPort,
  ModelGatewayPort,
  ProgrammePort,
  RedFlagPort,
  SessionPort,
  TracePort,
} from "./ports.js";
import { ApproveProgramme, GenerateProgramme, OverrideBlockedProgramme } from "./programmes.js";
import { CreateCheckIn, CompleteSession } from "./sessions.js";

const ids = {
  client: "00000000-0000-4000-8000-000000000001",
  coach: "00000000-0000-4000-8000-000000000002",
  programme: "00000000-0000-4000-8000-000000000003",
  run: "00000000-0000-4000-8000-000000000004",
  trace: "00000000-0000-4000-8000-000000000005",
  turn: "00000000-0000-4000-8000-000000000006",
  exercise: "00000000-0000-4000-8000-000000000007",
  session: "00000000-0000-4000-8000-000000000008",
  checkIn: "00000000-0000-4000-8000-000000000009",
  gate: "00000000-0000-4000-8000-000000000010",
  judge: "00000000-0000-4000-8000-000000000011",
} as const;
const now = new Date("2026-08-02T12:00:00.000Z");
const context: ExecutionContext = {
  requestId: "request-0001",
  actorId: ids.coach,
  effectiveAt: now,
  idempotencyKey: "request:key:0001",
};
const payload = {
  summary: "Synthetic week",
  days: [
    {
      dayIndex: 1,
      scheduledDate: "2026-08-03",
      focus: "Strength",
      exercises: [
        {
          id: ids.exercise,
          name: "Squat",
          family: "squat",
          muscleGroups: ["quadriceps"],
          sets: 3,
          reps: 5,
          rpe: 7,
          restSeconds: 90,
          notes: null,
        },
      ],
    },
  ],
} as const;
const citation = { sectionId: "profile", recordIds: [ids.client], claim: "Uses schedule" };
const modelOutput = programmeModelOutputSchema.parse({ payload, citations: [citation] });
const trace = contextTraceSchema.parse({
  id: ids.trace,
  clientId: ids.client,
  turnId: ids.turn,
  intent: "programme",
  sections: [],
  rendered: "synthetic context",
  tokenCount: 10,
  budget: 1_000,
  createdAt: now.toISOString(),
});
const passingGate: GateResult = {
  id: ids.gate,
  name: "forbidden_movement",
  passed: true,
  rationale: "No forbidden movement",
};
const judge: JudgeResult = {
  id: ids.judge,
  name: "grounding",
  score: 4,
  rationale: "Grounded",
  judgeModel: "recorded-judge",
};

function programmeReview(band: "blocked" | "attention" | "clear" = "clear"): ProgrammeReview {
  return programmeReviewSchema.parse({
    programme: {
      id: ids.programme,
      clientId: ids.client,
      mesocycle: 1,
      week: 1,
      payload,
      status: "queued",
      reviewBand: band,
      generatedBy: ids.run,
      approvedBy: null,
      approvedAt: null,
      supersededBy: null,
      validFrom: null,
      createdAt: now.toISOString(),
      version: 1,
    },
    citations: [citation],
    gates: [passingGate],
    judges: [judge],
    traceId: ids.trace,
    promptVersion: "prompt-v1",
    model: "recorded-generator",
  });
}

class FakeIdempotency implements IdempotencyPort {
  public completedValue: unknown;
  public failCode: string | null = null;
  public completeCalls = 0;

  public claim<T>(): Promise<IdempotencyClaim<T>> {
    if (this.completedValue !== undefined) {
      return Promise.resolve({
        kind: "completed",
        recordId: ids.run,
        value: this.completedValue as T,
      });
    }
    return Promise.resolve({ kind: "claimed", recordId: ids.run });
  }

  public complete(_recordId: string, value: unknown): Promise<void> {
    this.completeCalls += 1;
    this.completedValue = value;
    return Promise.resolve();
  }

  public fail(_recordId: string, code: string): Promise<void> {
    this.failCode = code;
    return Promise.resolve();
  }
}

const fingerprint: FingerprintPort = { fingerprint: (value) => JSON.stringify(value) };

function fakeProgrammePort(review = programmeReview()): ProgrammePort {
  return {
    list() {
      return Promise.resolve([review.programme]);
    },
    getReview() {
      return Promise.resolve(review);
    },
    queueGenerated(input) {
      return Promise.resolve(programmeReview(input.band));
    },
    edit() {
      return Promise.resolve(review);
    },
    reject() {
      return Promise.resolve({ ...review.programme, status: "rejected" });
    },
    publish(input) {
      return Promise.resolve({
        ...review.programme,
        status: "published",
        approvedBy: input.context.actorId,
        approvedAt: input.context.effectiveAt.toISOString(),
        validFrom: input.context.effectiveAt.toISOString(),
        version: input.expectedVersion + 1,
      });
    },
  };
}

function generationDependencies(
  events: string[],
  idempotency = new FakeIdempotency(),
): {
  readonly assembler: ContextAssemblerPort;
  readonly traces: TracePort;
  readonly gateway: ModelGatewayPort;
  readonly evaluation: EvaluationPort;
  readonly audit: AgentAuditPort;
  readonly programmes: ProgrammePort;
  readonly idempotency: FakeIdempotency;
  readonly fingerprint: FingerprintPort;
} {
  const assembler: ContextAssemblerPort = {
    assemble() {
      events.push("assemble");
      return Promise.resolve({ status: "ready", trace });
    },
  };
  const traces: TracePort = {
    persistBeforeModel() {
      events.push("trace");
      return Promise.resolve();
    },
    get() {
      return Promise.resolve(trace);
    },
  };
  const gateway: ModelGatewayPort = {
    generateProgramme() {
      events.push("model");
      return Promise.resolve(modelOutput);
    },
    generateAdjustment() {
      return Promise.resolve(
        adjustmentModelOutputSchema.parse({
          operations: [
            {
              type: "reduce_load",
              exerciseId: ids.exercise,
              percent: 10,
              rationale: "High RPE",
            },
          ],
          citations: [citation],
        }),
      );
    },
    draftAccountability(_trace, tier) {
      return Promise.resolve({
        kind:
          tier === 1 ? "client_nudge" : tier === 2 ? "reduced_plan_offer" : "coach_context_brief",
        tier,
        body: "Synthetic accountability content",
        citations: [citation],
      });
    },
  };
  const evaluation: EvaluationPort = {
    runGates() {
      events.push("gates");
      return Promise.resolve([passingGate]);
    },
    runJudges() {
      events.push("judges");
      return Promise.resolve([judge]);
    },
  };
  const audit: AgentAuditPort = {
    recordSuccess() {
      events.push("audit-success");
      return Promise.resolve(ids.run);
    },
    recordFailure() {
      events.push("audit-failure");
      return Promise.resolve();
    },
  };
  return {
    assembler,
    traces,
    gateway,
    evaluation,
    audit,
    programmes: fakeProgrammePort(),
    idempotency,
    fingerprint,
  };
}

describe("idempotent application execution", () => {
  it("returns a stored result without re-running work", async () => {
    const idempotency = new FakeIdempotency();
    idempotency.completedValue = { stable: true };
    let executions = 0;
    const value = await executeIdempotently(
      { idempotency, fingerprint },
      context,
      "test",
      {},
      () => {
        executions += 1;
        return Promise.resolve({ stable: false });
      },
    );
    expect(value).toEqual({ stable: true });
    expect(executions).toBe(0);
  });

  it("records failure and rethrows a typed error", async () => {
    const idempotency = new FakeIdempotency();
    await expect(
      executeIdempotently({ idempotency, fingerprint }, context, "test", {}, () =>
        Promise.reject(new ApplicationError("version_conflict", "Changed")),
      ),
    ).rejects.toMatchObject({ code: "version_conflict" });
    expect(idempotency.failCode).toBe("version_conflict");
  });
});

describe("programme orchestration", () => {
  it("persists the trace before model and runs gates before judges", async () => {
    const events: string[] = [];
    const result = await new GenerateProgramme(generationDependencies(events)).execute(
      { clientId: ids.client, targetWeekStart: "2026-08-03" },
      context,
    );
    expect(result.programme.reviewBand).toBe("clear");
    expect(events).toEqual(["assemble", "trace", "model", "gates", "judges", "audit-success"]);
  });

  it("does not invoke the gateway when trace persistence fails", async () => {
    const events: string[] = [];
    const dependencies = generationDependencies(events);
    dependencies.traces.persistBeforeModel = () => {
      events.push("trace-failed");
      return Promise.reject(new Error("database down"));
    };
    await expect(
      new GenerateProgramme(dependencies).execute(
        { clientId: ids.client, targetWeekStart: "2026-08-03" },
        context,
      ),
    ).rejects.toThrow("database down");
    expect(events).toEqual(["assemble", "trace-failed"]);
  });

  it("records invalid model output and queues nothing", async () => {
    const events: string[] = [];
    const dependencies = generationDependencies(events);
    dependencies.gateway.generateProgramme = () =>
      Promise.resolve({ invalid: true } as unknown as ProgrammeModelOutput);
    await expect(
      new GenerateProgramme(dependencies).execute(
        { clientId: ids.client, targetWeekStart: "2026-08-03" },
        context,
      ),
    ).rejects.toMatchObject({
      code: "model_output_invalid",
      message: "Programme output did not match the required schema.",
    });
    expect(events).toContain("audit-failure");
    expect(events).not.toContain("gates");
  });

  it("rejects ordinary approval for blocked plans and permits reasoned override", async () => {
    const port = fakeProgrammePort(programmeReview("blocked"));
    const idempotent = { idempotency: new FakeIdempotency(), fingerprint };
    await expect(
      new ApproveProgramme(port, idempotent).execute(
        ids.programme,
        { expectedVersion: 1 },
        context,
      ),
    ).rejects.toMatchObject({
      code: "blocked_requires_override",
      message: "Blocked programme requires an override.",
    });
    await expect(
      new OverrideBlockedProgramme(port, idempotent).executeOverride(
        ids.programme,
        { expectedVersion: 1, reason: "Coach accepts documented risk" },
        context,
      ),
    ).resolves.toMatchObject({ status: "published", approvedBy: ids.coach });
  });
});

describe("session and check-in event orchestration", () => {
  it("routes red flags to a human and never requests an adjustment", async () => {
    const events: string[] = [];
    const checkIns: CheckInPort = {
      create(input) {
        return Promise.resolve(
          checkInSchema.parse({
            id: ids.checkIn,
            clientId: input.clientId,
            readiness: input.readiness,
            body: input.body,
            sentiment: null,
            respondedAt: input.respondedAt,
            latencyHours: null,
            createdAt: now.toISOString(),
            requiresHumanEscalation: input.requiresHumanEscalation,
          }),
        );
      },
    };
    const redFlags: RedFlagPort = {
      hasRedFlag: () => true,
      escalate() {
        events.push("escalate");
        return Promise.resolve();
      },
    };
    const triggers: AdjustmentTriggerPort = {
      request() {
        events.push("adjustment");
        return Promise.resolve();
      },
    };
    await new CreateCheckIn(checkIns, redFlags, triggers, {
      idempotency: new FakeIdempotency(),
      fingerprint,
    }).execute(
      {
        clientId: ids.client,
        readiness: 1,
        body: "Synthetic red flag",
        respondedAt: now.toISOString(),
      },
      context,
    );
    expect(events).toEqual(["escalate"]);
  });

  it("creates one high-RPE trigger after committed completion", async () => {
    const events: string[] = [];
    const completed = sessionSchema.parse({
      id: ids.session,
      clientId: ids.client,
      programmeId: ids.programme,
      scheduledFor: "2026-08-02",
      status: "completed",
      planned: payload.days[0].exercises,
      actual: [
        {
          exerciseId: ids.exercise,
          sets: [{ setIndex: 1, reps: 5, loadKg: 50, rpe: 9, completed: true }],
        },
      ],
      performedAt: now.toISOString(),
      rpe: 9,
      notes: null,
      version: 2,
    });
    const sessions: SessionPort = {
      list() {
        return Promise.resolve([completed]);
      },
      get() {
        return Promise.resolve(completed);
      },
      log() {
        return Promise.resolve(completed);
      },
      complete() {
        events.push("committed");
        return Promise.resolve(completed);
      },
    };
    const triggers: AdjustmentTriggerPort = {
      request(input) {
        events.push(input.trigger.type);
        return Promise.resolve();
      },
    };
    await new CompleteSession(sessions, triggers, {
      idempotency: new FakeIdempotency(),
      fingerprint,
    }).execute(
      ids.session,
      {
        clientId: ids.client,
        rpe: 9,
        performedAt: now.toISOString(),
        expectedVersion: 1,
      },
      context,
    );
    expect(events).toEqual(["committed", "high_rpe"]);
  });
});

describe("accountability orchestration", () => {
  it("uses the deterministic tier and marks a recent tier-one message ineligible", async () => {
    const events: string[] = [];
    const current = accountabilityDetailSchema.parse({
      state: {
        clientId: ids.client,
        tier: 0,
        owner: "none",
        lastTransitionAt: now.toISOString(),
        automationPaused: false,
        churnFlagged: false,
        version: 1,
      },
      latestScore: null,
      messages: [
        {
          id: ids.run,
          clientId: ids.client,
          tier: 1,
          actor: "agent",
          status: "sent",
          body: "Earlier nudge",
          createdAt: now.toISOString(),
          sentAt: new Date(now.valueOf() - 47 * 60 * 60 * 1_000).toISOString(),
          suppressedAt: null,
          suppressionReason: null,
        },
      ],
    });
    let sendAllowed: boolean | null = null;
    const accountability: AccountabilityPort = {
      get() {
        return Promise.resolve(current);
      },
      loadInputs() {
        return Promise.resolve({
          plannedDue7d: 1,
          completedDue7d: 0,
          plannedDue14d: 1,
          completedDue14d: 0,
          missedDue7d: 1,
          missedDue14d: 1,
          currentCheckInLatencyHours: null,
          baselineCheckInLatencyHours: null,
          baselineCheckInCount: 0,
          daysSinceOpen: 1,
          rpeDrift: null,
        });
      },
      commitDecision(input) {
        sendAllowed = input.automatedSendAllowed;
        return Promise.resolve(current);
      },
    };
    const dependencies = generationDependencies(events);
    await new RunAccountabilityForClient({
      accountability,
      assembler: dependencies.assembler,
      traces: dependencies.traces,
      gateway: dependencies.gateway,
      evaluation: dependencies.evaluation,
      audit: dependencies.audit,
      idempotency: new FakeIdempotency(),
      fingerprint,
    }).execute(ids.client, context);
    expect(sendAllowed).toBe(false);
    expect(events.indexOf("trace")).toBeLessThan(events.indexOf("gates"));
  });
});
