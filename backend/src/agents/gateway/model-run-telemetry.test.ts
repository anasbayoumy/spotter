import { describe, expect, it } from "vitest";

import { ModelRunTelemetryStore } from "./model-run-telemetry.js";

describe("model-run telemetry", () => {
  it("accumulates a schema retry and failure until the run is consumed", () => {
    const telemetry = new ModelRunTelemetryStore();
    telemetry.record("missing", { schemaFailure: true, schemaRetryCount: 1 });
    telemetry.begin("trace-1", { mode: "live", modelId: "generator-a" });
    telemetry.record("trace-1", { schemaFailure: false, schemaRetryCount: 1 });
    telemetry.record("trace-1", { schemaFailure: true, schemaRetryCount: 0 });

    expect(telemetry.take("trace-1")).toEqual({
      mode: "live",
      modelId: "generator-a",
      schemaFailure: true,
      schemaRetryCount: 1,
    });
    expect(telemetry.take("trace-1")).toEqual({
      mode: "recorded",
      modelId: "recorded-model",
      schemaFailure: false,
      schemaRetryCount: 0,
    });
  });

  it("keeps a clean run clean", () => {
    const telemetry = new ModelRunTelemetryStore();
    telemetry.begin("trace-2", { mode: "live", modelId: "generator-b" });
    telemetry.record("trace-2", { schemaFailure: false, schemaRetryCount: 0 });
    expect(telemetry.take("trace-2")).toMatchObject({
      schemaFailure: false,
      schemaRetryCount: 0,
    });
  });
});
