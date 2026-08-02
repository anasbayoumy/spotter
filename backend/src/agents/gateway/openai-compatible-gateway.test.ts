import { describe, expect, it, vi } from "vitest";

import { type LiveModelTransportRequest } from "./live-gateway.js";
import {
  agentOutputDescription,
  OpenAICompatibleModelGateway,
} from "./openai-compatible-gateway.js";
import { ModelRunTelemetryStore } from "./model-run-telemetry.js";
import { OpenAICompatibleTransport } from "./openai-compatible-transport.js";

describe("OpenAI-compatible model gateway", () => {
  it("selects the existing contract for every intent and starts run telemetry", async () => {
    const generate = vi
      .spyOn(OpenAICompatibleTransport.prototype, "generate")
      .mockImplementation((request: LiveModelTransportRequest) =>
        Promise.resolve({
          output: { requestModel: request.model },
          usage: { costUsd: 0, inputTokens: 1, outputTokens: 1 },
        }),
      );
    const telemetry = new ModelRunTelemetryStore();
    const gateway = new OpenAICompatibleModelGateway({
      apiKey: "test-key",
      baseUrl: "http://model.test/v1",
      modelId: " generator-a ",
      telemetry,
    });

    expect(agentOutputDescription("programme")).toMatch(/"payload"/u);
    expect(agentOutputDescription("adjustment")).toMatch(/"operations"/u);
    expect(agentOutputDescription("accountability")).toMatch(/"kind"/u);
    await expect(
      gateway.generate({
        context: "assembled context",
        intent: "accountability",
        promptVersion: "v1",
        recordingKey: "accountability.tier-1",
        signal: new AbortController().signal,
        system: "accountability prompt",
        traceId: "trace-live",
      }),
    ).resolves.toEqual({
      output: { requestModel: "generator-a" },
      usage: { costUsd: 0, inputTokens: 1, outputTokens: 1 },
    });
    expect(generate).toHaveBeenCalledOnce();
    const transportRequest = generate.mock.calls[0]?.[0];
    expect(transportRequest).toBeDefined();
    expect(transportRequest?.signal).toBeInstanceOf(AbortSignal);
    expect({
      context: transportRequest?.context,
      model: transportRequest?.model,
      system: transportRequest?.system,
    }).toEqual({
      context: "assembled context",
      model: "generator-a",
      system: "accountability prompt",
    });
    expect(gateway.takeSchemaTelemetry("trace-live")).toEqual({
      schemaFailure: false,
      schemaRetryCount: 0,
    });
  });
});
