import { APICallError, type LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { LiveTransportError, type LiveModelTransportRequest } from "./live-gateway.js";
import {
  mapOpenAICompatibleError,
  OpenAICompatibleTransport,
  type SchemaTelemetry,
  type TextGenerator,
} from "./openai-compatible-transport.js";

const outputSchema = z.object({ answer: z.string().min(1) }).strict();
const model = {} as LanguageModel;

function request(signal = new AbortController().signal): LiveModelTransportRequest {
  return { context: "fixture", model: "model-a", signal, system: "system" };
}

function transport(
  textGenerator: TextGenerator,
  onSchemaTelemetry?: (telemetry: SchemaTelemetry) => void,
): OpenAICompatibleTransport {
  return new OpenAICompatibleTransport({
    apiKey: "test-key",
    baseUrl: "http://model.test/v1",
    modelFactory: () => model,
    ...(onSchemaTelemetry === undefined ? {} : { onSchemaTelemetry }),
    outputSchema,
    schemaName: "test output",
    textGenerator,
  });
}

describe("OpenAI-compatible transport", () => {
  it("requires a complete provider-neutral configuration", () => {
    for (const overrides of [{ apiKey: " " }, { baseUrl: " /// " }, { schemaName: " " }]) {
      try {
        new OpenAICompatibleTransport({
          apiKey: "test-key",
          baseUrl: "http://model.test/v1/",
          modelFactory: () => model,
          outputSchema,
          schemaName: "test output",
          textGenerator: vi.fn<TextGenerator>(),
          ...overrides,
        });
        expect.fail("Incomplete transport configuration must fail closed.");
      } catch (error) {
        expect(error).toBeInstanceOf(LiveTransportError);
        if (!(error instanceof LiveTransportError)) throw error;
        expect(error.retryable).toBe(false);
      }
    }
  });

  it("returns validated JSON, raw-response telemetry, and a generated schema instruction", async () => {
    const generate = vi.fn<TextGenerator>().mockResolvedValue({
      text: '  {"answer":"valid"}  ',
      usage: {},
    });
    const modelFactory = vi.fn(() => model);
    const onRawResponse = vi.fn<(rawResponse: string) => void>();
    const onSchemaTelemetry = vi.fn<(telemetry: SchemaTelemetry) => void>();
    const configured = new OpenAICompatibleTransport({
      apiKey: " test-key ",
      baseUrl: "http://model.test/v1///",
      modelFactory,
      onRawResponse,
      onSchemaTelemetry,
      outputSchema,
      schemaName: "test output",
      textGenerator: generate,
    });

    await expect(configured.generate(request())).resolves.toEqual({
      output: { answer: "valid" },
      usage: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
    });
    expect(modelFactory).toHaveBeenCalledWith("model-a");
    expect(generate.mock.calls[0]?.[0].prompt).toMatch(/Return exactly one JSON value/u);
    expect(generate.mock.calls[0]?.[0].prompt).toMatch(/"answer"/u);
    expect(onRawResponse).toHaveBeenCalledWith('  {"answer":"valid"}  ');
    expect(onSchemaTelemetry).toHaveBeenCalledWith({
      schemaFailure: false,
      schemaRetryCount: 0,
    });
  });

  it("repairs one schema failure and makes the second failure non-retryable", async () => {
    const repairedTelemetry = vi.fn<(telemetry: SchemaTelemetry) => void>();
    const repaired = vi
      .fn<TextGenerator>()
      .mockResolvedValueOnce({ text: "not json", usage: { inputTokens: 2, outputTokens: 1 } })
      .mockResolvedValueOnce({
        text: '{"answer":"ok"}',
        usage: { inputTokens: 3, outputTokens: 2 },
      });
    await expect(transport(repaired, repairedTelemetry).generate(request())).resolves.toEqual({
      output: { answer: "ok" },
      usage: { costUsd: 0, inputTokens: 5, outputTokens: 3 },
    });
    expect(repaired).toHaveBeenCalledTimes(2);
    expect(repaired.mock.calls[1]?.[0].prompt).toMatch(/previous response failed validation/u);
    expect(repairedTelemetry).toHaveBeenLastCalledWith({
      schemaFailure: false,
      schemaRetryCount: 1,
    });

    const invalid = vi.fn<TextGenerator>().mockResolvedValue({ text: '{"wrong":true}', usage: {} });
    const failedTelemetry = vi.fn<(telemetry: SchemaTelemetry) => void>();
    await expect(transport(invalid, failedTelemetry).generate(request())).rejects.toMatchObject({
      retryable: false,
    });
    expect(invalid).toHaveBeenCalledTimes(2);
    expect(failedTelemetry).toHaveBeenLastCalledWith({
      schemaFailure: true,
      schemaRetryCount: 1,
    });
  });

  it("maps 429, 5xx, network, and 4xx failures without adding a retry loop", () => {
    for (const statusCode of [429, 500, 503]) {
      expect(
        mapOpenAICompatibleError(
          new APICallError({
            message: "provider failure",
            requestBodyValues: {},
            statusCode,
            url: "http://model.test/v1/chat/completions",
          }),
        ).retryable,
      ).toBe(true);
    }
    expect(
      mapOpenAICompatibleError(
        new APICallError({
          message: "bad request",
          requestBodyValues: {},
          statusCode: 400,
          url: "http://model.test/v1/chat/completions",
        }),
      ).retryable,
    ).toBe(false);
    expect(mapOpenAICompatibleError(new TypeError("fetch failed")).retryable).toBe(true);
    expect(mapOpenAICompatibleError({ cause: { code: "ECONNREFUSED" } }).retryable).toBe(true);
    expect(mapOpenAICompatibleError({ status: 401 }).retryable).toBe(false);
    expect(mapOpenAICompatibleError({ statusCode: 502 }).retryable).toBe(true);
    expect(mapOpenAICompatibleError(new Error("unknown provider failure")).retryable).toBe(false);
  });

  it("maps generator failures once and records whether they follow a schema retry", async () => {
    const initialTelemetry = vi.fn<(telemetry: SchemaTelemetry) => void>();
    const initialFailure = vi
      .fn<TextGenerator>()
      .mockRejectedValue(Object.assign(new Error("socket"), { code: "ETIMEDOUT" }));
    await expect(
      transport(initialFailure, initialTelemetry).generate(request()),
    ).rejects.toMatchObject({ retryable: true });
    expect(initialFailure).toHaveBeenCalledOnce();
    expect(initialTelemetry).toHaveBeenCalledWith({
      schemaFailure: false,
      schemaRetryCount: 0,
    });

    const repairTelemetry = vi.fn<(telemetry: SchemaTelemetry) => void>();
    const repairFailure = vi
      .fn<TextGenerator>()
      .mockResolvedValueOnce({ text: '{"answer":1}', usage: {} })
      .mockRejectedValueOnce({ status: 400 });
    await expect(
      transport(repairFailure, repairTelemetry).generate(request()),
    ).rejects.toMatchObject({ retryable: false });
    expect(repairFailure).toHaveBeenCalledTimes(2);
    expect(repairFailure.mock.calls[1]?.[0].prompt).toMatch(/answer: Invalid input/u);
    expect(repairTelemetry).toHaveBeenCalledWith({
      schemaFailure: false,
      schemaRetryCount: 1,
    });
  });

  it("honours a signal that was aborted before generation", async () => {
    const controller = new AbortController();
    controller.abort();
    const generate = vi.fn<TextGenerator>();
    await expect(transport(generate).generate(request(controller.signal))).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("preserves aborts instead of mapping or retrying them", async () => {
    const controller = new AbortController();
    const generate = vi.fn<TextGenerator>().mockImplementation(async ({ abortSignal }) => {
      await new Promise<void>((_resolve, reject) => {
        abortSignal.addEventListener(
          "abort",
          () => {
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      });
      throw new LiveTransportError("unreachable", false);
    });
    const pending = transport(generate).generate(request(controller.signal));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(generate).toHaveBeenCalledOnce();

    const errorAbort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const rejectWithError = vi.fn<TextGenerator>().mockRejectedValue(errorAbort);
    await expect(transport(rejectWithError).generate(request())).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
