import path from "node:path";

import { apiContracts } from "@spotter/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { closeBackend } from "@spotter/backend/server";
import { GET as listClients } from "../../src/app/api/v1/clients/route";
import { GET as live } from "../../src/app/health/live/route";
import { GET as ready } from "../../src/app/health/ready/route";

describe("real PGlite route smoke", () => {
  beforeAll(() => {
    Object.assign(process.env, {
      AI_MODE: "recorded",
      ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
      APP_ENV: "demo",
      DATABASE_MODE: "pglite",
      DATA_POLICY: "synthetic_only",
      MIGRATIONS_DIR: path.resolve(import.meta.dirname, "../../../backend/migrations"),
      PGLITE_DATA_DIR: "memory://",
    });
  });

  afterAll(async () => {
    await closeBackend();
  });

  it("serves process liveness without touching the database", async () => {
    const response = live();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("initializes the recorded PGlite backend and serves a contract-valid client list", async () => {
    const response = await listClients(new Request("http://local/api/v1/clients?limit=10"));
    expect(response.status).toBe(200);
    const envelope = apiContracts.clients.list.output.parse(await response.json());
    expect(envelope.error).toBeNull();
    expect(envelope.data).toHaveLength(7);
    expect(envelope.meta).toMatchObject({ cursor: null, hasMore: false, total: 7 });
  });

  it("reports schema and database readiness through the backend boundary", async () => {
    const response = await ready();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      dependencies: { database: "ready", schema: "ready" },
      status: "ready",
    });
  });
});
