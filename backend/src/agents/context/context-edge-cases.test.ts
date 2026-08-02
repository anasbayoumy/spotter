import { describe, expect, it } from "vitest";

import { DeterministicContextAssembler } from "./assemble.js";
import { filterCurrentRecords, rankEligibleNotes } from "./filter-rank.js";
import { renderContext } from "./render.js";
import { stableStringify } from "./stable-json.js";
import { Utf8TokenEstimator, type TokenEstimator } from "./token-estimator.js";
import { contextRecordSchema, type ContextAssemblyRequest, type ContextRecord } from "./types.js";

const effectiveAt = "2026-08-02T12:00:00.000Z";

function record(id: number, overrides: Partial<ContextRecord> = {}): ContextRecord {
  return {
    recordId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    recordVersion: 1,
    source: "edge_fixture",
    content: { value: id },
    createdAt: "2026-08-01T12:00:00.000Z",
    validFrom: "2026-08-01T00:00:00.000Z",
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
    clientId: "00000000-0000-4000-8000-000000000101",
    intent: "programme",
    effectiveAt,
    createdAt: effectiveAt,
    budget: 10_000,
    hardConstraints: [],
    goalProfileEquipmentSchedule: [],
    currentProgramme: [],
    recentSessionsAdherence: [],
    checkInsMetrics: [],
    notes: [],
    softConstraintsOlderSummaries: [],
    ...overrides,
  };
}

class ConstantEstimator implements TokenEstimator {
  public estimate(): number {
    return 1;
  }
}

class SectionCountingEstimator implements TokenEstimator {
  public estimate(text: string): number {
    return text.match(/^## /gmu)?.length ?? 0;
  }
}

describe("context edge cases", () => {
  it("rejects malformed assembly input before selecting context", () => {
    const malformed = { ...request(), budget: 0 };
    expect(() => new DeterministicContextAssembler().assemble(malformed)).toThrowError(
      "Context source input is invalid",
    );
    try {
      new DeterministicContextAssembler().assemble(malformed);
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: "validation_failed", retryable: false });
    }
  });

  it("keeps the hard section absent when no active hard constraints exist", () => {
    const result = new DeterministicContextAssembler().assemble(request());
    expect(result).toMatchObject({
      status: "ready",
      trace: { evictions: [], sections: [], rendered: "" },
    });
  });

  it("replaces an optional section as each additional record fits the budget", () => {
    const older = record(2, { createdAt: null, recordVersion: null });
    const newer = record(1, { createdAt: "2026-08-02T00:00:00.000Z" });
    const result = new DeterministicContextAssembler(new ConstantEstimator()).assemble(
      request({ goalProfileEquipmentSchedule: [older, newer], budget: 1 }),
    );
    expect(result.status).toBe("ready");
    expect(result.trace.sections).toHaveLength(1);
    expect(result.trace.sections[0]?.records.map(({ recordId }) => recordId)).toEqual([
      newer.recordId,
      older.recordId,
    ]);
    expect(result.trace.sections[0]?.rendered).toContain("version=none");
    expect(result.trace.sections[0]?.rendered).toContain("}\n[record=");
    expect(result.trace.tokenCount).toBe(result.trace.budget);
  });

  it("renders concrete versions and marks only hard-constraint sections as pinned", () => {
    const result = new DeterministicContextAssembler().assemble(
      request({
        hardConstraints: [record(3, { recordVersion: 2 })],
        goalProfileEquipmentSchedule: [record(4, { recordVersion: 3 })],
      }),
    );
    expect(result.trace.rendered).toContain("version=2");
    expect(result.trace.rendered).toContain("version=3");
    expect(result.trace.sections.map(({ pinned }) => pinned)).toEqual([true, false]);
  });

  it("budgets an optional candidate together with all previously selected sections", () => {
    const goal = record(5);
    const programme = record(6);
    const result = new DeterministicContextAssembler(new SectionCountingEstimator()).assemble(
      request({
        budget: 1,
        goalProfileEquipmentSchedule: [goal],
        currentProgramme: [programme],
      }),
    );
    expect(result.trace.sections.map(({ kind }) => kind)).toEqual([
      "goal_profile_equipment_schedule",
    ]);
    expect(result.trace.evictions).toEqual([
      {
        recordId: programme.recordId,
        sectionKind: "current_programme",
        reason: "token_budget",
      },
    ]);
  });

  it("replaces the prior candidate when growing one optional section", () => {
    const first = record(7);
    const second = record(8);
    const result = new DeterministicContextAssembler(new SectionCountingEstimator()).assemble(
      request({ budget: 1, goalProfileEquipmentSchedule: [first, second] }),
    );
    expect(result.trace.sections).toHaveLength(1);
    expect(result.trace.sections[0]?.records.map(({ recordId }) => recordId)).toEqual([
      first.recordId,
      second.recordId,
    ]);
    expect(result.trace.evictions).toEqual([]);
  });

  it("filters both temporal boundaries while retaining open-ended active records", () => {
    const future = record(10, { validFrom: "2026-08-02T12:00:00.001Z" });
    const endsExactlyNow = record(11, { validUntil: effectiveAt });
    const openEnded = record(13, { createdAt: null, validFrom: null, validUntil: null });
    const active = record(12, { createdAt: null, validFrom: null, validUntil: null });
    const result = filterCurrentRecords(
      [future, endsExactlyNow, openEnded, active],
      effectiveAt,
      "current_programme",
    );
    expect(result.records.map(({ recordId }) => recordId)).toEqual([
      active.recordId,
      openEnded.recordId,
    ]);
    expect(result.evictions).toEqual([
      {
        recordId: future.recordId,
        sectionKind: "current_programme",
        reason: "not_active_at_effective_time",
      },
      {
        recordId: endsExactlyNow.recordId,
        sectionKind: "current_programme",
        reason: "not_active_at_effective_time",
      },
    ]);
  });

  it("includes a record whose validity starts exactly at the effective instant", () => {
    const startsExactlyNow = record(14, { validFrom: effectiveAt });
    expect(
      filterCurrentRecords([startsExactlyNow], effectiveAt, "current_programme").records,
    ).toEqual([startsExactlyNow]);
  });

  it("sorts active records by descending creation time before the id tie-break", () => {
    const newest = record(20, { createdAt: "2026-08-02T11:00:00.000Z" });
    const tiedHighId = record(22, { createdAt: "2026-08-01T11:00:00.000Z" });
    const tiedLowId = record(21, { createdAt: "2026-08-01T11:00:00.000Z" });
    const noTimestamp = record(23, { createdAt: null });
    const result = filterCurrentRecords(
      [noTimestamp, tiedHighId, newest, tiedLowId],
      effectiveAt,
      "check_ins_metrics",
    );
    expect(result.records).toEqual([newest, tiedLowId, tiedHighId, noTimestamp]);
  });

  it("ranks notes by similarity decay with deterministic null and future handling", () => {
    const recentDefault = record(30, { createdAt: null, similarity: null });
    const future = record(31, {
      createdAt: "2026-08-03T12:00:00.000Z",
      similarity: 0.8,
    });
    const oldRelevant = record(32, {
      createdAt: "2026-05-01T12:00:00.000Z",
      similarity: 1,
    });
    expect(rankEligibleNotes([oldRelevant, recentDefault, future], effectiveAt)).toEqual([
      future,
      recentDefault,
      oldRelevant,
    ]);

    const tiedLeft = record(33, { createdAt: null, similarity: null });
    const tiedRight = record(34, { createdAt: null, similarity: null });
    expect(rankEligibleNotes([tiedRight, tiedLeft], effectiveAt)).toEqual([tiedLeft, tiedRight]);

    const yesterdayRelevant = record(35, {
      createdAt: "2026-08-01T12:00:00.000Z",
      similarity: 1,
    });
    const recentWeak = record(36, { createdAt: effectiveAt, similarity: 0.5 });
    expect(rankEligibleNotes([recentWeak, yesterdayRelevant], effectiveAt)).toEqual([
      yesterdayRelevant,
      recentWeak,
    ]);

    const assembled = new DeterministicContextAssembler().assemble(
      request({ notes: [recentWeak, yesterdayRelevant] }),
    );
    expect(assembled.trace.sections[0]?.records.map(({ recordId }) => recordId)).toEqual([
      yesterdayRelevant.recordId,
      recentWeak.recordId,
    ]);
  });

  it("treats an open lower validity bound as unbounded before the Unix epoch", () => {
    const historicalInstant = "1969-12-31T23:59:59.000Z";
    const openLowerBound = record(37, {
      createdAt: historicalInstant,
      validFrom: null,
      validUntil: "1970-01-01T00:00:00.000Z",
    });
    expect(
      filterCurrentRecords([openLowerBound], historicalInstant, "current_programme").records,
    ).toEqual([openLowerBound]);
  });

  it("normalizes nested JSON and estimates empty and multi-byte context deterministically", () => {
    expect(stableStringify({ z: [{ b: 2, a: true }, null], a: "é" })).toBe(
      '{"a":"é","z":[{"a":true,"b":2},null]}',
    );
    const estimator = new Utf8TokenEstimator();
    expect(estimator.estimate("")).toBe(0);
    expect(estimator.estimate("éé")).toBe(1);
    expect(renderContext([])).toBe("");
  });

  it("applies record defaults and rejects an inverted validity interval", () => {
    const valid = contextRecordSchema.parse({
      recordId: "00000000-0000-4000-8000-000000000041",
      source: "fixture",
      content: false,
    });
    expect(valid).toMatchObject({
      recordVersion: null,
      createdAt: null,
      validFrom: null,
      validUntil: null,
      supersededBy: null,
      similarity: null,
    });

    const invalid = contextRecordSchema.safeParse({
      ...valid,
      validFrom: effectiveAt,
      validUntil: "2026-08-02T11:59:59.999Z",
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues[0]).toMatchObject({
        message: "validUntil must be after validFrom",
        path: ["validUntil"],
      });
    }
    const emptyWindow = contextRecordSchema.safeParse({
      ...valid,
      validFrom: effectiveAt,
      validUntil: effectiveAt,
    });
    expect(emptyWindow.success).toBe(false);
    if (!emptyWindow.success) {
      expect(emptyWindow.error.issues[0]).toMatchObject({
        message: "validUntil must be after validFrom",
        path: ["validUntil"],
      });
    }
  });

  it("accepts multi-version records and trims their source identifier", () => {
    const parsed = contextRecordSchema.parse({
      recordId: "00000000-0000-4000-8000-000000000042",
      recordVersion: 2,
      source: "  synthetic_fixture  ",
      content: { safe: true },
    });
    expect(parsed.recordVersion).toBe(2);
    expect(parsed.source).toBe("synthetic_fixture");
  });

  it("allows an open lower validity bound independently of a historical upper bound", () => {
    expect(
      contextRecordSchema.safeParse({
        recordId: "00000000-0000-4000-8000-000000000043",
        source: "historical_fixture",
        content: { safe: true },
        validFrom: null,
        validUntil: "1969-12-31T23:59:59.999Z",
      }).success,
    ).toBe(true);
  });
});
