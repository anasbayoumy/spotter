// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({
  data: undefined as undefined | { data: { value: string }; meta: { requestId: string } },
  error: null as unknown,
  isFetching: false,
  isPending: false,
  refetch: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => query),
}));

import { ApiClientError } from "./client";
import { useResource } from "./use-resource";

beforeEach(() => {
  query.data = undefined;
  query.error = null;
  query.isFetching = false;
  query.isPending = false;
  query.refetch.mockClear();
});

describe("useResource", () => {
  it("maps pending, successful, and refetching query states", () => {
    query.isPending = true;
    const pending = renderHook(() =>
      useResource("client", () =>
        Promise.resolve({
          data: { value: "unused" },
          meta: { requestId: "unused" },
        }),
      ),
    );
    expect(pending.result.current).toMatchObject({
      data: null,
      error: null,
      loading: true,
      meta: null,
    });
    pending.unmount();

    query.isPending = false;
    query.isFetching = true;
    query.data = { data: { value: "ready" }, meta: { requestId: "request-1" } };
    const successful = renderHook(() =>
      useResource("client", () =>
        Promise.resolve({
          data: { value: "unused" },
          meta: { requestId: "unused" },
        }),
      ),
    );
    expect(successful.result.current).toMatchObject({
      data: { value: "ready" },
      error: null,
      loading: true,
      meta: { requestId: "request-1" },
    });
    act(() => {
      successful.result.current.reload();
    });
    expect(query.refetch).toHaveBeenCalledOnce();
  });

  it("normalizes rejected query errors", () => {
    query.error = new Error("upstream unavailable");
    const { result } = renderHook(() =>
      useResource("client", () =>
        Promise.resolve({
          data: { value: "unused" },
          meta: { requestId: "unused" },
        }),
      ),
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeInstanceOf(ApiClientError);
    expect(result.current.error).toMatchObject({
      code: "network_error",
      message: "The request could not be completed.",
      retryable: true,
    });
  });
});
