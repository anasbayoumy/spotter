import { apiResponseSchema } from "@spotter/contracts";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertCronSecret } from "../../src/server/environment";
import {
  apiRoute,
  listPage,
  parseBody,
  parseParams,
  parseQuery,
  resetHttpSecurityStateForTests,
} from "../../src/server/http";

const responseSchema = apiResponseSchema(z.object({ ok: z.boolean() }).strict());
const responseArraySchema = apiResponseSchema(z.array(z.number()));
const environment = { ...process.env };

async function decode(response: Response): Promise<z.infer<typeof responseSchema>> {
  return responseSchema.parse(await response.json());
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://local${path}`, init);
}

describe("hardened HTTP boundary", () => {
  beforeEach(() => {
    resetHttpSecurityStateForTests();
  });

  afterEach(() => {
    process.env = { ...environment };
    resetHttpSecurityStateForTests();
  });

  it("returns bounded envelopes and response-hardening headers", async () => {
    const response = await apiRoute(
      request("/api/v1/clients", {
        headers: { origin: "http://local", "x-request-id": "security-request-001" },
      }),
      responseSchema,
      () => Promise.resolve({ ok: true }),
      { successStatus: 201 },
    );
    expect(response.status).toBe(201);
    expect(response.headers).toMatchObject({});
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-request-id")).toBe("security-request-001");
    await expect(decode(response)).resolves.toMatchObject({ data: { ok: true }, error: null });
  });

  it("rejects cross-origin and malformed request URLs before invoking work", async () => {
    let calls = 0;
    const crossOrigin = await apiRoute(
      request("/api/v1/clients", { headers: { origin: "https://attacker.example" } }),
      responseSchema,
      () => {
        calls += 1;
        return Promise.resolve({ ok: true });
      },
    );
    expect(crossOrigin.status).toBe(403);
    expect((await decode(crossOrigin)).error?.code).toBe("validation_failed");

    const malformedRequest = {
      headers: new Headers({ origin: "http://local" }),
      url: "%not-a-url",
    } as Request;
    const malformed = await apiRoute(malformedRequest, responseSchema, () => {
      calls += 1;
      return Promise.resolve({ ok: true });
    });
    expect(malformed.status).toBe(400);
    expect(calls).toBe(0);
  });

  it("requires idempotency and authorization before mutation handlers", async () => {
    const missingKey = await apiRoute(
      request("/api/v1/check-ins", { method: "POST" }),
      responseSchema,
      () => Promise.resolve({ ok: true }),
      { mutation: true },
    );
    expect(missingKey.status).toBe(400);
    const unauthorized = await apiRoute(
      request("/api/v1/jobs/weekly-plan", {
        headers: { "idempotency-key": "security-job-001" },
        method: "POST",
      }),
      responseSchema,
      () => Promise.resolve({ ok: true }),
      {
        authorize: () => {
          throw Object.assign(new Error("Cron invocation is not authorized."), {
            code: "invalid_cron_secret",
          });
        },
        mutation: true,
      },
    );
    expect(unauthorized.status).toBe(401);
  });

  it.each([
    ["/api/v1/jobs/weekly-plan", true, 10],
    ["/api/v1/programmes/generate", true, 8],
    ["/api/v1/check-ins", true, 60],
    ["/api/v1/clients", false, 240],
  ] as const)("rate-limits the %s request class", async (path, mutation, limit) => {
    for (let index = 0; index < limit; index += 1) {
      const response = await apiRoute(
        request(path, {
          headers: mutation ? { "idempotency-key": `security-rate-${String(index)}` } : {},
          method: mutation ? "POST" : "GET",
        }),
        responseSchema,
        () => Promise.resolve({ ok: true }),
        { mutation },
      );
      expect(response.status).toBe(200);
    }
    const limited = await apiRoute(
      request(path, {
        headers: mutation ? { "idempotency-key": "security-rate-limited" } : {},
        method: mutation ? "POST" : "GET",
      }),
      responseSchema,
      () => Promise.resolve({ ok: true }),
      { mutation },
    );
    expect(limited.status).toBe(429);
    expect(await decode(limited)).toMatchObject({ error: { code: "rate_limited" } });
  });

  it("uses expanded limits only for a validated environment profile, without a header bypass", async () => {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:.TZ]/gu, "")
      .slice(0, 14);
    const runId = `${timestamp}-performance-a1b2c3`;
    process.env = {
      ...environment,
      AI_MODE: "recorded",
      ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
      APP_ENV: "production",
      DATA_POLICY: "synthetic_only",
      SPOTTER_QA_PROJECT: `spotter-qa-${runId}`,
      SPOTTER_QA_RUN_ID: runId,
      SPOTTER_RATE_LIMIT_PROFILE: "load_test",
    };
    resetHttpSecurityStateForTests();
    for (let index = 0; index < 241; index += 1) {
      const response = await apiRoute(
        request("/api/v1/clients", {
          headers: { "x-spotter-load-test": index === 240 ? "not-a-bypass" : "synthetic" },
        }),
        responseSchema,
        () => Promise.resolve({ ok: true }),
      );
      expect(response.status).toBe(200);
    }
  });

  it("rejects invalid load-profile activation before request work", async () => {
    process.env = {
      ...environment,
      AI_MODE: "recorded",
      ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
      APP_ENV: "production",
      DATA_POLICY: "synthetic_only",
      SPOTTER_QA_PROJECT: "spotter-qa-mismatch",
      SPOTTER_QA_RUN_ID: "20000101000000-performance-a1b2c3",
      SPOTTER_RATE_LIMIT_PROFILE: "load_test",
    };
    resetHttpSecurityStateForTests();
    let calls = 0;
    const response = await apiRoute(request("/api/v1/clients"), responseSchema, () => {
      calls += 1;
      return Promise.resolve({ ok: true });
    });
    expect(response.status).toBe(500);
    expect(calls).toBe(0);
  });

  it("caps concurrent generation and releases capacity after success or failure", async () => {
    const resolvers: (() => void)[] = [];
    const hold = (): Promise<{ ok: boolean }> =>
      new Promise((resolve) => {
        resolvers.push(() => {
          resolve({ ok: true });
        });
      });
    const active = Array.from({ length: 4 }, (_, index) =>
      apiRoute(
        request("/api/v1/programmes/generate", {
          headers: { "idempotency-key": `generation-active-${String(index)}` },
          method: "POST",
        }),
        responseSchema,
        hold,
        { mutation: true },
      ),
    );
    const full = await apiRoute(
      request("/api/v1/programmes/generate", {
        headers: { "idempotency-key": "generation-full-001" },
        method: "POST",
      }),
      responseSchema,
      () => Promise.resolve({ ok: true }),
      { mutation: true },
    );
    expect(full.status).toBe(429);
    for (const resolve of resolvers) resolve();
    expect((await Promise.all(active)).every((response) => response.status === 200)).toBe(true);

    const failed = await apiRoute(
      request("/api/v1/programmes/generate", {
        headers: { "idempotency-key": "generation-failure-001" },
        method: "POST",
      }),
      responseSchema,
      () => Promise.reject(new Error("private provider failure")),
      { mutation: true },
    );
    expect(failed.status).toBe(500);
    const recovered = await apiRoute(
      request("/api/v1/programmes/generate", {
        headers: { "idempotency-key": "generation-recovery-001" },
        method: "POST",
      }),
      responseSchema,
      () => Promise.resolve({ ok: true }),
      { mutation: true },
    );
    expect(recovered.status).toBe(200);
  });

  it.each([
    ["dependency_unavailable", "postgres://user:password@db/internal"],
    ["model_run_failed", "provider response body: secret\nforged"],
    ["model_timeout", "Bearer private-token"],
    ["recording_not_found", "/Users/private/recording.json"],
  ] as const)("sanitizes %s without exposing internal text", async (code, message) => {
    const response = await apiRoute(request("/api/v1/clients"), responseSchema, () =>
      Promise.reject(Object.assign(new Error(message), { code, details: { secret: message } })),
    );
    const serialized = JSON.stringify(await response.json());
    expect(response.status).toBe(503);
    expect(serialized).not.toContain(message);
    expect(serialized).not.toContain("details");
    expect(serialized).not.toContain("password");
  });

  it("retains bounded safe typed messages and replaces unknown or empty failures", async () => {
    const safe = await apiRoute(request("/api/v1/clients"), responseSchema, () =>
      Promise.reject(
        Object.assign(new Error("Synthetic client does not exist."), { code: "not_found" }),
      ),
    );
    expect((await decode(safe)).error).toEqual({
      code: "not_found",
      message: "Synthetic client does not exist.",
    });
    const empty = await apiRoute(request("/api/v1/clients"), responseSchema, () =>
      Promise.reject(Object.assign(new Error(""), { code: "dependency_unavailable" })),
    );
    expect((await decode(empty)).error?.message).toBe(
      "A required service is temporarily unavailable.",
    );
    const unknown = await apiRoute(request("/api/v1/clients"), responseSchema, () =>
      Promise.reject(
        Object.assign(new Error("invented"), { code: "invented", internal: "secret" }),
      ),
    );
    expect((await decode(unknown)).error).toEqual({
      code: "internal_error",
      message: "The operation could not be completed.",
    });
  });

  it("parses bounded JSON bodies and rejects malformed, oversized, dangerous, and complex input", async () => {
    const schema = z.object({ value: z.string() }).strict();
    await expect(
      parseBody(
        request("/api/v1/check-ins", {
          body: JSON.stringify({ value: "synthetic" }),
          method: "POST",
        }),
        schema,
      ),
    ).resolves.toEqual({ value: "synthetic" });
    await expect(
      parseBody(request("/api/v1/check-ins", { body: "{", method: "POST" }), schema),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      parseBody(
        request("/api/v1/check-ins", {
          body: "{}",
          headers: { "content-length": "invalid" },
          method: "POST",
        }),
        schema,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      parseBody(
        request("/api/v1/check-ins", {
          body: "{}",
          headers: { "content-length": "1000001" },
          method: "POST",
        }),
        schema,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      parseBody(
        request("/api/v1/check-ins", {
          body: `{"value":"${"x".repeat(1_000_001)}"}`,
          method: "POST",
        }),
        schema,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      parseBody(
        request("/api/v1/check-ins", {
          body: '{"constructor":{"prototype":{"polluted":true}},"value":"synthetic"}',
          method: "POST",
        }),
        schema,
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      parseBody(
        request("/api/v1/check-ins", {
          body: JSON.stringify(Array.from({ length: 20_001 }, () => null)),
          method: "POST",
        }),
        z.array(z.null()),
      ),
    ).rejects.toMatchObject({ message: "Request structure is too complex." });
  });

  it("rejects invalid UTF-8 and supports requests with an empty body stream", async () => {
    await expect(
      parseBody(
        request("/api/v1/check-ins", { body: new Uint8Array([255]), method: "POST" }),
        z.unknown(),
      ),
    ).rejects.toMatchObject({ message: "Request body must be valid UTF-8." });
    await expect(parseBody(request("/api/v1/check-ins"), z.unknown())).rejects.toMatchObject({
      message: "Request body must be valid JSON.",
    });
  });

  it("rejects duplicate and prototype-polluting query/path keys", async () => {
    const querySchema = z.object({ limit: z.string().optional() }).strict();
    expect(parseQuery(request("/api/v1/clients?limit=10"), querySchema)).toEqual({ limit: "10" });
    expect(() => parseQuery(request("/api/v1/clients?limit=1&limit=2"), querySchema)).toThrow(
      /Duplicate/u,
    );
    expect(() => parseQuery(request("/api/v1/clients?__proto__=polluted"), querySchema)).toThrow(
      /prohibited/u,
    );
    await expect(
      parseParams(Promise.resolve({ constructor: "polluted" }), z.object({}).strict()),
    ).rejects.toThrow(/prohibited/u);
    await expect(
      parseParams(Promise.resolve({ id: "synthetic" }), z.object({ id: z.string() }).strict()),
    ).resolves.toEqual({ id: "synthetic" });
  });

  it("paginates deterministically and rejects forged cursors", async () => {
    const first = await apiRoute(request("/api/v1/clients"), responseArraySchema, () =>
      Promise.resolve(listPage([1, 2, 3], { limit: 2 })),
    );
    expect(await first.json()).toMatchObject({
      data: [1, 2],
      meta: { cursor: "v1:2", hasMore: true, total: 3 },
    });
    const second = await apiRoute(request("/api/v1/clients"), responseArraySchema, () =>
      Promise.resolve(listPage([1, 2, 3], { cursor: "v1:2", limit: 2 })),
    );
    expect(await second.json()).toMatchObject({
      data: [3],
      meta: { cursor: null, hasMore: false, total: 3 },
    });
    expect(() => listPage([1], { cursor: "../../etc/passwd", limit: 1 })).toThrow(/Cursor/u);
    expect(() => listPage([1], { cursor: "v1:999999999999999999999", limit: 1 })).toThrow(
      /Cursor/u,
    );
  });
});

describe("cron boundary", () => {
  beforeEach(() => {
    process.env = {
      ...environment,
      ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
      APP_ENV: "production",
      CRON_SECRET: "synthetic-cron-secret-001",
      DATA_POLICY: "synthetic_only",
    };
  });

  afterEach(() => {
    process.env = { ...environment };
  });

  it("allows demo invocation without a secret", () => {
    process.env["APP_ENV"] = "demo";
    expect(() => {
      assertCronSecret(request("/api/v1/jobs/weekly-plan"));
    }).not.toThrow();
  });

  it.each([
    ["authorization", "Bearer synthetic-cron-secret-001"],
    ["x-cron-secret", "synthetic-cron-secret-001"],
  ])("accepts an exact secret from the %s header", (header, value) => {
    expect(() => {
      assertCronSecret(request("/api/v1/jobs/weekly-plan", { headers: { [header]: value } }));
    }).not.toThrow();
  });

  it("rejects missing, wrong, malformed bearer, and query-string credentials", () => {
    expect(() => {
      assertCronSecret(request("/api/v1/jobs/weekly-plan"));
    }).toThrow();
    expect(() => {
      assertCronSecret(
        request("/api/v1/jobs/weekly-plan", { headers: { "x-cron-secret": "wrong-secret" } }),
      );
    }).toThrow();
    expect(() => {
      assertCronSecret(
        request("/api/v1/jobs/weekly-plan", {
          headers: { authorization: "Basic synthetic-cron-secret-001" },
        }),
      );
    }).toThrow();
    expect(() => {
      assertCronSecret(
        request("/api/v1/jobs/weekly-plan?cronSecret=synthetic-cron-secret-001", {
          headers: { authorization: "Bearer synthetic-cron-secret-001" },
        }),
      );
    }).toThrow();
  });
});
