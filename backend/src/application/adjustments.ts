import {
  adjustmentModelOutputSchema,
  adjustmentSchema,
  gateResultSchema,
  judgeResultSchema,
  programmeSchema,
  type Adjustment,
  type Programme,
} from "@spotter/contracts";
import { z } from "zod";

import {
  ApplicationError,
  executeIdempotently,
  type ExecutionContext,
  type FingerprintPort,
  type IdempotencyPort,
} from "./core";
import type {
  AdjustmentPort,
  AgentAuditPort,
  ContextAssemblerPort,
  EvaluationPort,
  ModelGatewayPort,
  TracePort,
} from "./ports";
import { reviewBandFromResults } from "./evaluation";

interface IdempotentDependencies {
  readonly idempotency: IdempotencyPort;
  readonly fingerprint: FingerprintPort;
}

interface GenerationDependencies extends IdempotentDependencies {
  readonly adjustments: AdjustmentPort;
  readonly assembler: ContextAssemblerPort;
  readonly traces: TracePort;
  readonly gateway: ModelGatewayPort;
  readonly evaluation: EvaluationPort;
  readonly audit: AgentAuditPort;
}

export class GenerateAdjustment {
  public constructor(private readonly dependencies: GenerationDependencies) {}

  public async execute(
    input: { readonly clientId: string; readonly sourceEventKey?: string },
    context: ExecutionContext,
  ): Promise<Adjustment> {
    const result = await executeIdempotently(
      this.dependencies,
      context,
      "adjustment.generate",
      input,
      async () => {
        const source = await this.dependencies.adjustments.resolveGenerationInput({
          clientId: input.clientId,
          sourceEventKey: input.sourceEventKey,
          actorId: context.actorId,
        });
        if (source === undefined) {
          throw new ApplicationError(
            "invalid_state_transition",
            "No current programme or eligible adjustment trigger exists.",
          );
        }
        const assembled = await this.dependencies.assembler.assemble({
          kind: "adjustment",
          clientId: input.clientId,
          effectiveAt: context.effectiveAt,
        });
        await this.dependencies.traces.persistBeforeModel(assembled.trace);
        try {
          const output = adjustmentModelOutputSchema.parse(
            await this.dependencies.gateway.generateAdjustment(assembled.trace),
          );
          const gates = z
            .array(gateResultSchema)
            .parse(
              await this.dependencies.evaluation.runGates("adjustment", assembled.trace, output),
            );
          const judges = z
            .array(judgeResultSchema)
            .parse(
              await this.dependencies.evaluation.runJudges("adjustment", assembled.trace, output),
            );
          const band = reviewBandFromResults(gates, judges);
          const runId = await this.dependencies.audit.recordSuccess({
            kind: "adjustment",
            traceId: assembled.trace.id,
            output,
            gates,
            judges,
            context,
          });
          return await this.dependencies.adjustments.queueGenerated({
            clientId: input.clientId,
            baseProgrammeId: source.baseProgrammeId,
            sourceEventKey: source.sourceEventKey,
            trigger: source.trigger,
            output,
            band,
            traceId: assembled.trace.id,
            runId,
            gates,
            judges,
            context,
          });
        } catch (error: unknown) {
          await this.dependencies.audit.recordFailure({
            kind: "adjustment",
            traceId: assembled.trace.id,
            errorCode: error instanceof z.ZodError ? "model_output_invalid" : "model_run_failed",
            context,
          });
          if (error instanceof z.ZodError) {
            throw new ApplicationError(
              "model_output_invalid",
              "Adjustment output did not match the required schema.",
              {},
              { cause: error },
            );
          }
          throw error;
        }
      },
    );
    return adjustmentSchema.parse(result);
  }
}

export class ApproveAdjustment {
  public constructor(
    private readonly adjustments: AdjustmentPort,
    private readonly idempotent: IdempotentDependencies,
  ) {}

  public async execute(
    adjustmentId: string,
    input: { readonly expectedVersion: number; readonly reason?: string },
    context: ExecutionContext,
  ): Promise<Programme> {
    const current = await this.adjustments.get(adjustmentId);
    if (current === undefined)
      throw new ApplicationError("not_found", "Adjustment does not exist.");
    if (current.version !== input.expectedVersion)
      throw new ApplicationError("version_conflict", "Adjustment version changed.");
    if (current.status !== "queued")
      throw new ApplicationError(
        "invalid_state_transition",
        "Only queued adjustments can be approved.",
      );
    const result = await executeIdempotently(
      this.idempotent,
      context,
      "adjustment.approve",
      { adjustmentId, ...input },
      () =>
        this.adjustments.approve({
          adjustmentId,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
          context,
        }),
    );
    return programmeSchema.parse(result);
  }
}

export class RejectAdjustment {
  public constructor(
    private readonly adjustments: AdjustmentPort,
    private readonly idempotent: IdempotentDependencies,
  ) {}

  public async execute(
    adjustmentId: string,
    input: { readonly expectedVersion: number; readonly reason?: string },
    context: ExecutionContext,
  ): Promise<Adjustment> {
    const result = await executeIdempotently(
      this.idempotent,
      context,
      "adjustment.reject",
      { adjustmentId, ...input },
      () =>
        this.adjustments.reject({
          adjustmentId,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
          context,
        }),
    );
    return adjustmentSchema.parse(result);
  }
}
