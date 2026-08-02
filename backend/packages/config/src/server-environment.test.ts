import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "./server-environment.js";

describe("server environment", () => {
  it("defaults to the deterministic synthetic path", () => {
    const environment = parseServerEnvironment({});
    expect(environment.AI_MODE).toBe("recorded");
    expect(environment.DATABASE_MODE).toBe("pglite");
    expect(environment.DATA_POLICY).toBe("synthetic_only");
    expect(environment.SPOTTER_RATE_LIMIT_PROFILE).toBe("default");
  });

  it("fails closed for non-synthetic no-auth production", () => {
    expect(() =>
      parseServerEnvironment({ APP_ENV: "production", DATA_POLICY: "non_synthetic" }),
    ).toThrow(/No-auth production mode/u);
  });

  it("allows only an explicitly enabled synthetic production demo", () => {
    expect(
      parseServerEnvironment({
        ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
        APP_ENV: "production",
        DATA_POLICY: "synthetic_only",
      }).APP_ENV,
    ).toBe("production");
  });

  it("requires a complete, separated live-model configuration", () => {
    expect(() => parseServerEnvironment({ AI_MODE: "live" })).toThrow(/AI_API_KEY/u);
    expect(() =>
      parseServerEnvironment({
        AI_API_KEY: "synthetic-provider-key",
        AI_BASE_URL: "https://api.openai.com/v1",
        AI_GENERATOR_MODEL: "same-model",
        AI_JUDGE_MODEL: "same-model",
        AI_MODE: "live",
        AI_PROVIDER: "openai",
      }),
    ).toThrow(/must differ/u);
    expect(
      parseServerEnvironment({
        AI_API_KEY: "synthetic-provider-key",
        AI_BASE_URL: "https://api.openai.com/v1",
        AI_GENERATOR_MODEL: "synthetic-generator",
        AI_JUDGE_MODEL: "synthetic-judge",
        AI_MODE: "live",
        AI_PROVIDER: "openai",
      }).AI_MODE,
    ).toBe("live");
  });

  it.each([
    "http://api.openai.com/v1",
    "https://api.openai.com.evil.example/v1",
    "https://user:secret@api.openai.com/v1",
    "https://api.openai.com/v1?target=http://127.0.0.1",
    "https://api.openai.com/internal",
  ])("rejects provider URL outside the fixed allowlist", (AI_BASE_URL) => {
    expect(() => parseServerEnvironment({ AI_BASE_URL })).toThrow(/allowlist/u);
  });

  it("allows a fresh performance load profile only for its exact synthetic QA identity", () => {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:.TZ]/gu, "")
      .slice(0, 14);
    const runId = `${timestamp}-performance-a1b2c3`;
    const environment = parseServerEnvironment({
      AI_MODE: "recorded",
      ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
      APP_ENV: "production",
      DATA_POLICY: "synthetic_only",
      SPOTTER_QA_PROJECT: `spotter-qa-${runId}`,
      SPOTTER_QA_RUN_ID: runId,
      SPOTTER_RATE_LIMIT_PROFILE: "load_test",
    });
    expect(environment.SPOTTER_RATE_LIMIT_PROFILE).toBe("load_test");
  });

  it("fails closed for mismatched, stale, or stray load-test activation", () => {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:.TZ]/gu, "")
      .slice(0, 14);
    const runId = `${timestamp}-performance-a1b2c3`;
    const valid = {
      AI_MODE: "recorded",
      ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
      APP_ENV: "production",
      DATA_POLICY: "synthetic_only",
      SPOTTER_QA_PROJECT: `spotter-qa-${runId}`,
      SPOTTER_QA_RUN_ID: runId,
      SPOTTER_RATE_LIMIT_PROFILE: "load_test",
    } as const;
    expect(() =>
      parseServerEnvironment({ ...valid, SPOTTER_QA_PROJECT: "spotter-qa-wrong" }),
    ).toThrow(/exact ephemeral QA/u);
    expect(() =>
      parseServerEnvironment({
        ...valid,
        SPOTTER_QA_PROJECT: "spotter-qa-20000101000000-performance-a1b2c3",
        SPOTTER_QA_RUN_ID: "20000101000000-performance-a1b2c3",
      }),
    ).toThrow(/stale/u);
    expect(() => parseServerEnvironment({ SPOTTER_QA_PROJECT: `spotter-qa-${runId}` })).toThrow(
      /only with the load-test/u,
    );
  });
});
