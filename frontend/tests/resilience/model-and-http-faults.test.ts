import { apiResponseSchema } from "@spotter/contracts";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { apiRoute, resetHttpSecurityStateForTests } from "../../src/server/http";

describe("model and HTTP fault boundaries", () => {
  it("returns a correlated sanitized 503 and recovers on the next request", async () => {
    resetHttpSecurityStateForTests();
    const schema = apiResponseSchema(z.object({ ok: z.boolean() }).strict());
    const unavailable = await apiRoute(
      new Request("http://local/api/v1/clients", {
        headers: { "x-request-id": "resilience-database-001" },
      }),
      schema,
      () =>
        Promise.reject(
          Object.assign(new Error("postgresql://user:secret@private-host/database"), {
            code: "dependency_unavailable",
          }),
        ),
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("x-request-id")).toBe("resilience-database-001");
    const serialized = JSON.stringify(await unavailable.json());
    expect(serialized).not.toContain("private-host");
    expect(serialized).not.toContain("secret");

    const recovered = await apiRoute(new Request("http://local/api/v1/clients"), schema, () =>
      Promise.resolve({ ok: true }),
    );
    expect(recovered.status).toBe(200);
  });
});
