import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("query client runtime policies", () => {
  it("keeps server-rendered web data alive", async () => {
    vi.doMock("react-native", () => ({ Platform: { OS: "web" } }));
    const { queryClient } = await import("../../src/lib/query/client");
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(Number.POSITIVE_INFINITY);
  });

  it("expires native data and retries only bounded retryable API failures", async () => {
    vi.doMock("react-native", () => ({ Platform: { OS: "ios" } }));
    const { ApiClientError } = await import("../../src/lib/api/errors");
    const { queryClient } = await import("../../src/lib/query/client");
    const options = queryClient.getDefaultOptions().queries;
    expect(options?.gcTime).toBe(5 * 60_000);
    expect(options?.refetchOnWindowFocus).toBe(false);
    expect(options?.staleTime).toBe(30_000);
    const retry = options?.retry;
    expect(typeof retry).toBe("function");
    if (typeof retry !== "function") return;

    const retryable = new ApiClientError({
      code: "dependency_unavailable",
      kind: "api",
      message: "Retry later.",
      retryable: true,
      status: 503,
    });
    const final = new ApiClientError({
      code: "validation_failed",
      kind: "api",
      message: "Do not retry.",
      retryable: false,
      status: 400,
    });
    expect(retry(0, retryable)).toBe(true);
    expect(retry(2, retryable)).toBe(false);
    expect(retry(0, final)).toBe(false);
    expect(retry(0, new Error("opaque"))).toBe(false);
  });
});
