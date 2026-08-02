import {
  accountabilityDetailSchema,
  checkInSchema,
  contextTraceSchema,
  type AccountabilityModelOutput,
  type CheckIn,
  type EngagementInputs,
} from "@spotter/contracts";
import { describe, expect, it } from "vitest";

import { detectRedFlags } from "../../src/evals/safety/red-flags";
import { RunAccountabilityForClient } from "../../src/application/accountability";
import {
  type ExecutionContext,
  type FingerprintPort,
  type IdempotencyPort,
} from "../../src/application/core";
import type {
  AccountabilityPort,
  AdjustmentTriggerPort,
  AgentAuditPort,
  CheckInPort,
  ContextAssemblerPort,
  EvaluationPort,
  ModelGatewayPort,
  RedFlagPort,
  TracePort,
} from "../../src/application/ports";
import { CreateCheckIn } from "../../src/application/sessions";
import type { AccountabilityDetail } from "../../src/application/read-models";
import {
  AccountabilityState,
  AUTOMATED_MESSAGE_WINDOW_MS,
  canSendAutomatedMessage,
} from "../../src/domain/accountability";

const ids = {
  checkIn: "00000000-0000-4000-8000-000000002001",
  client: "00000000-0000-4000-8000-000000002002",
  coach: "00000000-0000-4000-8000-000000002003",
  record: "00000000-0000-4000-8000-000000002004",
  trace: "00000000-0000-4000-8000-000000002005",
  turn: "00000000-0000-4000-8000-000000002006",
} as const;
const effectiveAt = new Date("2026-08-03T06:00:00.000Z");
const context: ExecutionContext = {
  actorId: ids.coach,
  effectiveAt,
  idempotencyKey: "property-application-idempotency",
  requestId: "property-application-request",
};
const fingerprint: FingerprintPort = { fingerprint: (value) => JSON.stringify(value) };

function idempotency(): IdempotencyPort {
  return {
    claim: () => Promise.resolve({ kind: "claimed", recordId: ids.record }),
    complete: () => Promise.resolve(),
    fail: () => Promise.resolve(),
  };
}

describe("domain accountability properties", () => {
  it("QA-SAF-056: no automatic transition releases or demotes coach ownership", () => {
    for (const currentTier of [3, 4] as const) {
      const current = new AccountabilityState({
        automationPaused: true,
        churnFlagged: currentTier === 4,
        owner: "coach",
        tier: currentTier,
        version: 7,
      });
      for (const computedTier of [0, 1, 2, 3, 4] as const) {
        const next = current.transition(computedTier).snapshot();
        expect(next.owner, `current=${String(currentTier)} computed=${String(computedTier)}`).toBe(
          "coach",
        );
        expect(next.automationPaused).toBe(true);
        expect(next.tier).toBe(Math.max(currentTier, computedTier));
        expect(next.version).toBe(computedTier > currentTier ? 8 : 7);
      }
    }
  });

  it("QA-SAF-057: automated messaging is allowed only at or beyond the exact 48-hour boundary", () => {
    expect(canSendAutomatedMessage(null, effectiveAt)).toBe(true);
    for (const offsetHours of [-24, 0, 1, 47, 47.999, 48, 49, 96]) {
      const lastSentAt = new Date(effectiveAt.valueOf() - offsetHours * 60 * 60 * 1_000);
      expect(
        canSendAutomatedMessage(lastSentAt, effectiveAt),
        `offset=${String(offsetHours)}`,
      ).toBe(offsetHours * 60 * 60 * 1_000 >= AUTOMATED_MESSAGE_WINDOW_MS);
    }
  });
});

describe("check-in routing adversarial properties", () => {
  it("routes every detected red-flag spelling only to human escalation", async () => {
    const redFlagBodies = [
      "I have chest pain after training.",
      "There is CHEST   PRESSURE right now.",
      "I fainted during the session.",
      "I passed out after the last set.",
      "I experienced loss of consciousness.",
      "I may self-harm.",
      "I want to hurt myself.",
      "I feel suicidal.",
    ];
    for (const body of redFlagBodies) {
      const events: string[] = [];
      let persistedEscalation = false;
      const checkIns: CheckInPort = {
        create(input): Promise<CheckIn> {
          persistedEscalation = input.requiresHumanEscalation;
          return Promise.resolve(
            checkInSchema.parse({
              body: input.body,
              clientId: input.clientId,
              createdAt: effectiveAt.toISOString(),
              id: ids.checkIn,
              latencyHours: null,
              readiness: input.readiness,
              requiresHumanEscalation: input.requiresHumanEscalation,
              respondedAt: input.respondedAt,
              sentiment: null,
            }),
          );
        },
      };
      const redFlags: RedFlagPort = {
        hasRedFlag: (candidate) => detectRedFlags(candidate).length > 0,
        escalate: () => {
          events.push("human_escalation");
          return Promise.resolve();
        },
      };
      const triggers: AdjustmentTriggerPort = {
        request: () => {
          events.push("adjustment");
          return Promise.resolve();
        },
      };
      await new CreateCheckIn(checkIns, redFlags, triggers, {
        fingerprint,
        idempotency: idempotency(),
      }).execute(
        {
          body,
          clientId: ids.client,
          readiness: 1,
          respondedAt: effectiveAt.toISOString(),
        },
        context,
      );
      expect(persistedEscalation, body).toBe(true);
      expect(events, body).toEqual(["human_escalation"]);
    }
  });

  it("routes safe low-readiness input to an adjustment and not an escalation", async () => {
    const events: string[] = [];
    const checkIns: CheckInPort = {
      create: (input) =>
        Promise.resolve(
          checkInSchema.parse({
            body: input.body,
            clientId: input.clientId,
            createdAt: effectiveAt.toISOString(),
            id: ids.checkIn,
            latencyHours: null,
            readiness: input.readiness,
            requiresHumanEscalation: input.requiresHumanEscalation,
            respondedAt: input.respondedAt,
            sentiment: null,
          }),
        ),
    };
    const redFlags: RedFlagPort = {
      hasRedFlag: (candidate) => detectRedFlags(candidate).length > 0,
      escalate: () => {
        events.push("human_escalation");
        return Promise.resolve();
      },
    };
    const triggers: AdjustmentTriggerPort = {
      request: () => {
        events.push("adjustment");
        return Promise.resolve();
      },
    };
    await new CreateCheckIn(checkIns, redFlags, triggers, {
      fingerprint,
      idempotency: idempotency(),
    }).execute(
      {
        body: "Normal muscle soreness and low energy today.",
        clientId: ids.client,
        readiness: 1,
        respondedAt: effectiveAt.toISOString(),
      },
      context,
    );
    expect(events).toEqual(["adjustment"]);
  });
});

const trace = contextTraceSchema.parse({
  budget: 1_000,
  clientId: ids.client,
  createdAt: effectiveAt.toISOString(),
  id: ids.trace,
  intent: "accountability",
  rendered: "Synthetic selected accountability context.",
  sections: [],
  tokenCount: 10,
  turnId: ids.turn,
});
const inputsByTier: Readonly<Record<1 | 2 | 3, EngagementInputs>> = {
  1: {
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
  },
  2: {
    baselineCheckInCount: 0,
    baselineCheckInLatencyHours: null,
    completedDue14d: 2,
    completedDue7d: 1,
    currentCheckInLatencyHours: null,
    daysSinceOpen: 1,
    missedDue14d: 2,
    missedDue7d: 0,
    plannedDue14d: 4,
    plannedDue7d: 1,
    rpeDrift: null,
  },
  3: {
    baselineCheckInCount: 0,
    baselineCheckInLatencyHours: null,
    completedDue14d: 2,
    completedDue7d: 1,
    currentCheckInLatencyHours: null,
    daysSinceOpen: 7,
    missedDue14d: 0,
    missedDue7d: 0,
    plannedDue14d: 4,
    plannedDue7d: 2,
    rpeDrift: null,
  },
};

function currentAccountability(): AccountabilityDetail {
  return accountabilityDetailSchema.parse({
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
  });
}

function mismatchedOutput(
  tier: 1 | 2 | 3,
  kind: AccountabilityModelOutput["kind"],
): AccountabilityModelOutput {
  return {
    body: "Synthetic but misrouted accountability copy.",
    citations: [
      {
        claim: "Synthetic evidence.",
        recordIds: [ids.client],
        sectionId: "ctx-04-recent-sessions-adherence",
      },
    ],
    kind,
    tier,
  };
}

describe("production accountability authority boundary", () => {
  it("fails closed before evaluation or persistence for every tier-kind mismatch", async () => {
    const kinds = ["client_nudge", "reduced_plan_offer", "coach_context_brief"] as const;
    const expected = {
      1: "client_nudge",
      2: "reduced_plan_offer",
      3: "coach_context_brief",
    } as const;

    for (const tier of [1, 2, 3] as const) {
      for (const kind of kinds.filter((candidate) => candidate !== expected[tier])) {
        let commitCount = 0;
        let evaluationCount = 0;
        let failureAuditCount = 0;
        const accountability: AccountabilityPort = {
          commitDecision: () => {
            commitCount += 1;
            return Promise.reject(new Error("Invalid output must not commit"));
          },
          get: () => Promise.resolve(currentAccountability()),
          loadInputs: () => Promise.resolve(inputsByTier[tier]),
        };
        const assembler: ContextAssemblerPort = {
          assemble: () => Promise.resolve({ status: "ready", trace }),
        };
        const traces: TracePort = {
          get: () => Promise.resolve(trace),
          persistBeforeModel: () => Promise.resolve(),
        };
        const gateway: ModelGatewayPort = {
          draftAccountability: () => Promise.resolve(mismatchedOutput(tier, kind)),
          generateAdjustment: () => Promise.reject(new Error("unused")),
          generateProgramme: () => Promise.reject(new Error("unused")),
        };
        const evaluation: EvaluationPort = {
          runGates: () => {
            evaluationCount += 1;
            return Promise.resolve([]);
          },
          runJudges: () => Promise.resolve([]),
        };
        const audit: AgentAuditPort = {
          recordFailure: () => {
            failureAuditCount += 1;
            return Promise.resolve();
          },
          recordSuccess: () => Promise.reject(new Error("Invalid output must not be audited")),
        };
        await expect(
          new RunAccountabilityForClient({
            accountability,
            assembler,
            audit,
            evaluation,
            fingerprint,
            gateway,
            idempotency: idempotency(),
            traces,
          }).execute(ids.client, context),
          `tier=${String(tier)} kind=${kind}`,
        ).rejects.toBeDefined();
        expect(evaluationCount).toBe(0);
        expect(commitCount).toBe(0);
        expect(failureAuditCount).toBe(1);
      }
    }
  });
});
