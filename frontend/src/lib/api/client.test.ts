import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, createIdempotencyKey, requestApi, toApiClientError } from "./client";

const responseSchema = z.object({ value: z.string() }).strict();
const requestId = "request-12345678";

describe("typed API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates a successful envelope and sends idempotent JSON mutations", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { value: "published" }, error: null, meta: { requestId } }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestApi("/api/v1/programmes/fixture/approve", responseSchema, {
        body: { expectedVersion: 1 },
        idempotencyKey: "programme.approve:fixture:key",
        method: "POST",
      }),
    ).resolves.toEqual({ data: { value: "published" }, meta: { requestId } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/programmes/fixture/approve",
      expect.objectContaining({
        body: JSON.stringify({ expectedVersion: 1 }),
        method: "POST",
      }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers;
    expect(headers).toBeInstanceOf(Headers);
    if (headers instanceof Headers)
      expect(headers.get("Idempotency-Key")).toBe("programme.approve:fixture:key");
  });

  it("retains the safe API error and request id for conflict diagnosis", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: null,
            error: { code: "version_conflict", message: "The proposal changed." },
            meta: { requestId },
          }),
          { status: 409 },
        ),
      ),
    );

    await expect(requestApi("/api/v1/programmes/fixture", responseSchema)).rejects.toEqual(
      expect.objectContaining<Partial<ApiClientError>>({
        code: "version_conflict",
        message: "The proposal changed.",
        requestId,
        retryable: false,
        status: 409,
      }),
    );
  });

  it("fails closed for malformed and unreachable responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ data: { unexpected: true }, error: null, meta: { requestId } }),
          {
            headers: { "x-request-id": requestId },
            status: 200,
          },
        ),
      ),
    );
    await expect(requestApi("/api/v1/scorecard", responseSchema)).rejects.toMatchObject({
      code: "invalid_response",
      requestId,
    });

    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")));
    await expect(requestApi("/api/v1/scorecard", responseSchema)).rejects.toMatchObject({
      code: "network_error",
      requestId: null,
      retryable: true,
    });
  });

  it("preserves aborts so callers can distinguish cancellation from an offline service", async () => {
    const abort = new Error("cancelled");
    abort.name = "AbortError";
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(abort);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestApi("/api/v1/scorecard", responseSchema, { signal: controller.signal }),
    ).rejects.toBe(abort);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/scorecard",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("reports unreadable upstream responses with transport diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("not-json", {
          headers: { "x-request-id": requestId },
          status: 503,
        }),
      ),
    );

    await expect(requestApi("/api/v1/scorecard", responseSchema)).rejects.toMatchObject({
      code: "invalid_response",
      requestId,
      retryable: true,
      status: 503,
    });
  });

  it("marks rate limits and server failures retryable while retaining the public error", async () => {
    for (const [status, code] of [
      [429, "rate_limited"],
      [503, "dependency_unavailable"],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response(
            JSON.stringify({
              data: null,
              error: { code, message: "Please retry later." },
              meta: { requestId },
            }),
            { status },
          ),
        ),
      );

      await expect(requestApi("/api/v1/scorecard", responseSchema)).rejects.toMatchObject({
        code,
        requestId,
        retryable: true,
        status,
      });
    }
  });

  it("normalizes unknown errors without replacing an existing API client error", () => {
    const conflict = new ApiClientError(
      "version_conflict",
      "The proposal changed.",
      requestId,
      false,
      409,
    );

    expect(toApiClientError(conflict)).toBe(conflict);
    expect(toApiClientError(new TypeError("implementation detail"))).toMatchObject({
      code: "network_error",
      message: "The request could not be completed.",
      requestId: null,
      retryable: true,
      status: null,
    });
  });

  it("creates scoped, resource-specific idempotency keys", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000999");

    expect(createIdempotencyKey("programme.approve", "programme-201")).toBe(
      "programme.approve:programme-201:00000000-0000-4000-8000-000000000999",
    );
  });
});
