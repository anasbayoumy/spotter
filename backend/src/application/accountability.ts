import {
  accountabilityDetailSchema,
  accountabilityModelOutputSchema,
  gateResultSchema,
  judgeResultSchema,
} from "@spotter/contracts";
import { z } from "zod";

import {
  AccountabilityState,
  calculateAccountabilityTier,
  canSendAutomatedMessage,
} from "../domain/index.js";
import {
  ApplicationError,
  executeIdempotently,
  type ExecutionContext,
  type FingerprintPort,
  type IdempotencyPort,
} from "./core.js";
import type {
  AccountabilityPort,
  AgentAuditPort,
  ContextAssemblerPort,
  EvaluationPort,
  ModelGatewayPort,
  TracePort,
} from "./ports.js";
import type { AccountabilityDetail } from "./read-models.js";

interface Dependencies {
  readonly accountability: AccountabilityPort;
  readonly assembler: ContextAssemblerPort;
  readonly traces: TracePort;
  readonly gateway: ModelGatewayPort;
  readonly evaluation: EvaluationPort;
  readonly audit: AgentAuditPort;
  readonly idempotency: IdempotencyPort;
  readonly fingerprint: FingerprintPort;
}

export class RunAccountabilityForClient {
  public constructor(private readonly dependencies: Dependencies) {}

  public async execute(clientId: string, context: ExecutionContext): Promise<AccountabilityDetail> {
    const result = await executeIdempotently(
      this.dependencies,
      context,
      "accountability.run",
      { clientId, effectiveAt: context.effectiveAt.toISOString() },
      async () => {
        const current = await this.dependencies.accountability.get(clientId);
        if (current === undefined) {
          throw new ApplicationError("client_not_found", "Client does not exist.");
        }
        const inputs = await this.dependencies.accountability.loadInputs(
          clientId,
          context.effectiveAt,
        );
        const tier = calculateAccountabilityTier({
          plannedDue14d: inputs.plannedDue14d,
          completedDue14d: inputs.completedDue14d,
          missedDue7d: inputs.missedDue7d,
          missedDue14d: inputs.missedDue14d,
          currentCheckInLatencyHours: inputs.currentCheckInLatencyHours,
          baselineCheckInLatencyHours: inputs.baselineCheckInLatencyHours,
          baselineCheckInCount: inputs.baselineCheckInCount,
          daysSinceOpen: inputs.daysSinceOpen,
        });
        const state = new AccountabilityState({
          tier: current.state.tier,
          owner: current.state.owner,
          automationPaused: current.state.automationPaused,
          churnFlagged: current.state.churnFlagged,
          version: current.state.version,
        }).transition(tier);
        const nextState = state.snapshot();
        const lastAutomatedSent = current.messages
          .flatMap((message) =>
            message.actor === "agent" && message.status === "sent" && message.sentAt !== null
              ? [new Date(message.sentAt)]
              : [],
          )
          .sort((left, right) => right.valueOf() - left.valueOf())[0];
        const automatedSendAllowed =
          tier === 1 &&
          nextState.owner !== "coach" &&
          canSendAutomatedMessage(lastAutomatedSent ?? null, context.effectiveAt);

        if (tier === 0 || tier === 4) {
          return this.dependencies.accountability.commitDecision({
            clientId,
            inputs,
            tier,
            nextState,
            draftedContent: null,
            automatedSendAllowed: false,
            traceId: null,
            runId: null,
            context,
          });
        }

        const assembled = await this.dependencies.assembler.assemble({
          kind: "accountability",
          clientId,
          effectiveAt: context.effectiveAt,
        });
        await this.dependencies.traces.persistBeforeModel(assembled.trace);
        try {
          const output = accountabilityModelOutputSchema.parse(
            await this.dependencies.gateway.draftAccountability(assembled.trace, tier),
          );
          if (output.tier !== tier) {
            throw new ApplicationError(
              "model_output_invalid",
              "Accountability output cannot select a different tier.",
            );
          }
          const gates = z
            .array(gateResultSchema)
            .parse(
              await this.dependencies.evaluation.runGates(
                "accountability",
                assembled.trace,
                output,
              ),
            );
          if (gates.some((gate) => !gate.passed)) {
            throw new ApplicationError(
              "model_output_invalid",
              "Accountability content failed a blocking safety gate.",
            );
          }
          const judges = z
            .array(judgeResultSchema)
            .parse(
              await this.dependencies.evaluation.runJudges(
                "accountability",
                assembled.trace,
                output,
              ),
            );
          const runId = await this.dependencies.audit.recordSuccess({
            kind: "accountability",
            traceId: assembled.trace.id,
            output,
            gates,
            judges,
            context,
          });
          return await this.dependencies.accountability.commitDecision({
            clientId,
            inputs,
            tier,
            nextState,
            draftedContent: output.body,
            automatedSendAllowed,
            traceId: assembled.trace.id,
            runId,
            context,
          });
        } catch (error: unknown) {
          await this.dependencies.audit.recordFailure({
            kind: "accountability",
            traceId: assembled.trace.id,
            errorCode: error instanceof ApplicationError ? error.code : "model_output_invalid",
            context,
          });
          throw error;
        }
      },
    );
    return accountabilityDetailSchema.parse(result);
  }
}
