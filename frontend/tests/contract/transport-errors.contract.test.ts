import { apiContracts, type ApiErrorCode } from "@spotter/contracts";
import { describe, expect, it } from "vitest";

import { apiRoute } from "../../src/server/http";

describe("HTTP error transport", () => {
  it.each([
    ["validation_failed", 400],
    ["client_not_found", 404],
    ["version_conflict", 409],
    ["blocked_requires_override", 422],
    ["rate_limited", 429],
    ["dependency_unavailable", 503],
  ] satisfies readonly (readonly [ApiErrorCode, number])[])(
    "maps %s to %i without breaking the response envelope",
    async (code, expectedStatus) => {
      const response = await apiRoute(
        new Request("http://local/api/v1/clients/unknown", {
          headers: { "x-request-id": "transport-request-001" },
        }),
        apiContracts.clients.detail.output,
        () =>
          Promise.reject(
            Object.assign(new Error("Safe public failure."), {
              code,
              details: { field: "synthetic" },
            }),
          ),
      );
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("x-request-id")).toBe("transport-request-001");
      const envelope = apiContracts.clients.detail.output.parse(await response.json());
      expect(envelope).toMatchObject({
        data: null,
        error: { code, message: "Safe public failure." },
        meta: { requestId: "transport-request-001" },
      });
    },
  );

  it("sanitizes unexpected errors and never serializes stack or secret text", async () => {
    const response = await apiRoute(
      new Request("http://local/api/v1/clients/unknown"),
      apiContracts.clients.detail.output,
      () => Promise.reject(new Error("postgres://user:secret@private-host/internal")),
    );
    expect(response.status).toBe(500);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain("internal_error");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("private-host");
    expect(serialized).not.toContain("at ");
  });
});
