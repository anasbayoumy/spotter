import type { ModelMode } from "./model-gateway";
import type { SchemaTelemetry } from "./openai-compatible-transport";

export interface ModelRunTelemetry extends SchemaTelemetry {
  readonly mode: ModelMode;
  readonly modelId: string;
}

export class ModelRunTelemetryStore {
  readonly #byTraceId = new Map<string, ModelRunTelemetry>();

  public begin(traceId: string, provenance: Readonly<{ mode: ModelMode; modelId: string }>): void {
    this.#byTraceId.set(traceId, {
      ...provenance,
      schemaFailure: false,
      schemaRetryCount: 0,
    });
  }

  public record(traceId: string, telemetry: SchemaTelemetry): void {
    const current = this.#byTraceId.get(traceId);
    if (current === undefined) return;
    this.#byTraceId.set(
      traceId,
      Object.freeze({
        ...current,
        schemaFailure: current.schemaFailure || telemetry.schemaFailure,
        schemaRetryCount:
          current.schemaRetryCount === 1 || telemetry.schemaRetryCount === 1 ? 1 : 0,
      }),
    );
  }

  public take(traceId: string): ModelRunTelemetry {
    const telemetry = this.#byTraceId.get(traceId) ?? {
      mode: "recorded" as const,
      modelId: "recorded-model",
      schemaFailure: false,
      schemaRetryCount: 0,
    };
    this.#byTraceId.delete(traceId);
    return telemetry;
  }
}
