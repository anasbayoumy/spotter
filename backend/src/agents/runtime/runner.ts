import type { ContextSourceInput } from "../context/types";
import type { DeterministicContextAssembler } from "../context/assemble";
import { AgentRuntimeError, toAgentRuntimeError } from "../errors";
import type { ModelGateway } from "../gateway/model-gateway";
import type { SchemaTelemetry } from "../gateway/openai-compatible-transport";
import type { PromptRegistry } from "../prompts/registry";
import type { AgentClock, AgentIdGenerator, AgentRunPort, ContextTracePort } from "./ports";

export interface AgentExecutionRequest {
  readonly intent: "programme" | "adjustment" | "accountability";
  readonly attemptKey: string;
  readonly recordingKey: string;
  readonly context: ContextSourceInput;
}

export interface AgentRuntimeOptions {
  readonly timeoutMilliseconds?: number;
}

type OutputValidator<Output> = (value: unknown) => Output;

interface SchemaTelemetryGateway extends ModelGateway {
  takeSchemaTelemetry(traceId: string): SchemaTelemetry;
}

function schemaTelemetry(gateway: ModelGateway, traceId: string): SchemaTelemetry {
  if (isSchemaTelemetryGateway(gateway)) return gateway.takeSchemaTelemetry(traceId);
  return { schemaFailure: false, schemaRetryCount: 0 };
}

function isSchemaTelemetryGateway(gateway: ModelGateway): gateway is SchemaTelemetryGateway {
  return "takeSchemaTelemetry" in gateway && typeof gateway.takeSchemaTelemetry === "function";
}

export class AgentRunner {
  readonly #timeoutMilliseconds: number;

  public constructor(
    private readonly assembler: DeterministicContextAssembler,
    private readonly tracePort: ContextTracePort,
    private readonly runPort: AgentRunPort,
    private readonly gateway: ModelGateway,
    private readonly prompts: PromptRegistry,
    private readonly clock: AgentClock,
    private readonly ids: AgentIdGenerator,
    options: AgentRuntimeOptions = {},
  ) {
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000;
    if (this.#timeoutMilliseconds < 1 || this.#timeoutMilliseconds > 120_000) {
      throw new AgentRuntimeError("validation_failed", "Invalid model timeout", false);
    }
  }

  public async execute<Output>(
    request: AgentExecutionRequest,
    validate: OutputValidator<Output>,
  ): Promise<Output> {
    const traceId = this.ids.next();
    const turnId = this.ids.next();
    const assembly = this.assembler.assemble({
      ...request.context,
      traceId,
      turnId,
      intent: request.intent,
      createdAt: this.clock.now().toISOString(),
    });

    await this.tracePort.create(assembly.trace);
    if (assembly.status === "hard_constraint_overflow") {
      throw new AgentRuntimeError(
        "context_hard_constraints_exceed_budget",
        "Active hard constraints exceed the configured context budget",
        false,
      );
    }

    const prompt = this.prompts.get(request.intent);
    const runId = this.ids.next();
    const startedAt = this.clock.monotonicMilliseconds();
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutFailure = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(
            new AgentRuntimeError("model_timeout", "The model request exceeded its deadline", true),
          );
        }, this.#timeoutMilliseconds);
      });
      const response = await Promise.race([
        this.gateway.generate({
          intent: request.intent,
          recordingKey: request.recordingKey,
          traceId,
          promptVersion: prompt.version,
          system: prompt.system,
          context: assembly.trace.rendered,
          signal: controller.signal,
        }),
        timeoutFailure,
      ]);
      const output = validate(response.output);
      const validationTelemetry = schemaTelemetry(this.gateway, traceId);
      await this.runPort.create(
        Object.freeze({
          id: runId,
          attemptKey: request.attemptKey,
          agent: request.intent,
          mode: this.gateway.mode,
          promptVersion: prompt.version,
          schemaFailure: validationTelemetry.schemaFailure,
          schemaRetryCount: validationTelemetry.schemaRetryCount,
          model: this.gateway.modelId,
          traceId,
          usage: response.usage,
          latencyMs: Math.max(0, Math.round(this.clock.monotonicMilliseconds() - startedAt)),
          output: structuredClone(output),
          errorCode: null,
          createdAt: this.clock.now().toISOString(),
        }),
      );
      return output;
    } catch (error) {
      const mapped = toAgentRuntimeError(error);
      const validationTelemetry = schemaTelemetry(this.gateway, traceId);
      await this.runPort.create(
        Object.freeze({
          id: runId,
          attemptKey: request.attemptKey,
          agent: request.intent,
          mode: this.gateway.mode,
          promptVersion: prompt.version,
          schemaFailure:
            validationTelemetry.schemaFailure || mapped.code === "model_output_invalid",
          schemaRetryCount: validationTelemetry.schemaRetryCount,
          model: this.gateway.modelId,
          traceId,
          usage: null,
          latencyMs: Math.max(0, Math.round(this.clock.monotonicMilliseconds() - startedAt)),
          output: null,
          errorCode: mapped.code,
          createdAt: this.clock.now().toISOString(),
        }),
      );
      throw mapped;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
