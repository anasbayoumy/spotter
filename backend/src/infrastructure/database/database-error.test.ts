import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { isDatabaseDependencyUnavailable } from "./database-error";

function codedError(code: string, cause?: unknown): Error {
  return Object.assign(new Error("opaque driver failure", cause === undefined ? {} : { cause }), {
    code,
  });
}

function postgresError(code: string): postgres.PostgresError {
  return Object.assign(new postgres.PostgresError("opaque postgres failure"), { code });
}

describe("database dependency error classification", () => {
  it.each([
    "EADDRNOTAVAIL",
    "EAI_AGAIN",
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETDOWN",
    "ENETUNREACH",
    "ENOTFOUND",
    "EPIPE",
    "ERR_SOCKET_CLOSED",
    "ETIMEDOUT",
    "CONNECT_TIMEOUT",
    "CONNECTION_CLOSED",
    "CONNECTION_DESTROYED",
    "CONNECTION_ENDED",
  ])("accepts the typed network/driver code %s", (code) => {
    expect(isDatabaseDependencyUnavailable(codedError(code))).toBe(true);
  });

  it.each(["08000", "08001", "08003", "08006", "08P01", "53300", "57P01", "57P02", "57P03"])(
    "accepts the PostgreSQL availability state %s only on PostgresError",
    (code) => {
      expect(isDatabaseDependencyUnavailable(postgresError(code))).toBe(true);
      expect(isDatabaseDependencyUnavailable(codedError(code))).toBe(false);
    },
  );

  it("walks a bounded, cycle-safe cause chain", () => {
    let withinBound: Error = codedError("ECONNREFUSED");
    for (let depth = 0; depth < 7; depth += 1)
      withinBound = new Error("wrapper", { cause: withinBound });
    expect(isDatabaseDependencyUnavailable(withinBound)).toBe(true);

    let outsideBound: Error = codedError("ECONNREFUSED");
    for (let depth = 0; depth < 8; depth += 1)
      outsideBound = new Error("wrapper", { cause: outsideBound });
    expect(isDatabaseDependencyUnavailable(outsideBound)).toBe(false);

    const cycle = new Error("cycle");
    Object.defineProperty(cycle, "cause", { value: cycle });
    expect(isDatabaseDependencyUnavailable(cycle)).toBe(false);
  });

  it("rejects unknown, non-connectivity, structural, and message-only failures", () => {
    expect(isDatabaseDependencyUnavailable(postgresError("23505"))).toBe(false);
    expect(isDatabaseDependencyUnavailable(codedError("SASL_SIGNATURE_MISMATCH"))).toBe(false);
    expect(isDatabaseDependencyUnavailable({ code: "ECONNREFUSED" })).toBe(false);
    expect(isDatabaseDependencyUnavailable(new Error("connect ECONNREFUSED private-db:5432"))).toBe(
      false,
    );
    expect(isDatabaseDependencyUnavailable(null)).toBe(false);
  });
});
