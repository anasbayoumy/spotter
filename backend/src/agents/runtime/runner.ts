import type { ContextSourceInput } from "../context/types";
import type { DeterministicContextAssembler } from "../context/assemble";
import { AgentRuntimeError, toAgentRuntimeError } from "../errors";
import type { ModelGateway } from "../gateway/model-gateway";
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
      await this.runPort.create(
        Object.freeze({
          id: runId,
          attemptKey: request.attemptKey,
          agent: request.intent,
          mode: this.gateway.mode,
          promptVersion: prompt.version,
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
      await this.runPort.create(
        Object.freeze({
          id: runId,
          attemptKey: request.attemptKey,
          agent: request.intent,
          mode: this.gateway.mode,
          promptVersion: prompt.version,
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
