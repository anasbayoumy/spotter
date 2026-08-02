import { contextTraceSchema } from "@spotter/contracts";
import { describe, expect, it } from "vitest";

import {
  ApplicationModelGateway,
  DeterministicRedFlagAdapter,
  Sha256Fingerprint,
} from "./runtime-adapters";

const trace = contextTraceSchema.parse({
  budget: 100,
  clientId: "00000000-0000-4000-8000-000000000101",
  createdAt: "2026-08-02T12:00:00.000Z",
  id: "00000000-0000-4000-8000-000000008601",
  intent: "programme",
  rendered: "Synthetic context",
  sections: [],
  tokenCount: 4,
  turnId: "00000000-0000-4000-8000-000000008602",
});

describe("runtime adapter release boundaries", () => {
  it("fails explicitly when live mode has no configured provider", async () => {
    const gateway = new ApplicationModelGateway({ mode: "live", recordings: [] });

    await expect(gateway.generateProgramme(trace)).rejects.toMatchObject({
      code: "dependency_unavailable",
      message: "Live mode requires an explicitly configured provider adapter.",
      retryable: false,
    });
  });

  it("provides deterministic red-flag escalation and request fingerprints", async () => {
    const redFlags = new DeterministicRedFlagAdapter();
    expect(redFlags.hasRedFlag("I have chest pain during training")).toBe(true);
    expect(redFlags.hasRedFlag("Synthetic check-in is normal")).toBe(false);
    await expect(redFlags.escalate()).resolves.toBeUndefined();

    const fingerprint = new Sha256Fingerprint();
    expect(fingerprint.fingerprint({ a: 1 })).toMatch(/^[a-f0-9]{64}$/u);
    expect(fingerprint.fingerprint({ a: 1 })).toBe(fingerprint.fingerprint({ a: 1 }));
    expect(fingerprint.fingerprint({ a: 1 })).not.toBe(fingerprint.fingerprint({ a: 2 }));
  });
});
