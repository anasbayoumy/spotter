import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { PromptRegistry } from "../prompts/registry.js";
import { LiveModelGateway, LiveTransportError } from "./live-gateway.js";
import type { ModelGatewayRequest } from "./model-gateway.js";
import { modelRecordingSchema, RecordedModelGateway } from "./recorded-gateway.js";

const manifestSchema = z
  .object({ schemaVersion: z.literal(1), recordings: z.array(modelRecordingSchema) })
  .strict();

async function recordings(): Promise<readonly unknown[]> {
  const text = await readFile(
    new URL("../../../../fixtures/recordings/recordings.json", import.meta.url),
    "utf8",
  );
  const value: unknown = JSON.parse(text);
  return manifestSchema.parse(value).recordings;
}

function request(overrides: Partial<ModelGatewayRequest> = {}): ModelGatewayRequest {
  const prompt = new PromptRegistry().get("programme");
  return {
    intent: "programme",
    recordingKey: "programme.baseline",
    traceId: "00000000-0000-4000-8000-000000000901",
    promptVersion: prompt.version,
    system: prompt.system,
    context: "synthetic context",
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("model gateways", () => {
  it("loads validated recordings and returns defensive output copies", async () => {
    const gateway = new RecordedModelGateway(await recordings());
    const first = await gateway.generate(request());
    const second = await gateway.generate(request());
    expect(first.output).toEqual(second.output);
    expect(first.output).not.toBe(second.output);
    expect(gateway.mode).toBe("recorded");
  });

  it("fails rather than falling back when a recording or prompt version is missing", async () => {
    const gateway = new RecordedModelGateway(await recordings());
    await expect(gateway.generate(request({ recordingKey: "missing" }))).rejects.toMatchObject({
      code: "recording_not_found",
    });
    await expect(
      gateway.generate(request({ promptVersion: `sha256:${"0".repeat(64)}` })),
    ).rejects.toMatchObject({
      code: "recording_prompt_mismatch",
    });
  });

  it("rejects duplicate recordings, aborted replay, and invalid live configuration", async () => {
    const values = await recordings();
    const first = values[0];
    if (first === undefined) throw new Error("The recording fixture must not be empty");
    expect(() => new RecordedModelGateway([first, first])).toThrow(/Duplicate recording/u);
    const gateway = new RecordedModelGateway(values);
    const controller = new AbortController();
    controller.abort();
    await expect(gateway.generate(request({ signal: controller.signal }))).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(
      () => new LiveModelGateway({ generate: vi.fn() }, { modelId: "", maxAttempts: 4 }),
    ).toThrow(/Invalid live gateway/u);
  });

  it("retries only bounded retryable live failures and exposes no tool surface", async () => {
    const transport = {
      generate: vi
        .fn()
        .mockRejectedValueOnce(new LiveTransportError("rate limited", true))
        .mockResolvedValueOnce({ output: { valid: true }, usage: null }),
    };
    const sleeper = { wait: vi.fn().mockResolvedValue(undefined) };
    const gateway = new LiveModelGateway(
      transport,
      { modelId: "independent-generator", maxAttempts: 2, retryDelayMilliseconds: 1 },
      sleeper,
    );
    await expect(gateway.generate(request())).resolves.toMatchObject({ output: { valid: true } });
    expect(transport.generate).toHaveBeenCalledTimes(2);
    expect(sleeper.wait).toHaveBeenCalledTimes(1);
    expect(transport.generate.mock.calls[0]?.[0]).not.toHaveProperty("tools");
  });

  it("does not retry non-retryable live failures", async () => {
    const transport = {
      generate: vi.fn().mockRejectedValue(new LiveTransportError("bad request", false)),
    };
    const sleeper = { wait: vi.fn().mockResolvedValue(undefined) };
    const gateway = new LiveModelGateway(
      transport,
      { modelId: "generator", maxAttempts: 3 },
      sleeper,
    );
    await expect(gateway.generate(request())).rejects.toMatchObject({
      code: "dependency_unavailable",
      retryable: false,
    });
    expect(transport.generate).toHaveBeenCalledTimes(1);
    expect(sleeper.wait).not.toHaveBeenCalled();
  });
});
