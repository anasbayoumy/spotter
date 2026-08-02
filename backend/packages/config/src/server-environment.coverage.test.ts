import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "./server-environment.js";

const liveEnvironment = {
  AI_API_KEY: "synthetic-provider-key",
  AI_BASE_URL: "https://api.openai.com/v1",
  AI_GENERATOR_MODEL: "synthetic-generator",
  AI_JUDGE_MODEL: "synthetic-judge",
  AI_MODE: "live",
  AI_PROVIDER: "openai",
} as const;

describe("server environment edge cases", () => {
  it("normalizes optional blank text and accepts every fixed provider path form", () => {
    expect(
      parseServerEnvironment({ AI_GENERATOR_MODEL: "   " }).AI_GENERATOR_MODEL,
    ).toBeUndefined();
    for (const AI_BASE_URL of [
      "https://api.openai.com",
      "https://api.openai.com/",
      "https://api.openai.com/v1",
      "https://api.openai.com/v1/",
    ]) {
      expect(parseServerEnvironment({ ...liveEnvironment, AI_BASE_URL }).AI_BASE_URL).toBe(
        AI_BASE_URL,
      );
    }
  });

  it.each([
    "https://api.openai.com:444/v1",
    "https://user@api.openai.com/v1",
    "https://api.openai.com/v1#fragment",
  ])("rejects every non-canonical provider URL component", (AI_BASE_URL) => {
    expect(() => parseServerEnvironment({ ...liveEnvironment, AI_BASE_URL })).toThrow(/allowlist/u);
  });

  it("rejects unacknowledged production and live AI in the keyless demo", () => {
    expect(() => parseServerEnvironment({ APP_ENV: "production" })).toThrow(/No-auth/u);
    expect(() =>
      parseServerEnvironment({
        ...liveEnvironment,
        ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
        APP_ENV: "demo",
      }),
    ).toThrow(/recorded AI/u);
  });

  it("reports every omitted live dependency and accepts distinct model identifiers", () => {
    for (const key of [
      "AI_API_KEY",
      "AI_BASE_URL",
      "AI_GENERATOR_MODEL",
      "AI_JUDGE_MODEL",
      "AI_PROVIDER",
    ] as const) {
      const incomplete = Object.fromEntries(
        Object.entries(liveEnvironment).filter(([candidate]) => candidate !== key),
      );
      expect(() => parseServerEnvironment(incomplete)).toThrow(new RegExp(key, "u"));
    }
    expect(parseServerEnvironment(liveEnvironment).AI_JUDGE_MODEL).toBe("synthetic-judge");
  });
});
