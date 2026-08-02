import { describe, expect, it } from "vitest";

import { DeterministicContextAssembler } from "../../src/agents/context/assemble";
import { filterCurrentRecords } from "../../src/agents/context/filter-rank";
import type { ContextAssemblyRequest, ContextRecord } from "../../src/agents/context/types";

const effectiveAt = "2026-08-03T06:00:00.000Z";
const effectiveTime = new Date(effectiveAt).valueOf();
const clientId = "00000000-0000-4000-8000-000000000101";

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function record(index: number, overrides: Partial<ContextRecord> = {}): ContextRecord {
  return {
    content: { value: `synthetic-${String(index)}` },
    createdAt: "2026-08-01T00:00:00.000Z",
    recordId: uuid(index),
    recordVersion: 1,
    similarity: null,
    source: "property_fixture",
    supersededBy: null,
    validFrom: "2026-07-01T00:00:00.000Z",
    validUntil: null,
    ...overrides,
  };
}

function request(overrides: Partial<ContextAssemblyRequest> = {}): ContextAssemblyRequest {
  return {
    budget: 100_000,
    checkInsMetrics: [],
    clientId,
    createdAt: effectiveAt,
    currentProgramme: [],
    effectiveAt,
    goalProfileEquipmentSchedule: [],
    hardConstraints: [],
    intent: "programme",
    notes: [],
    recentSessionsAdherence: [],
    softConstraintsOlderSummaries: [],
    traceId: uuid(9001),
    turnId: uuid(9002),
    ...overrides,
  };
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const random = deterministicRandom(seed);
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const selected = result[index];
    const displaced = result[target];
    if (selected === undefined || displaced === undefined) continue;
    result[index] = displaced;
    result[target] = selected;
  }
  return result;
}

describe("deterministic context selection properties", () => {
  it("QA-SAF-051: irrelevant note quantity and order cannot alter pinned constraints", () => {
    const assembler = new DeterministicContextAssembler();
    const hardConstraints = [
      record(101, { createdAt: "2026-08-02T00:00:00.000Z" }),
      record(102, { createdAt: "2026-08-01T00:00:00.000Z" }),
      record(103, { createdAt: "2026-07-31T00:00:00.000Z" }),
    ];
    const baseline = assembler.assemble(request({ hardConstraints }));
    const pinned = baseline.trace.sections.find((section) => section.kind === "hard_constraints");
    expect(pinned).toBeDefined();

    for (let seed = 1; seed <= 64; seed += 1) {
      const noteCount = seed * 3;
      const notes = shuffled(
        Array.from({ length: noteCount }, (_, index) =>
          record(1_000 + index, {
            content: { body: `Synthetic irrelevant note ${String(index)}` },
            similarity: (index % 10) / 10,
          }),
        ),
        seed,
      );
      const result = assembler.assemble(
        request({ hardConstraints: shuffled(hardConstraints, seed + 100), notes }),
      );
      const actual = result.trace.sections.find((section) => section.kind === "hard_constraints");
      expect(actual?.records, `seed=${String(seed)}`).toEqual(pinned?.records);
      expect(actual?.rendered, `seed=${String(seed)}`).toBe(pinned?.rendered);
      expect(actual?.pinned, `seed=${String(seed)}`).toBe(true);
    }
  });

  it("QA-SAF-052: shrinking budgets never truncate or partially evict pinned records", () => {
    const assembler = new DeterministicContextAssembler();
    const hardConstraints = [
      record(201, { content: { detail: "x".repeat(600) } }),
      record(202, { content: { detail: "y".repeat(600) } }),
    ];
    const unconstrained = assembler.assemble(request({ hardConstraints }));
    const expected = unconstrained.trace.sections.find(
      (section) => section.kind === "hard_constraints",
    );
    expect(expected).toBeDefined();

    for (const budget of [1, 8, 32, 128, 512, 1_024, 2_048, 4_096]) {
      const result = assembler.assemble(
        request({
          budget,
          goalProfileEquipmentSchedule: [record(203, { content: { value: "z".repeat(2_000) } })],
          hardConstraints,
          notes: [record(204, { content: { value: "n".repeat(2_000) } })],
        }),
      );
      const pinned = result.trace.sections.find((section) => section.kind === "hard_constraints");
      expect(pinned?.records, `budget=${String(budget)}`).toEqual(expected?.records);
      expect(pinned?.rendered, `budget=${String(budget)}`).toBe(expected?.rendered);
      if (result.status === "ready") expect(result.trace.tokenCount).toBeLessThanOrEqual(budget);
      else expect(result.trace.tokenCount).toBeGreaterThan(budget);
    }
  });

  it("QA-SAF-054: arbitrary valid windows obey half-open and supersession filtering", () => {
    for (let seed = 1; seed <= 128; seed += 1) {
      const random = deterministicRandom(seed);
      const records = Array.from({ length: 40 }, (_, index) => {
        const startOffset = Math.floor(random() * 201) - 100;
        const duration = Math.floor(random() * 200) + 1;
        const start = effectiveTime + startOffset * 1_000;
        const end = start + duration * 1_000;
        const superseded = random() < 0.25;
        return record(seed * 100 + index + 1, {
          supersededBy: superseded ? uuid(900_000 + seed * 100 + index) : null,
          validFrom: new Date(start).toISOString(),
          validUntil: new Date(end).toISOString(),
        });
      });
      const expectedIds = records
        .filter((candidate) => {
          const starts = new Date(candidate.validFrom ?? 0).valueOf();
          const ends = new Date(candidate.validUntil ?? 0).valueOf();
          return candidate.supersededBy === null && starts <= effectiveTime && effectiveTime < ends;
        })
        .map((candidate) => candidate.recordId)
        .sort();
      const actualIds = filterCurrentRecords(
        shuffled(records, seed + 1_000),
        effectiveAt,
        "valid_notes",
      )
        .records.map((candidate) => candidate.recordId)
        .sort();
      expect(actualIds, `seed=${String(seed)}`).toEqual(expectedIds);
    }
  });
});
