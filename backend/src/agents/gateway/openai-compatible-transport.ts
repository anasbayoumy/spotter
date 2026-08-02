import { APICallError, generateText, type LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

import type { ModelGatewayResponse } from "./model-gateway";
import {
  LiveTransportError,
  type LiveModelTransport,
  type LiveModelTransportRequest,
} from "./live-gateway";

export interface SchemaTelemetry {
  readonly schemaFailure: boolean;
  readonly schemaRetryCount: 0 | 1;
}

interface TextGenerationResult {
  readonly text: string;
  readonly usage: Readonly<{
    inputTokens?: number;
    outputTokens?: number;
  }>;
}

interface TextGenerationRequest {
  readonly abortSignal: AbortSignal;
  readonly model: LanguageModel;
  readonly prompt: string;
  readonly system: string;
}

export type TextGenerator = (request: TextGenerationRequest) => Promise<TextGenerationResult>;

export interface OpenAICompatibleTransportOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly outputSchema: z.ZodType;
  readonly outputDescription?: string;
  readonly schemaName: string;
  readonly onRawResponse?: (rawResponse: string) => void;
  readonly onSchemaTelemetry?: (telemetry: SchemaTelemetry) => void;
  readonly textGenerator?: TextGenerator;
  readonly modelFactory?: (modelId: string) => LanguageModel;
}

const networkErrorCodes = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const code: unknown = Reflect.get(error, "code");
  if (typeof code === "string") return code;
  return errorCode(Reflect.get(error, "cause"));
}

function statusCode(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) return error.statusCode;
  if (error === null || typeof error !== "object") return undefined;
  const status: unknown = Reflect.get(error, "statusCode") ?? Reflect.get(error, "status");
  return typeof status === "number" ? status : undefined;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function mapOpenAICompatibleError(error: unknown): LiveTransportError {
  const status = statusCode(error);
  if (status !== undefined) {
    const retryable = status === 429 || status >= 500;
    return new LiveTransportError("The model endpoint rejected the request", retryable, {
      cause: error,
    });
  }
  const retryable =
    (APICallError.isInstance(error) && error.isRetryable) ||
    error instanceof TypeError ||
    networkErrorCodes.has(errorCode(error) ?? "");
  return new LiveTransportError("The model endpoint could not be reached", retryable, {
    cause: error,
  });
}

function validationMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 20)
      .map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`)
      .join("; ")
      .slice(0, 4_000);
  }
  if (error instanceof SyntaxError) return error.message.slice(0, 1_000);
  return "The response was not valid JSON for the required output schema.";
}

function parseJson(text: string, schema: z.ZodType): unknown {
  const parsed: unknown = JSON.parse(text.trim());
  return schema.parse(parsed);
}

const defaultTextGenerator: TextGenerator = async (request) => {
  const result = await generateText({
    abortSignal: request.abortSignal,
    maxRetries: 0,
    model: request.model,
    prompt: request.prompt,
    system: request.system,
  });
  return {
    text: result.text,
    usage: {
      ...(result.totalUsage.inputTokens === undefined
        ? {}
        : { inputTokens: result.totalUsage.inputTokens }),
      ...(result.totalUsage.outputTokens === undefined
        ? {}
        : { outputTokens: result.totalUsage.outputTokens }),
    },
  };
};

export class OpenAICompatibleTransport implements LiveModelTransport {
  readonly #modelFactory: (modelId: string) => LanguageModel;
  readonly #textGenerator: TextGenerator;

  public constructor(private readonly options: OpenAICompatibleTransportOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/u, "");
    const apiKey = options.apiKey.trim();
    const schemaName = options.schemaName.trim();
    if (!baseUrl || !apiKey || !schemaName) {
      throw new LiveTransportError("Invalid OpenAI-compatible transport configuration", false);
    }
    const provider = createOpenAICompatible({
      apiKey,
      baseURL: baseUrl,
      name: "spotter-openai-compatible",
      supportsStructuredOutputs: false,
    });
    this.#modelFactory = options.modelFactory ?? ((modelId) => provider.chatModel(modelId));
    this.#textGenerator = options.textGenerator ?? defaultTextGenerator;
  }

  public async generate(request: LiveModelTransportRequest): Promise<ModelGatewayResponse> {
    const schemaDescription =
      this.options.outputDescription ??
      JSON.stringify(z.toJSONSchema(this.options.outputSchema, { unrepresentable: "any" }));
    const instruction = [
      request.context,
      "",
      "Return exactly one JSON value and nothing else.",
      "Do not use Markdown fences, prose, comments, tools, or native JSON/schema mode.",
      `The response must validate as ${this.options.schemaName} against this JSON Schema:`,
      schemaDescription,
    ].join("\n");
    let validationError = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for (let schemaAttempt = 0; schemaAttempt < 2; schemaAttempt += 1) {
      if (request.signal.aborted) {
        throw new DOMException("The model request was aborted", "AbortError");
      }
      const prompt =
        schemaAttempt === 0
          ? instruction
          : [
              instruction,
              "",
              "Your previous response failed validation.",
              `Validation error: ${validationError}`,
              "Correct the response and return JSON only.",
            ].join("\n");
      let generated: TextGenerationResult;
      try {
        generated = await this.#textGenerator({
          abortSignal: request.signal,
          model: this.#modelFactory(request.model),
          prompt,
          system: request.system,
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw new DOMException("The model request was aborted", "AbortError");
        }
        this.options.onSchemaTelemetry?.({
          schemaFailure: false,
          schemaRetryCount: schemaAttempt === 0 ? 0 : 1,
        });
        throw mapOpenAICompatibleError(error);
      }
      this.options.onRawResponse?.(generated.text);
      inputTokens += generated.usage.inputTokens ?? 0;
      outputTokens += generated.usage.outputTokens ?? 0;
      try {
        const output = parseJson(generated.text, this.options.outputSchema);
        this.options.onSchemaTelemetry?.({
          schemaFailure: false,
          schemaRetryCount: schemaAttempt === 0 ? 0 : 1,
        });
        return {
          output,
          usage: { costUsd: 0, inputTokens, outputTokens },
        };
      } catch (error) {
        validationError = validationMessage(error);
        if (schemaAttempt === 1) {
          this.options.onSchemaTelemetry?.({ schemaFailure: true, schemaRetryCount: 1 });
          throw new LiveTransportError(
            `Model output failed ${this.options.schemaName} validation after one correction`,
            false,
            { cause: error },
          );
        }
      }
    }
    throw new LiveTransportError("Model output validation failed", false);
  }
}
