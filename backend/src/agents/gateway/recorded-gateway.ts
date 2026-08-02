import { z } from "zod";

import { agentIntentSchema, isoInstantSchema, modelUsageSchema } from "@spotter/contracts";

import { AgentRuntimeError } from "../errors";
import type { ModelGateway, ModelGatewayRequest, ModelGatewayResponse } from "./model-gateway";

export const modelRecordingSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().trim().min(1).max(120),
    key: z.string().trim().min(1).max(200),
    intent: agentIntentSchema,
    promptVersion: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    model: z.string().trim().min(1).max(200),
    recordedAt: isoInstantSchema,
    rawResponse: z.string().min(1).max(1_000_000),
    output: z.json(),
    usage: modelUsageSchema,
  })
  .strict();

export type ModelRecording = z.infer<typeof modelRecordingSchema>;

export class RecordedModelGateway implements ModelGateway {
  public readonly mode = "recorded" as const;
  public readonly modelId: string;
  readonly #recordings: ReadonlyMap<string, ModelRecording>;

  public constructor(unvalidatedRecordings: readonly unknown[]) {
    const recordings = unvalidatedRecordings.map((recording) =>
      modelRecordingSchema.parse(recording),
    );
    const entries = new Map<string, ModelRecording>();
    for (const recording of recordings) {
      const identity = this.identity(recording.intent, recording.key);
      if (entries.has(identity)) {
        throw new AgentRuntimeError("validation_failed", `Duplicate recording ${identity}`, false);
      }
      entries.set(identity, Object.freeze(recording));
    }
    this.#recordings = entries;
    this.modelId = recordings[0]?.model ?? "recorded-model";
  }

  public generate(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    return Promise.resolve().then(() => this.replay(request));
  }

  private replay(request: ModelGatewayRequest): ModelGatewayResponse {
    if (request.signal.aborted) {
      throw new DOMException("The model request was aborted", "AbortError");
    }
    const recording = this.#recordings.get(this.identity(request.intent, request.recordingKey));
    if (!recording) {
      throw new AgentRuntimeError(
        "recording_not_found",
        `No recorded response exists for ${request.intent}:${request.recordingKey}`,
        false,
      );
    }
    if (recording.promptVersion !== request.promptVersion) {
      throw new AgentRuntimeError(
        "recording_prompt_mismatch",
        "The recorded response does not match the active prompt version",
        false,
      );
    }
    return {
      output: structuredClone(recording.output),
      usage: { ...recording.usage },
    };
  }

  private identity(intent: string, key: string): string {
    return `${intent}:${key}`;
  }
}
