import { describe, expect, it, vi } from "vitest";

import { PromptRegistry } from "../prompts/registry.js";
import { LiveModelGateway, LiveTransportError } from "./live-gateway.js";
import type { ModelGatewayRequest } from "./model-gateway.js";
import { RecordedModelGateway } from "./recorded-gateway.js";

function request(signal = new AbortController().signal): ModelGatewayRequest {
  const prompt = new PromptRegistry().get("programme");
  return {
    intent: "programme",
    recordingKey: "edge.recording",
    traceId: "00000000-0000-4000-8000-000000000901",
    promptVersion: prompt.version,
    system: prompt.system,
    context: "edge context",
    signal,
  };
}

describe("model gateway edge cases", () => {
  it("uses the explicit empty-recording identity and validates every recording", () => {
    expect(new RecordedModelGateway([]).modelId).toBe("recorded-model");
    expect(
      () =>
        new RecordedModelGateway([
          {
            schemaVersion: 1,
            id: "invalid",
            key: "edge.recording",
            intent: "programme",
            promptVersion: "not-a-digest",
            model: "fixture-model",
            output: null,
            usage: null,
          },
        ]),
    ).toThrow();
  });

  it("validates each live attempt bound independently", () => {
    const transport = { generate: vi.fn() };
    for (const options of [
      { modelId: "gateway", maxAttempts: 0 },
      { modelId: "gateway", maxAttempts: 4 },
      { modelId: "   ", maxAttempts: 1 },
    ]) {
      expect(() => new LiveModelGateway(transport, options)).toThrowError(
        "Invalid live gateway configuration",
      );
    }
  });

  it("trims the model id and forwards an exact request with default options", async () => {
    const response = { output: { status: "ok" }, usage: null };
    const transport = { generate: vi.fn().mockResolvedValue(response) };
    const gateway = new LiveModelGateway(transport, { modelId: "  edge-model  " });
    const input = request();

    await expect(gateway.generate(input)).resolves.toBe(response);
    expect(gateway.modelId).toBe("edge-model");
    expect(transport.generate).toHaveBeenCalledWith({
      model: "edge-model",
      system: input.system,
      context: input.context,
      signal: input.signal,
    });
  });

  it("uses the default timer sleeper before a bounded retry", async () => {
    const transport = {
      generate: vi
        .fn()
        .mockRejectedValueOnce(new LiveTransportError("transient", true))
        .mockResolvedValueOnce({ output: "recovered", usage: null }),
    };
    const gateway = new LiveModelGateway(transport, {
      modelId: "edge-model",
      maxAttempts: 2,
      retryDelayMilliseconds: 1,
    });

    await expect(gateway.generate(request())).resolves.toMatchObject({ output: "recovered" });
    expect(transport.generate).toHaveBeenCalledTimes(2);
  });

  it("cancels the default retry timer when the caller aborts during backoff", async () => {
    const controller = new AbortController();
    const transport = {
      generate: vi.fn().mockRejectedValue(new LiveTransportError("transient", true)),
    };
    const gateway = new LiveModelGateway(transport, {
      modelId: "edge-model",
      maxAttempts: 2,
      retryDelayMilliseconds: 1_000,
    });

    const pending = gateway.generate(request(controller.signal));
    setTimeout(() => {
      controller.abort();
    }, 0);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(transport.generate).toHaveBeenCalledTimes(1);
  });

  it("maps a pre-aborted live request before considering retries", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = {
      generate: vi.fn().mockRejectedValue(new LiveTransportError("transient", true)),
    };
    const sleeper = { wait: vi.fn().mockResolvedValue(undefined) };
    const gateway = new LiveModelGateway(
      transport,
      { modelId: "edge-model", maxAttempts: 2 },
      sleeper,
    );

    await expect(gateway.generate(request(controller.signal))).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(sleeper.wait).not.toHaveBeenCalled();
  });

  it("stops at the configured retry ceiling and preserves retryability", async () => {
    const transport = {
      generate: vi.fn().mockRejectedValue(new LiveTransportError("transient", true)),
    };
    const sleeper = { wait: vi.fn().mockResolvedValue(undefined) };
    const gateway = new LiveModelGateway(
      transport,
      { modelId: "edge-model", maxAttempts: 2, retryDelayMilliseconds: 7 },
      sleeper,
    );

    await expect(gateway.generate(request())).rejects.toMatchObject({
      code: "dependency_unavailable",
      retryable: true,
    });
    expect(transport.generate).toHaveBeenCalledTimes(2);
    expect(sleeper.wait).toHaveBeenCalledOnce();
    expect(sleeper.wait).toHaveBeenCalledWith(7, expect.any(AbortSignal));
  });
});
