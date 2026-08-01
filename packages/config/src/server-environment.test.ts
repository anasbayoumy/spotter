import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "./server-environment.js";

describe("server environment", () => {
  it("defaults to the deterministic synthetic path", () => {
    const environment = parseServerEnvironment({});
    expect(environment.AI_MODE).toBe("recorded");
    expect(environment.DATABASE_MODE).toBe("pglite");
    expect(environment.DATA_POLICY).toBe("synthetic_only");
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
});
