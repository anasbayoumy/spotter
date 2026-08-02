import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentRuntimeError } from "../agents/errors";
import { ApplicationError } from "../application/core";
import { DomainError } from "../domain/core";
import { DatabaseInvariantError } from "../infrastructure/database/database-error";
import {
  ProductionBackendFacade,
  type BackendRequestContext,
  type BackendUseCases,
} from "./backend-facade";

const coachId = "00000000-0000-4000-8000-000000000001";
const clientId = "00000000-0000-4000-8000-000000000101";
const context: BackendRequestContext = {
  effectiveAt: new Date("2026-08-02T12:00:00.000Z"),
  requestId: "request-coverage-facade",
};

function facadeWith(execute: ReturnType<typeof vi.fn>): ProductionBackendFacade {
  const useCase = { execute, executeOverride: execute };
  const useCases = new Proxy(
    {},
    {
      get: () => useCase,
    },
  );
  // Each application use case is consumed only through its public execute method by this adapter;
  // the proxy keeps this boundary test focused on facade mapping instead of constructing 28 services.
  return new ProductionBackendFacade(
    useCases as BackendUseCases,
    coachId,
    pino({ enabled: false }),
  );
}

describe("production backend facade error and context mapping", () => {
  let execute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    execute = vi.fn();
  });

  it("short-circuits unsupported client status and delegates active listing", async () => {
    const facade = facadeWith(execute);
    await expect(facade.clients.list({ limit: 25, status: "paused" }, context)).resolves.toEqual(
      [],
    );
    expect(execute).not.toHaveBeenCalled();

    execute.mockResolvedValueOnce([]);
    await expect(facade.clients.list({ limit: 25, status: "active" }, context)).resolves.toEqual(
      [],
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("builds deterministic execution context with request fallback and explicit idempotency", async () => {
    const facade = facadeWith(execute);
    const input = { clientId, targetWeekStart: "2026-08-03" };
    execute.mockResolvedValue(undefined);

    await facade.programmes.generate(input, context);
    expect(execute).toHaveBeenLastCalledWith(
      input,
      expect.objectContaining({
        actorId: coachId,
        idempotencyKey: `request:${context.requestId}`,
        requestId: context.requestId,
      }),
    );

    await facade.programmes.generate(input, { ...context, idempotencyKey: "explicit-key" });
    expect(execute).toHaveBeenLastCalledWith(
      input,
      expect.objectContaining({ idempotencyKey: "explicit-key" }),
    );
  });

  it.each([
    {
      expectedCode: "dependency_unavailable",
      source: new ApplicationError("dependency_unavailable", "Application failure"),
    },
    {
      expectedCode: "validation_failed",
      source: new DomainError("invalid_value", "Domain failure", { field: "value" }),
    },
    {
      expectedCode: "version_conflict",
      source: new DatabaseInvariantError("publication_conflict", "Database conflict"),
    },
    {
      expectedCode: "recording_not_found",
      source: new AgentRuntimeError("recording_prompt_mismatch", "Recording mismatch", false),
    },
  ])(
    "maps a $expectedCode boundary failure without exposing internals",
    async ({ expectedCode, source }) => {
      execute.mockRejectedValueOnce(source);
      const operation = facadeWith(execute).clients.list({ limit: 25, status: "active" }, context);

      await expect(operation).rejects.toMatchObject({
        code: expectedCode,
        message: source.message,
      });
    },
  );

  it("sanitizes unexpected Error and non-Error failures", async () => {
    for (const source of [new Error("sensitive detail"), "non-error sensitive detail"]) {
      execute.mockRejectedValueOnce(source);
      await expect(
        facadeWith(execute).clients.list({ limit: 25, status: "active" }, context),
      ).rejects.toMatchObject({
        code: "internal_error",
        message: "The operation could not be completed.",
      });
    }
  });

  it("sanitizes a typed database connectivity failure without inspecting its message", async () => {
    const source = Object.assign(new Error("raw host and database details"), {
      code: "ECONNREFUSED",
    });
    execute.mockRejectedValueOnce(source);

    await expect(
      facadeWith(execute).clients.list({ limit: 25, status: "active" }, context),
    ).rejects.toMatchObject({
      code: "dependency_unavailable",
      message: "A required service is temporarily unavailable.",
    });

    execute.mockRejectedValueOnce(new Error("connect ECONNREFUSED private-db:5432"));
    await expect(
      facadeWith(execute).clients.list({ limit: 25, status: "active" }, context),
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "The operation could not be completed.",
    });
  });
});
