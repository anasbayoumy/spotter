import { beforeEach, describe, expect, it, vi } from "vitest";

const backendReadiness = vi.hoisted(() => vi.fn<() => Promise<{ readonly ready: boolean }>>());

vi.mock("@spotter/backend/server", () => ({ getBackendReadiness: backendReadiness }));

import { GET as live } from "../../src/app/health/live/route";
import { GET as ready } from "../../src/app/health/ready/route";

describe("health endpoint resilience", () => {
  beforeEach(() => {
    backendReadiness.mockReset();
  });

  it("keeps liveness independent from database state", async () => {
    backendReadiness.mockRejectedValue(new Error("postgres://user:secret@private-host/database"));
    const response = live();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(backendReadiness).not.toHaveBeenCalled();
  });

  it("fails readiness safely for unavailable or unhealthy dependencies", async () => {
    backendReadiness
      .mockResolvedValueOnce({ ready: false })
      .mockRejectedValueOnce(new Error("postgres://user:secret@private-host/database"));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await ready();
      expect(response.status).toBe(503);
      const serialized = JSON.stringify(await response.json());
      expect(serialized).toBe('{"status":"unavailable"}');
      expect(serialized).not.toContain("secret");
    }
  });

  it("recovers when the dependency becomes ready", async () => {
    backendReadiness
      .mockRejectedValueOnce(new Error("temporary database outage"))
      .mockResolvedValueOnce({ ready: true });
    expect((await ready()).status).toBe(503);
    const recovered = await ready();
    expect(recovered.status).toBe(200);
    await expect(recovered.json()).resolves.toEqual({
      dependencies: { database: "ready", schema: "ready" },
      status: "ready",
    });
  });
});
