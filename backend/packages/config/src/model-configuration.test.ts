import { describe, expect, it } from "vitest";

import { parseServerEnvironment, resolveModelConfiguration } from "./server-environment.js";

const live = {
  SPOTTER_GENERATOR_MODEL: "generator-model",
  SPOTTER_JUDGE_MODEL: "judge-model",
  SPOTTER_MODEL_API_KEY: "local-key",
  SPOTTER_MODEL_BASE_URL: "http://127.0.0.1:11434/v1/",
  SPOTTER_MODEL_MODE: "live",
} as const;

describe("model configuration resolution", () => {
  it("defaults to recorded mode without credentials", () => {
    expect(resolveModelConfiguration(parseServerEnvironment({}))).toEqual({ mode: "recorded" });
  });

  it("resolves one provider-neutral live configuration", () => {
    expect(resolveModelConfiguration(parseServerEnvironment(live))).toEqual({
      apiKey: "local-key",
      baseUrl: "http://127.0.0.1:11434/v1",
      generatorModel: "generator-model",
      judgeModel: "judge-model",
      mode: "live",
    });
  });

  it("fails fast for missing live credentials and equal models", () => {
    expect(() => parseServerEnvironment({ SPOTTER_MODEL_MODE: "live" })).toThrow(
      /SPOTTER_MODEL_BASE_URL/u,
    );
    expect(() =>
      parseServerEnvironment({
        ...live,
        SPOTTER_JUDGE_MODEL: " GENERATOR-MODEL ",
      }),
    ).toThrow(/must differ/u);
  });
});
