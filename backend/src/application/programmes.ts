import {
  gateResultSchema,
  judgeResultSchema,
  programmeModelOutputSchema,
  programmePayloadSchema,
  programmeReviewSchema,
  programmeSchema,
  type Programme,
  type ProgrammePayload,
  type ProgrammeReview,
} from "@spotter/contracts";
import { z } from "zod";

import { DomainError } from "../domain/index.js";
import {
  ApplicationError,
  executeIdempotently,
  type ExecutionContext,
  type FingerprintPort,
  type IdempotencyPort,
} from "./core.js";
import type {
  AgentAuditPort,
  ContextAssemblerPort,
  EvaluationPort,
  ModelGatewayPort,
  ProgrammePort,
  TracePort,
} from "./ports.js";
import { reviewBandFromResults } from "./evaluation.js";

interface IdempotentDependencies {
  readonly idempotency: IdempotencyPort;
  readonly fingerprint: FingerprintPort;
}

interface GenerationDependencies extends IdempotentDependencies {
  readonly assembler: ContextAssemblerPort;
  readonly traces: TracePort;
  readonly gateway: ModelGatewayPort;
  readonly evaluation: EvaluationPort;
  readonly audit: AgentAuditPort;
  readonly programmes: ProgrammePort;
}

function errorCode(error: unknown): string {
  if (error instanceof ApplicationError || error instanceof DomainError) return error.code;
  if (error instanceof z.ZodError) return "model_output_invalid";
  return "internal_error";
}

export class GenerateProgramme {
  public constructor(private readonly dependencies: GenerationDependencies) {}

  public async execute(
    input: { readonly clientId: string; readonly targetWeekStart: string },
    context: ExecutionContext,
  ): Promise<ProgrammeReview> {
    const result = await executeIdempotently(
      this.dependencies,
      context,
      "programme.generate",
      input,
      async () => {
        const assembled = await this.dependencies.assembler.assemble({
          kind: "programme",
          clientId: input.clientId,
          effectiveAt: context.effectiveAt,
          targetWeekStart: input.targetWeekStart,
        });
        await this.dependencies.traces.persistBeforeModel(assembled.trace);
        try {
          const output = programmeModelOutputSchema.parse(
            await this.dependencies.gateway.generateProgramme(assembled.trace),
          );
          const gates = z
            .array(gateResultSchema)
            .parse(
              await this.dependencies.evaluation.runGates("programme", assembled.trace, output),
            );
          const judges = z
            .array(judgeResultSchema)
            .parse(
              await this.dependencies.evaluation.runJudges("programme", assembled.trace, output),
            );
          const band = reviewBandFromResults(gates, judges);
          const runId = await this.dependencies.audit.recordSuccess({
            kind: "programme",
            traceId: assembled.trace.id,
            output,
            gates,
            judges,
            context,
          });
          return await this.dependencies.programmes.queueGenerated({
            clientId: input.clientId,
            payload: output.payload,
            band,
            traceId: assembled.trace.id,
            runId,
            gates,
            judges,
            context,
          });
        } catch (error: unknown) {
          await this.dependencies.audit.recordFailure({
            kind: "programme",
            traceId: assembled.trace.id,
            errorCode: errorCode(error),
            context,
          });
          if (error instanceof z.ZodError) {
            throw new ApplicationError(
              "model_output_invalid",
              "Programme output did not match the required schema.",
              {},
              { cause: error },
            );
          }
          throw error;
        }
      },
    );
    return programmeReviewSchema.parse(result);
  }
}

interface EditDependencies {
  readonly programmes: ProgrammePort;
  readonly traces: TracePort;
  readonly evaluation: EvaluationPort;
}

export class EditProgrammeProposal {
  public constructor(private readonly dependencies: EditDependencies) {}

  public async execute(
    programmeId: string,
    input: { readonly payload: ProgrammePayload; readonly expectedVersion: number },
    context: ExecutionContext,
  ): Promise<ProgrammeReview> {
    const existing = await this.dependencies.programmes.getReview(programmeId);
    if (existing === undefined)
      throw new ApplicationError("programme_not_found", "Programme does not exist.");
    if (existing.programme.version !== input.expectedVersion)
      throw new ApplicationError("version_conflict", "Programme version changed.");
    if (existing.programme.status === "rejected" || existing.programme.status === "superseded") {
      throw new ApplicationError(
        "invalid_state_transition",
        "This programme can no longer be edited.",
      );
    }
    const payload = programmePayloadSchema.parse(input.payload);
    const trace = await this.dependencies.traces.get(existing.traceId);
    if (trace === undefined)
      throw new ApplicationError("dependency_unavailable", "Programme trace is unavailable.");
    const output = programmeModelOutputSchema.parse({ payload, citations: existing.citations });
    const gates = z
      .array(gateResultSchema)
      .parse(await this.dependencies.evaluation.runGates("programme", trace, output));
    const band = reviewBandFromResults(gates, existing.judges);
    return this.dependencies.programmes.edit({
      programmeId,
      payload,
      expectedVersion: input.expectedVersion,
      gates,
      band,
      context,
    });
  }
}

export class ApproveProgramme {
  public constructor(
    private readonly programmes: ProgrammePort,
    private readonly idempotent: IdempotentDependencies,
  ) {}

  public execute(
    programmeId: string,
    input: { readonly expectedVersion: number },
    context: ExecutionContext,
  ): Promise<Programme> {
    return this.publish("standard", programmeId, input.expectedVersion, undefined, context);
  }

  protected async publish(
    approval: "standard" | "override",
    programmeId: string,
    expectedVersion: number,
    reason: string | undefined,
    context: ExecutionContext,
  ): Promise<Programme> {
    const review = await this.programmes.getReview(programmeId);
    if (review === undefined)
      throw new ApplicationError("programme_not_found", "Programme does not exist.");
    if (review.programme.version !== expectedVersion)
      throw new ApplicationError("version_conflict", "Programme version changed.");
    if (review.programme.status !== "queued")
      throw new ApplicationError(
        "invalid_state_transition",
        "Only queued programmes can be published.",
      );
    if (approval === "standard" && review.programme.reviewBand === "blocked") {
      throw new ApplicationError(
        "blocked_requires_override",
        "Blocked programme requires an override.",
      );
    }
    if (approval === "override") {
      if (review.programme.reviewBand !== "blocked")
        throw new ApplicationError(
          "invalid_state_transition",
          "Only blocked programmes can be overridden.",
        );
      if (reason === undefined || reason.trim().length === 0)
        throw new ApplicationError("override_reason_required", "Override requires a reason.");
    }
    const result = await executeIdempotently(
      this.idempotent,
      context,
      `programme.${approval}`,
      { programmeId, expectedVersion, reason },
      () => this.programmes.publish({ programmeId, expectedVersion, approval, reason, context }),
    );
    return programmeSchema.parse(result);
  }
}

export class OverrideBlockedProgramme extends ApproveProgramme {
  public executeOverride(
    programmeId: string,
    input: { readonly expectedVersion: number; readonly reason: string },
    context: ExecutionContext,
  ): Promise<Programme> {
    return this.publish("override", programmeId, input.expectedVersion, input.reason, context);
  }
}

export class RejectProgramme {
  public constructor(
    private readonly programmes: ProgrammePort,
    private readonly idempotent: IdempotentDependencies,
  ) {}

  public async execute(
    programmeId: string,
    input: { readonly expectedVersion: number; readonly reason?: string },
    context: ExecutionContext,
  ): Promise<Programme> {
    const result = await executeIdempotently(
      this.idempotent,
      context,
      "programme.reject",
      { programmeId, ...input },
      () =>
        this.programmes.reject({
          programmeId,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
          context,
        }),
    );
    return programmeSchema.parse(result);
  }
}
