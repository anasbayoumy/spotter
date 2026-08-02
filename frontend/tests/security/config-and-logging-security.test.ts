import { parseServerEnvironment } from "@spotter/config";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import nextConfig, { securityHeaders } from "../../next.config";

describe("deployment security configuration", () => {
  it("fails closed for production no-auth deployments without both synthetic controls", () => {
    expect(() => parseServerEnvironment({ APP_ENV: "production" })).toThrow(
      /No-auth production mode/u,
    );
    expect(() =>
      parseServerEnvironment({
        ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
        APP_ENV: "production",
        DATA_POLICY: "non_synthetic",
      }),
    ).toThrow(/No-auth production mode/u);
    expect(
      parseServerEnvironment({
        ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
        APP_ENV: "production",
        DATA_POLICY: "synthetic_only",
      }),
    ).toMatchObject({ APP_ENV: "production", DATA_POLICY: "synthetic_only" });
  });

  it("configures a restrictive browser header set without unsafe eval", async () => {
    const headers = new Map(securityHeaders.map((header) => [header.key, header.value]));
    expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(headers.get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Content-Security-Policy")).not.toContain("unsafe-eval");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Permissions-Policy")).toContain("microphone=()");
    await expect(nextConfig.headers?.()).resolves.toEqual([
      { headers: [...securityHeaders], source: "/:path*" },
    ]);
  });
});
