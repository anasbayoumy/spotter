import { apiResponseSchema } from "@spotter/contracts";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", (): object => ({
  getApiConfiguration: (): object => ({ baseUrl: "", source: "web-same-origin" }),
}));

import { ApiClientError } from "./errors";
import { requestJson } from "./http-client";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("typed HTTP client", () => {
  it("returns validated success data and sends idempotency headers", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      void url;
      void init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: "saved",
            error: null,
            meta: { requestId: "request-123" },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      requestJson<string>("/api/v1/test", apiResponseSchema(z.string()), {
        body: { value: true },
        idempotencyKey: "stable-key-1",
        method: "POST",
      }),
    ).resolves.toBe("saved");
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("/api/v1/test");
    expect(call?.[1]?.method).toBe("POST");
    expect(new Headers(call?.[1]?.headers).get("Idempotency-Key")).toBe("stable-key-1");
  });

  it("preserves API request IDs and retryability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: null,
              error: { code: "dependency_unavailable", message: "Try later." },
              meta: { requestId: "request-503" },
            }),
            { headers: { "Content-Type": "application/json" }, status: 503 },
          ),
        ),
      ),
    );
    const error = await requestJson("/api/v1/test", apiResponseSchema(z.string())).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ requestId: "request-503", retryable: true, status: 503 });
  });

  it("rejects malformed envelopes without exposing response content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ secret: "must-not-surface" }), {
            headers: { "Content-Type": "application/json", "x-request-id": "request-bad" },
            status: 200,
          }),
        ),
      ),
    );
    await expect(requestJson("/api/v1/test", apiResponseSchema(z.string()))).rejects.toMatchObject({
      code: "invalid_response",
      requestId: "request-bad",
    });
  });

  it("maps fetch failures to retryable offline errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    await expect(requestJson("/api/v1/test", apiResponseSchema(z.string()))).rejects.toMatchObject({
      code: "network_unavailable",
      retryable: true,
    });
  });

  it("rejects non-JSON responses with header request ID and status-based retryability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("gateway html", {
            headers: { "x-request-id": "request-non-json" },
            status: 502,
          }),
        ),
      ),
    );
    await expect(requestJson("/api/v1/test", apiResponseSchema(z.string()))).rejects.toMatchObject({
      code: "invalid_response",
      requestId: "request-non-json",
      retryable: true,
      status: 502,
    });
  });

  it.each([
    { expectedRetry: true, status: 429 },
    { expectedRetry: false, status: 400 },
  ])("maps API error retryability at HTTP $status", async ({ expectedRetry, status }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: null,
              error: { code: "rate_limited", message: "Bounded request protection." },
              meta: { requestId: `request-${String(status)}` },
            }),
            { headers: { "Content-Type": "application/json" }, status },
          ),
        ),
      ),
    );
    await expect(requestJson("/api/v1/test", apiResponseSchema(z.string()))).rejects.toMatchObject({
      retryable: expectedRetry,
      status,
    });
  });

  it.each([
    { expectedRetry: true, status: 500 },
    { expectedRetry: false, status: 400 },
  ])("rejects success data paired with HTTP $status", async ({ expectedRetry, status }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: "must-not-return",
              error: null,
              meta: { requestId: `request-success-${String(status)}` },
            }),
            { headers: { "Content-Type": "application/json" }, status },
          ),
        ),
      ),
    );
    await expect(requestJson("/api/v1/test", apiResponseSchema(z.string()))).rejects.toMatchObject({
      code: "invalid_response",
      retryable: expectedRetry,
      status,
    });
  });

  it("aborts a timed-out request and preserves entered-data wording", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit): Promise<Response> =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          }),
      ),
    );
    const request = requestJson("/api/v1/test", apiResponseSchema(z.string()), { timeoutMs: 10 });
    const errorPromise = request.catch((caught: unknown): unknown => caught);
    await vi.advanceTimersByTimeAsync(11);
    const error = await errorPromise;
    expect(error).toBeInstanceOf(ApiClientError);
    if (!(error instanceof ApiClientError)) throw new Error("Expected ApiClientError.");
    expect(error.code).toBe("request_timeout");
    expect(error.message).toContain("entered data is still here");
    expect(error.retryable).toBe(true);
  });

  it("forwards a caller abort signal and removes its listener", async () => {
    const caller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit): Promise<Response> =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          }),
      ),
    );
    const request = requestJson("/api/v1/test", apiResponseSchema(z.string()), {
      signal: caller.signal,
    });
    caller.abort("query cancelled");
    await expect(request).rejects.toMatchObject({ code: "request_timeout", kind: "timeout" });
  });
});
