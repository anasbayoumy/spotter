import { describe, expect, it } from "vitest";

import { ApiClientError, isStaleConflict, toApiClientError } from "./errors";

describe("client error normalization", () => {
  it("preserves an existing API error and its diagnostic fields", () => {
    const original = new ApiClientError({
      code: "stale_programme",
      kind: "api",
      message: "Refresh the current programme.",
      requestId: "request-stale",
      retryable: false,
      status: 409,
    });
    expect(toApiClientError(original)).toBe(original);
    expect(original).toMatchObject({ requestId: "request-stale", status: 409 });
  });

  it("maps ordinary errors and unknown thrown values without leaking internals", () => {
    expect(toApiClientError(new Error("Connection closed"))).toMatchObject({
      code: "network_unavailable",
      message: "Connection closed",
      requestId: null,
      retryable: true,
      status: null,
    });
    expect(toApiClientError({ private: "detail" })).toMatchObject({
      code: "network_unavailable",
      message: "The request could not be completed.",
    });
  });
});

describe("stale conflict classification", () => {
  it.each(["stale_programme", "version_conflict", "invalid_state_transition"] as const)(
    "classifies %s only at HTTP 409",
    (code) => {
      expect(
        isStaleConflict(
          new ApiClientError({
            code,
            kind: "api",
            message: "Conflict",
            retryable: false,
            status: 409,
          }),
        ),
      ).toBe(true);
      expect(
        isStaleConflict(
          new ApiClientError({
            code,
            kind: "api",
            message: "Conflict",
            retryable: false,
            status: 400,
          }),
        ),
      ).toBe(false);
    },
  );

  it("rejects non-errors and unrelated 409 responses", () => {
    expect(isStaleConflict("stale_programme")).toBe(false);
    expect(
      isStaleConflict(
        new ApiClientError({
          code: "idempotency_key_reused",
          kind: "api",
          message: "Different payload",
          retryable: false,
          status: 409,
        }),
      ),
    ).toBe(false);
  });
});
