import { describe, expect, it } from "vitest";

import { DeterministicContextAssembler } from "./assemble.js";
import type { ContextAssemblyRequest, ContextRecord } from "./types.js";

const asOf = "2026-08-02T12:00:00.000Z";
const clientId = "00000000-0000-4000-8000-000000000101";

function record(id: number, overrides: Partial<ContextRecord> = {}): ContextRecord {
  return {
    recordId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    recordVersion: 1,
    source: "synthetic_fixture",
    content: { value: `record-${String(id)}` },
    createdAt: "2026-08-01T12:00:00.000Z",
    validFrom: "2026-07-01T00:00:00.000Z",
    validUntil: null,
    supersededBy: null,
    similarity: null,
    ...overrides,
  };
}

function request(overrides: Partial<ContextAssemblyRequest> = {}): ContextAssemblyRequest {
  return {
    traceId: "00000000-0000-4000-8000-000000000901",
    turnId: "00000000-0000-4000-8000-000000000902",
    clientId,
    intent: "programme",
    effectiveAt: asOf,
    createdAt: asOf,
    budget: 10_000,
    hardConstraints: [record(201)],
    goalProfileEquipmentSchedule: [record(202)],
    currentProgramme: [record(203)],
    recentSessionsAdherence: [record(204)],
    checkInsMetrics: [record(205)],
    notes: [record(206)],
    softConstraintsOlderSummaries: [record(207)],
    ...overrides,
  };
}

describe("deterministic context assembly", () => {
  it("renders the exact priority order and pins hard constraints", () => {
    const result = new DeterministicContextAssembler().assemble(request());
    expect(result.status).toBe("ready");
    expect(result.trace.sections.map((section) => section.kind)).toEqual([
      "hard_constraints",
      "goal_profile_equipment_schedule",
      "current_programme",
      "recent_sessions_adherence",
      "check_ins_metrics",
      "valid_notes",
      "soft_constraints_older_summaries",
    ]);
    expect(result.trace.sections[0]?.pinned).toBe(true);
    expect(result.trace.tokenCount).toBeLessThanOrEqual(result.trace.budget);
  });

  it("filters expired and superseded notes before ranking eligible notes", () => {
    const activeRelevant = record(211, { similarity: 0.95 });
    const activeLessRelevant = record(212, { similarity: 0.5 });
    const expired = record(213, { similarity: 1, validUntil: asOf });
    const superseded = record(214, {
      similarity: 1,
      supersededBy: "00000000-0000-4000-8000-000000000299",
    });
    const result = new DeterministicContextAssembler().assemble(
      request({ notes: [superseded, activeLessRelevant, expired, activeRelevant] }),
    );
    const noteSection = result.trace.sections.find((section) => section.kind === "valid_notes");
    expect(noteSection?.records.map((entry) => entry.recordId)).toEqual([
      activeRelevant.recordId,
      activeLessRelevant.recordId,
    ]);
    expect(result.trace.evictions).toEqual(
      expect.arrayContaining([
        {
          recordId: expired.recordId,
          sectionKind: "valid_notes",
          reason: "not_active_at_effective_time",
        },
        { recordId: superseded.recordId, sectionKind: "valid_notes", reason: "superseded" },
      ]),
    );
  });

  it("fails visibly without truncating hard constraints when pinned content exceeds budget", () => {
    const hard = record(221, { content: { detail: "x".repeat(2_000) } });
    const result = new DeterministicContextAssembler().assemble(
      request({ budget: 20, hardConstraints: [hard], notes: [record(222)] }),
    );
    expect(result.status).toBe("hard_constraint_overflow");
    expect(result.trace.sections[0]?.records.map((entry) => entry.recordId)).toEqual([
      hard.recordId,
    ]);
    expect(result.trace.sections[0]?.rendered).toContain("x".repeat(2_000));
    expect(result.trace.tokenCount).toBeGreaterThan(result.trace.budget);
  });

  it("is byte-for-byte deterministic and evicts only lower-priority records", () => {
    const constrained = request({
      budget: 180,
      hardConstraints: [record(231)],
      notes: [record(233, { content: { detail: "n".repeat(600) } }), record(232)],
    });
    const assembler = new DeterministicContextAssembler();
    const first = assembler.assemble(constrained);
    const second = assembler.assemble({ ...constrained, notes: [...constrained.notes].reverse() });
    expect(second.trace.rendered).toBe(first.trace.rendered);
    expect(second.trace.evictions).toEqual(first.trace.evictions);
    expect(first.trace.sections[0]?.records[0]?.recordId).toBe(record(231).recordId);
    expect(first.trace.evictions.some((entry) => entry.reason === "token_budget")).toBe(true);
  });
});
