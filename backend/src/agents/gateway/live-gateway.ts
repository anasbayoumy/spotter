import { AgentRuntimeError } from "../errors.js";
import type { ModelGateway, ModelGatewayRequest, ModelGatewayResponse } from "./model-gateway.js";

export interface LiveModelTransportRequest {
  readonly model: string;
  readonly system: string;
  readonly context: string;
  readonly signal: AbortSignal;
}

export interface LiveModelTransport {
  generate(request: LiveModelTransportRequest): Promise<ModelGatewayResponse>;
}

export interface RetrySleeper {
  wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export class LiveTransportError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LiveTransportError";
  }
}

class TimerSleeper implements RetrySleeper {
  public async wait(milliseconds: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, milliseconds);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("The retry wait was aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
}

export interface LiveGatewayOptions {
  readonly modelId: string;
  readonly maxAttempts?: number;
  readonly retryDelayMilliseconds?: number;
}

export class LiveModelGateway implements ModelGateway {
  public readonly mode = "live" as const;
  public readonly modelId: string;
  readonly #maxAttempts: number;
  readonly #retryDelayMilliseconds: number;

  public constructor(
    private readonly transport: LiveModelTransport,
    options: LiveGatewayOptions,
    private readonly sleeper: RetrySleeper = new TimerSleeper(),
  ) {
    this.modelId = options.modelId.trim();
    this.#maxAttempts = options.maxAttempts ?? 2;
    this.#retryDelayMilliseconds = options.retryDelayMilliseconds ?? 100;
    if (!this.modelId || this.#maxAttempts < 1 || this.#maxAttempts > 3) {
      throw new AgentRuntimeError("validation_failed", "Invalid live gateway configuration", false);
    }
  }

  public async generate(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        return await this.transport.generate({
          model: this.modelId,
          system: request.system,
          context: request.context,
          signal: request.signal,
        });
      } catch (error) {
        if (request.signal.aborted) throw new DOMException("The request was aborted", "AbortError");
        const retryable = error instanceof LiveTransportError && error.retryable;
        if (!retryable || attempt === this.#maxAttempts) {
          throw new AgentRuntimeError(
            "dependency_unavailable",
            "The live model request failed",
            retryable,
          );
        }
        await this.sleeper.wait(this.#retryDelayMilliseconds * attempt, request.signal);
      }
    }
    throw new AgentRuntimeError("dependency_unavailable", "The live model request failed", false);
  }
}
