import {
  adjustmentModelOutputSchema,
  contextTraceSchema,
  programmeModelOutputSchema,
  type ContextTrace,
  type AdjustmentModelOutput,
  type ProgrammeModelOutput,
} from "@spotter/contracts";
import { describe, expect, it } from "vitest";

import { DeterministicEvaluationAdapter } from "../../src/composition/runtime-adapters";

const clientId = "00000000-0000-4000-8000-000000000101";
const traceId = "00000000-0000-4000-8000-000000000201";
const turnId = "00000000-0000-4000-8000-000000000301";
const exerciseId = "00000000-0000-4000-8000-000000000401";
const constraintId = "00000000-0000-4000-8000-000000000501";
const createdAt = "2026-08-03T06:00:00.000Z";

interface TraceValue {
  readonly id: string;
  readonly source: string;
  readonly value: unknown;
  readonly version?: number | null;
}

function section(
  kind: ContextTrace["sections"][number]["kind"],
  id: string,
  records: readonly TraceValue[],
  pinned = false,
): ContextTrace["sections"][number] {
  const rendered = records
    .map(
      (record) =>
        `[record=${record.id}; source=${record.source}; version=${record.version === undefined || record.version === null ? "none" : String(record.version)}]\n${JSON.stringify(record.value)}`,
    )
    .join("\n");
  return {
    id,
    kind,
    pinned,
    records: records.map((record) => ({
      recordId: record.id,
      recordVersion: record.version ?? null,
      source: record.source,
    })),
    rendered,
    tokenEstimate: Buffer.byteLength(rendered, "utf8"),
  };
}

function trace(sections: readonly ContextTrace["sections"][number][]): ContextTrace {
  const rendered = sections.map((entry) => entry.rendered).join("\n\n");
  return contextTraceSchema.parse({
    budget: 100_000,
    clientId,
    createdAt,
    id: traceId,
    intent: "programme",
    rendered,
    sections,
    tokenCount: Buffer.byteLength(rendered, "utf8"),
    turnId,
  });
}

function exercise(
  family = "horizontal_pull",
  sets = 3,
  rpe = 7,
): ProgrammeModelOutput["payload"]["days"][number]["exercises"][number] {
  return {
    family,
    id: exerciseId,
    muscleGroups: ["shoulders"],
    name: family === "overhead_press" ? "Push press" : "Cable row",
    notes: null,
    reps: 8,
    restSeconds: 90,
    rpe,
    sets,
  } as const;
}

function output(
  overrides: Readonly<{
    days?: number;
    family?: string;
    notes?: string | null;
    rpe?: number;
    sets?: number;
    summary?: string;
  }> = {},
): ProgrammeModelOutput {
  const days = Array.from({ length: overrides.days ?? 1 }, (_, index) => ({
    dayIndex: index + 1,
    exercises: [
      {
        ...exercise(overrides.family, overrides.sets, overrides.rpe),
        notes: overrides.notes ?? null,
      },
    ],
    focus: "Synthetic property probe",
    scheduledDate: `2026-08-${String(index + 3).padStart(2, "0")}`,
  }));
  return programmeModelOutputSchema.parse({
    citations: [
      {
        claim: "The synthetic proposal cites selected trace evidence.",
        recordIds: [clientId],
        sectionId: "ctx-02-goal-profile-equipment-schedule",
      },
    ],
    payload: { days, summary: overrides.summary ?? "Synthetic programme." },
  });
}

function adjustmentOutput(
  operation: AdjustmentModelOutput["operations"][number],
): AdjustmentModelOutput {
  return adjustmentModelOutputSchema.parse({
    citations: [
      {
        claim: "The synthetic adjustment cites the current programme.",
        recordIds: [clientId],
        sectionId: "ctx-03-current-programme",
      },
    ],
    operations: [operation],
  });
}

function hardConstraint(
  value: unknown = {
    detail: { forbids: ["overhead_press"] },
    kind: "injury",
    severity: "hard",
  },
): ContextTrace["sections"][number] {
  return section(
    "hard_constraints",
    "ctx-01-hard-constraints",
    [{ id: constraintId, source: "client_constraint", value }],
    true,
  );
}

function gateMap(
  results: Awaited<ReturnType<DeterministicEvaluationAdapter["runGates"]>>,
): Readonly<Record<string, boolean>> {
  return Object.fromEntries(results.map((gate) => [gate.name, gate.passed]));
}

describe("production evaluation adapter safety properties", () => {
  it("never loses a pinned forbidden family when irrelevant notes are added or reordered", async () => {
    const adapter = new DeterministicEvaluationAdapter();
    for (let noteCount = 0; noteCount <= 32; noteCount += 1) {
      const notes = Array.from({ length: noteCount }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(600 + index).padStart(12, "0")}`,
        source: "client_note",
        value: { body: `Synthetic irrelevant note ${String(index)}` },
      }));
      if (noteCount % 2 === 1) notes.reverse();
      const sections = [
        hardConstraint(),
        ...(notes.length === 0 ? [] : [section("valid_notes", "ctx-06-valid-notes", notes, false)]),
      ];
      const gates = gateMap(
        await adapter.runGates("programme", trace(sections), output({ family: "overhead_press" })),
      );
      expect(gates["forbidden_movement"], `noteCount=${String(noteCount)}`).toBe(false);
    }
  });

  it("fails closed when selected pinned constraint evidence is malformed", async () => {
    const adapter = new DeterministicEvaluationAdapter();
    const malformedContent = hardConstraint({ detail: "corrupt", severity: "hard" });
    const validContent = hardConstraint();
    const mismatchedHeader = {
      ...validContent,
      rendered: validContent.rendered.replace("source=client_constraint", "source=client_note"),
    };
    for (const selected of [malformedContent, mismatchedHeader]) {
      const gates = gateMap(await adapter.runGates("programme", trace([selected]), output()));
      expect(gates["unknown_family"]).toBe(false);
    }
  });

  it("QA-SAF-053: blocks every schema-valid spelling of an unknown movement family", async () => {
    const adapter = new DeterministicEvaluationAdapter();
    for (const family of ["teleport", "teleport_press", "mystery_squat", "unknown_family_42"]) {
      const gates = gateMap(await adapter.runGates("programme", trace([]), output({ family })));
      expect(gates["unknown_family"], family).toBe(false);
    }
  });

  it("derives schedule, adherence, and current volume from selected trace records", async () => {
    const adapter = new DeterministicEvaluationAdapter();
    const currentExercise = exercise("horizontal_pull", 10);
    const safetyTrace = trace([
      section("goal_profile_equipment_schedule", "ctx-02-goal-profile-equipment-schedule", [
        {
          id: clientId,
          source: "client_profile",
          value: {
            goals: { primary: "Synthetic goal", secondary: [], targetDate: null },
            profile: {
              ageBand: "25_34",
              equipment: ["cable"],
              sessionsPerWeek: 2,
              sex: "not_specified",
              trainingAgeMonths: 12,
            },
            targetWeekStart: "2026-08-03",
            timezone: "UTC",
          },
        },
      ]),
      section("current_programme", "ctx-03-current-programme", [
        {
          id: "00000000-0000-4000-8000-000000000701",
          source: "programme",
          value: {
            days: [
              {
                dayIndex: 1,
                exercises: [currentExercise],
                focus: "Synthetic baseline",
                scheduledDate: "2026-08-01",
              },
            ],
            summary: "Synthetic current programme.",
          },
          version: 1,
        },
      ]),
      section("recent_sessions_adherence", "ctx-04-recent-sessions-adherence", [
        {
          id: "00000000-0000-4000-8000-000000000801",
          source: "session",
          value: {
            actual: null,
            planned: [currentExercise],
            rpe: null,
            scheduledFor: "2026-08-01",
            status: "missed",
          },
          version: 1,
        },
        {
          id: "00000000-0000-4000-8000-000000000802",
          source: "session",
          value: {
            actual: null,
            planned: [currentExercise],
            rpe: null,
            scheduledFor: "2026-08-02",
            status: "missed",
          },
          version: 1,
        },
      ]),
    ]);
    const gates = gateMap(
      await adapter.runGates(
        "programme",
        safetyTrace,
        output({ days: 3, family: "horizontal_pull", sets: 14 }),
      ),
    );
    expect(gates["frequency_breach"]).toBe(false);
    expect(gates["volume_spike"]).toBe(false);
  });

  it("scans programme prose for prohibited medical claims", async () => {
    const gates = gateMap(
      await new DeterministicEvaluationAdapter().runGates(
        "programme",
        trace([]),
        output({ notes: "Stop medication dosage immediately." }),
      ),
    );
    expect(gates["medical_language"]).toBe(false);
  });

  it("checks adjustment operations against pinned constraints and scans their rationale", async () => {
    const constrainedExercise = exercise("overhead_press", 4, 7);
    const adjustmentTrace = trace([
      hardConstraint(),
      section("current_programme", "ctx-03-current-programme", [
        {
          id: "00000000-0000-4000-8000-000000000901",
          source: "programme",
          value: {
            days: [
              {
                dayIndex: 1,
                exercises: [constrainedExercise],
                focus: "Synthetic baseline",
                scheduledDate: "2026-08-03",
              },
            ],
            summary: "Synthetic current programme.",
          },
          version: 1,
        },
      ]),
    ]);
    const gates = gateMap(
      await new DeterministicEvaluationAdapter().runGates(
        "adjustment",
        adjustmentTrace,
        adjustmentOutput({
          exerciseId,
          rationale: "Decrease medication dosage while reducing volume.",
          setsToRemove: 1,
          type: "reduce_volume",
        }),
      ),
    );
    expect(gates["forbidden_movement"]).toBe(false);
    expect(gates["medical_language"]).toBe(false);
  });
});
