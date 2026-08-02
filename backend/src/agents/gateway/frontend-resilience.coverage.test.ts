import { programmeModelOutputSchema } from "@spotter/contracts";
import { describe, expect, it, vi } from "vitest";

import { PromptRegistry } from "../prompts/registry.js";
import { LiveModelGateway, LiveTransportError, type RetrySleeper } from "./live-gateway.js";
import type { ModelGatewayRequest } from "./model-gateway.js";
import { RecordedModelGateway } from "./recorded-gateway.js";

function gatewayRequest(recordingKey = "missing.recording"): ModelGatewayRequest {
  const prompt = new PromptRegistry().get("programme");
  return {
    context: "Synthetic resilience context.",
    intent: "programme",
    promptVersion: prompt.version,
    recordingKey,
    signal: new AbortController().signal,
    system: prompt.system,
    traceId: "00000000-0000-4000-8000-000000000901",
  };
}

describe("model resilience boundaries", () => {
  it("fails visibly on a missing recorded fixture without live-network fallback", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(new RecordedModelGateway([]).generate(gatewayRequest())).rejects.toMatchObject({
      code: "recording_not_found",
      retryable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("bounds transient live-provider retries and then recovers", async () => {
    const response = { output: { ok: true }, usage: null };
    const transport = {
      generate: vi
        .fn()
        .mockRejectedValueOnce(new LiveTransportError("provider 429 body: private", true))
        .mockRejectedValueOnce(new LiveTransportError("provider 503 body: private", true))
        .mockResolvedValueOnce(response),
    };
    const wait = vi.fn<RetrySleeper["wait"]>().mockResolvedValue(undefined);
    const sleeper: RetrySleeper = { wait };
    const gateway = new LiveModelGateway(
      transport,
      { maxAttempts: 3, modelId: "synthetic-live-model", retryDelayMilliseconds: 5 },
      sleeper,
    );
    await expect(gateway.generate(gatewayRequest())).resolves.toBe(response);
    expect(transport.generate).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([5, 10]);
  });

  it("rejects malformed and extra-field model output before persistence", () => {
    const valid = {
      citations: [
        {
          claim: "Synthetic resilience fixture uses the stored goal.",
          recordIds: ["00000000-0000-4000-8000-000000000101"],
          sectionId: "ctx-02-goal-profile-equipment-schedule",
        },
      ],
      payload: {
        days: [
          {
            dayIndex: 1,
            exercises: [
              {
                family: "horizontal_pull",
                id: "00000000-0000-4000-8000-000000000301",
                muscleGroups: ["back"],
                name: "Synthetic row",
                notes: null,
                reps: 8,
                restSeconds: 90,
                rpe: 7,
                sets: 4,
              },
            ],
            focus: "Synthetic resilience",
            scheduledDate: "2026-08-03",
          },
        ],
        summary: "Synthetic programme.",
      },
    };
    expect(programmeModelOutputSchema.safeParse(valid).success).toBe(true);
    expect(programmeModelOutputSchema.safeParse({ ...valid, autoPublish: true }).success).toBe(
      false,
    );
    expect(
      programmeModelOutputSchema.safeParse({ ...valid, payload: { ...valid.payload, days: [] } })
        .success,
    ).toBe(false);
  });
});
