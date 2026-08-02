import {
  accountabilityModelOutputSchema,
  adjustmentModelOutputSchema,
  createCheckInRequestSchema,
  generateAdjustmentRequestSchema,
  generateProgrammeRequestSchema,
  lifecycleMutationRequestSchema,
  programmeModelOutputSchema,
  runAccountabilityRequestSchema,
} from "@spotter/contracts";
import { describe, expect, it } from "vitest";

const ids = {
  client: "00000000-0000-4000-8000-000000001001",
  exercise: "00000000-0000-4000-8000-000000001002",
} as const;
const citation = {
  claim: "Synthetic evidence supports the model output.",
  recordIds: [ids.client],
  sectionId: "ctx-02-goal-profile-equipment-schedule",
};
const exercise = {
  family: "squat" as const,
  id: ids.exercise,
  muscleGroups: ["quadriceps"],
  name: "Goblet squat",
  notes: null,
  reps: 8,
  restSeconds: 90,
  rpe: 7,
  sets: 3,
};
const payload = {
  days: [
    {
      dayIndex: 1,
      exercises: [exercise],
      focus: "Synthetic strength session",
      scheduledDate: "2026-08-03",
    },
  ],
  summary: "Synthetic weekly programme.",
};
const programme = { citations: [citation], payload };
const adjustment = {
  citations: [citation],
  operations: [
    {
      exerciseId: ids.exercise,
      percent: 10,
      rationale: "Synthetic fatigue response.",
      type: "reduce_load" as const,
    },
  ],
};

describe("model output boundary properties", () => {
  it("QA-SAF-058: rejects extra, missing, truncated, and type-confused programme output", () => {
    const invalidOutputs: readonly unknown[] = [
      JSON.stringify(programme).slice(0, -1),
      { payload },
      { ...programme, autoApply: true },
      { ...programme, citations: [] },
      {
        ...programme,
        payload: {
          ...payload,
          days: [{ ...payload.days[0], exercises: [{ ...exercise, sets: "3" }] }],
        },
      },
      {
        ...programme,
        payload: {
          ...payload,
          days: [{ ...payload.days[0], exercises: [{ ...exercise, publish: true }] }],
        },
      },
    ];
    for (const candidate of invalidOutputs) {
      expect(programmeModelOutputSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("QA-SAF-058: rejects auto-apply, unknown operations, extra fields, and type confusion", () => {
    const invalidOutputs: readonly unknown[] = [
      { ...adjustment, autoApply: true },
      { ...adjustment, citations: [] },
      {
        ...adjustment,
        operations: [{ ...adjustment.operations[0], percent: "10" }],
      },
      {
        ...adjustment,
        operations: [
          {
            exerciseId: ids.exercise,
            rationale: "Synthetic mutation.",
            type: "publish_programme",
          },
        ],
      },
      {
        ...adjustment,
        operations: [{ ...adjustment.operations[0], approvedBy: ids.client }],
      },
    ];
    for (const candidate of invalidOutputs) {
      expect(adjustmentModelOutputSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("couples every draftable accountability tier to exactly one permitted content kind", () => {
    const expectedKind = {
      1: "client_nudge",
      2: "reduced_plan_offer",
      3: "coach_context_brief",
    } as const;
    const kinds = ["client_nudge", "reduced_plan_offer", "coach_context_brief"] as const;
    for (const tier of [1, 2, 3] as const) {
      for (const kind of kinds) {
        const result = accountabilityModelOutputSchema.safeParse({
          body: "Synthetic accountability copy.",
          citations: [citation],
          kind,
          tier,
        });
        expect(result.success, `tier=${String(tier)} kind=${kind}`).toBe(
          kind === expectedKind[tier],
        );
      }
    }
  });

  it("rejects accountability attempts to choose delivery, ownership, or recipient", () => {
    for (const authorityField of [
      { actor: "agent" },
      { automatedSendAllowed: true },
      { owner: "automation" },
      { recipient: ids.client },
      { send: true },
    ]) {
      expect(
        accountabilityModelOutputSchema.safeParse({
          body: "Synthetic accountability copy.",
          citations: [citation],
          kind: "client_nudge",
          tier: 1,
          ...authorityField,
        }).success,
      ).toBe(false);
    }
  });
});

describe("public request boundary authority properties", () => {
  it("rejects spoofed system-owned fields across mutation request schemas", () => {
    const cases = [
      [
        generateProgrammeRequestSchema,
        { clientId: ids.client, targetWeekStart: "2026-08-03" },
        [{ actorId: ids.client }, { gates: [] }, { status: "published" }, { output: programme }],
      ],
      [
        generateAdjustmentRequestSchema,
        { clientId: ids.client },
        [{ autoApply: true }, { operations: adjustment.operations }, { approvedBy: ids.client }],
      ],
      [
        createCheckInRequestSchema,
        {
          body: "Synthetic check-in.",
          clientId: ids.client,
          readiness: 3,
          respondedAt: "2026-08-03T06:00:00.000Z",
        },
        [{ requiresHumanEscalation: false }, { sentiment: 1 }, { triggerAdjustment: true }],
      ],
      [
        lifecycleMutationRequestSchema,
        { expectedVersion: 1 },
        [{ approval: "override" }, { actorId: ids.client }],
      ],
      [
        runAccountabilityRequestSchema,
        { clientId: ids.client },
        [{ automatedSendAllowed: true }, { owner: "none" }, { tier: 0 }],
      ],
    ] as const;

    for (const [schema, valid, forbiddenFields] of cases) {
      expect(schema.safeParse(valid).success).toBe(true);
      for (const forbidden of forbiddenFields) {
        expect(schema.safeParse({ ...valid, ...forbidden }).success).toBe(false);
      }
    }
  });
});
