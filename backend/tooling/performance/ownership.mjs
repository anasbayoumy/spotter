import { canonicalJson } from "./evidence.mjs";
import { recordedWeekStart } from "./fixtures.mjs";

export function performanceOwnership(runId) {
  if (!/^\d{14}-[a-z0-9][a-z0-9-]{0,30}-[a-f0-9]{6}$/u.test(runId)) {
    throw new Error("Invalid performance ownership run identity.");
  }
  return Object.freeze({
    runKeyPrefix: `perf-${runId}-`,
    runProgrammeAttemptPrefix: `programme:perf-${runId}-`,
    weeklyClientKeyPrefix: `weekly-plan:${recordedWeekStart}:`,
    weeklyProgrammeAttemptPrefix: `programme:weekly-plan:${recordedWeekStart}:`,
    weeklyStableKey: `weekly-plan:${recordedWeekStart}`,
  });
}

export function assertZeroOwnedRows(counts, label) {
  if (counts === null || typeof counts !== "object" || Array.isArray(counts)) {
    throw new Error(`${label} ownership evidence is malformed.`);
  }
  const residue = Object.entries(counts).filter(
    ([, value]) => !Number.isSafeInteger(value) || value !== 0,
  );
  if (Object.keys(counts).length === 0 || residue.length > 0) {
    throw new Error(
      `${label} ownership residue: ${
        residue.map(([key, value]) => `${key}=${String(value)}`).join(", ") || "no counters"
      }`,
    );
  }
  return counts;
}

export class CleanupOwnershipLease {
  #acquired = false;

  publicLabel;

  constructor(label) {
    if (typeof label !== "string" || label.trim().length === 0) {
      throw new Error("Cleanup ownership requires a label.");
    }
    this.publicLabel = label;
  }

  get acquired() {
    return this.#acquired;
  }

  acquire(zeroEvidence) {
    if (this.#acquired)
      throw new Error(`${this.publicLabel} cleanup ownership is already acquired.`);
    assertZeroOwnedRows(zeroEvidence, this.publicLabel);
    this.#acquired = true;
    return zeroEvidence;
  }
}

export function assertExistingClientStatePreserved(before, after) {
  const beforeClients = before?.clients;
  const afterClients = after?.clients;
  if (
    beforeClients === null ||
    afterClients === null ||
    typeof beforeClients !== "object" ||
    typeof afterClients !== "object"
  ) {
    throw new Error("Canonical client-state snapshot is malformed.");
  }
  for (const [id, client] of Object.entries(beforeClients)) {
    if (canonicalJson(afterClients[id]) !== canonicalJson(client)) {
      throw new Error(`Pre-existing canonical client ${id} was changed by the performance corpus.`);
    }
  }
  const beforeGuards = before.messageGuards;
  const afterGuards = after.messageGuards;
  if (
    beforeGuards === null ||
    afterGuards === null ||
    typeof beforeGuards !== "object" ||
    typeof afterGuards !== "object"
  ) {
    throw new Error("Canonical message-guard snapshot is malformed.");
  }
  for (const [id, guard] of Object.entries(beforeGuards)) {
    if (canonicalJson(afterGuards[id]) !== canonicalJson(guard)) {
      throw new Error(`Pre-existing message guard ${id} was changed by the performance corpus.`);
    }
  }
  return after;
}

export function assertExactClientStateRestored(before, after) {
  if (canonicalJson(after) !== canonicalJson(before)) {
    throw new Error("Canonical client state was not restored exactly after performance cleanup.");
  }
  return after;
}
