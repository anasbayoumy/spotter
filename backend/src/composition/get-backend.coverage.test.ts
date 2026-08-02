import { parseServerEnvironment } from "@spotter/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DatabaseAdapter, DatabaseSession } from "../infrastructure/database/index";
import type { BackendFacade } from "./backend-facade";
import { createBackend } from "./create-backend";
import { closeBackend, getBackend, getBackendReadiness } from "./get-backend";

vi.mock("./create-backend", () => ({ createBackend: vi.fn() }));

const createBackendMock = vi.mocked(createBackend);
const environment = parseServerEnvironment({ APP_ENV: "test" });

function runtime(health: { readonly migrationVersion: string | null; readonly ok: boolean }): {
  readonly adapter: DatabaseAdapter;
  readonly close: ReturnType<typeof vi.fn>;
  readonly environment: typeof environment;
  readonly facade: BackendFacade;
} {
  const facade = new Proxy({}, {}) as BackendFacade;
  // No database query is made by the runtime-cache adapter test; this inert session proves only
  // health/close delegation while retaining the production DatabaseAdapter surface.
  const database = {} as DatabaseSession;
  const close = vi.fn(() => Promise.resolve());
  return {
    adapter: {
      capabilities: {
        advisoryLocks: false,
        authoritative: false,
        concurrentTransactions: false,
        hnswVectorIndex: false,
      },
      close,
      database,
      healthCheck: vi.fn(() =>
        Promise.resolve({
          dialect: "pglite" as const,
          migrationVersion: health.migrationVersion,
          ok: health.ok,
          pgVersion: "16",
          vectorVersion: health.ok ? "0.7.4" : null,
        }),
      ),
      transaction: (work) => work(database),
    },
    close,
    environment,
    facade,
  };
}

describe("backend runtime cache", () => {
  afterEach(async () => {
    await closeBackend();
    createBackendMock.mockReset();
    Reflect.deleteProperty(globalThis, "__spotterBackendRuntime");
  });

  it("does nothing when no runtime has been initialized", async () => {
    await expect(closeBackend()).resolves.toBeUndefined();
    expect(createBackendMock).not.toHaveBeenCalled();
  });

  it("shares one initialized facade, reports readiness, and closes once", async () => {
    const value = runtime({ migrationVersion: "migration-hash", ok: true });
    createBackendMock.mockResolvedValue(value);

    await expect(Promise.all([getBackend(), getBackend()])).resolves.toEqual([
      value.facade,
      value.facade,
    ]);
    await expect(getBackendReadiness()).resolves.toEqual({ ready: true });
    expect(createBackendMock).toHaveBeenCalledOnce();
    await closeBackend();
    expect(value.close).toHaveBeenCalledOnce();
  });

  it("requires both health and migration, and resets a failed initialization", async () => {
    const unhealthy = runtime({ migrationVersion: null, ok: true });
    const recovered = runtime({ migrationVersion: "migration-hash", ok: true });
    createBackendMock
      .mockRejectedValueOnce(new Error("synthetic initialization failure"))
      .mockResolvedValueOnce(unhealthy)
      .mockResolvedValueOnce(recovered);

    await expect(getBackend()).rejects.toThrow("synthetic initialization failure");
    await expect(getBackendReadiness()).resolves.toEqual({ ready: false });
    await closeBackend();
    await expect(getBackendReadiness()).resolves.toEqual({ ready: true });
    expect(createBackendMock).toHaveBeenCalledTimes(3);
  });
});
