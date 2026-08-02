import { programmePayloadSchema } from "@spotter/contracts";
import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEMO_ANCHOR, demoSeedDataset } from "../../resources/demo/index.js";
import type { ExecutionContext } from "../../src/application/core.js";
import {
  adjustments,
  BufferedAgentAuditRepository,
  coachActions,
  DrizzleAdjustmentRepository,
  migratePgliteDatabase,
  PgliteDatabaseAdapter,
  programmes,
  seedDemoDatabase,
} from "../../src/infrastructure/database/index.js";

const adjustmentId = "00000000-0000-4000-8000-000000001001";
const baseProgrammeId = "00000000-0000-4000-8000-000000000607";
const sourceExerciseId = "00000000-0000-4000-8000-000000000301";
const coachId = "00000000-0000-4000-8000-000000000001";
const context: ExecutionContext = {
  actorId: coachId,
  effectiveAt: DEMO_ANCHOR,
  idempotencyKey: "edit-adjustment-pglite",
  requestId: "edit-adjustment-pglite",
};
const seededOperations = [
  {
    exerciseId: sourceExerciseId,
    rationale: "Synthetic readiness is below the configured threshold.",
    setsToRemove: 1,
    type: "reduce_volume" as const,
  },
];

describe("PGlite adjustment editing", () => {
  let adapter: PgliteDatabaseAdapter;
  let repository: DrizzleAdjustmentRepository;

  beforeEach(async () => {
    adapter = await PgliteDatabaseAdapter.create();
    await migratePgliteDatabase(adapter, "migrations");
    await seedDemoDatabase(adapter.database, demoSeedDataset);
    repository = new DrizzleAdjustmentRepository(
      adapter,
      new BufferedAgentAuditRepository(adapter.database),
    );
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("persists a reducing edit, version, and structured audit without applying it", async () => {
    const [beforeProgrammes] = await adapter.database.select({ value: count() }).from(programmes);
    const operation = {
      exerciseId: sourceExerciseId,
      rationale: "Reduce synthetic volume while readiness is low.",
      setsToRemove: 2,
      type: "reduce_volume" as const,
    };

    const edited = await repository.edit({
      adjustmentId,
      context,
      expectedVersion: 1,
      operations: [operation],
      reason: "Coach selected a smaller reduction.",
    });

    const actions = await adapter.database
      .select()
      .from(coachActions)
      .where(eq(coachActions.adjustmentId, adjustmentId));
    const [afterProgrammes] = await adapter.database.select({ value: count() }).from(programmes);
    expect(edited).toMatchObject({
      appliedProgrammeId: null,
      operations: [operation],
      status: "queued",
      version: 2,
    });
    expect(afterProgrammes?.value).toBe(beforeProgrammes?.value);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      action: "edited",
      reason: "Coach selected a smaller reduction.",
      requestId: context.requestId,
    });
    expect(actions[0]?.diff).toEqual({
      after: { operations: [operation], version: 2 },
      before: {
        operations: [
          {
            exerciseId: sourceExerciseId,
            rationale: "Synthetic readiness is below the configured threshold.",
            setsToRemove: 1,
            type: "reduce_volume",
          },
        ],
        version: 1,
      },
    });
  });

  it("accepts draft edits and validates a referenced swap equivalence", async () => {
    await adapter.database
      .update(adjustments)
      .set({ status: "draft" })
      .where(eq(adjustments.id, adjustmentId));
    const operation = {
      equivalenceId: "20000000-0000-4000-8000-000000000001",
      exerciseId: sourceExerciseId,
      rationale: "Use the documented synthetic equivalent.",
      replacementFamily: "horizontal_pull" as const,
      replacementName: "Seated cable row",
      type: "swap_exercise" as const,
    };
    await expect(
      repository.edit({
        adjustmentId,
        context,
        expectedVersion: 1,
        operations: [operation],
        reason: undefined,
      }),
    ).resolves.toMatchObject({ operations: [operation], status: "draft", version: 2 });
  });

  it("edits and approves a prescribed load reduction without changing sets or RPE", async () => {
    const operation = {
      exerciseId: sourceExerciseId,
      percent: 25,
      rationale: "Reduce the prescribed synthetic load.",
      type: "reduce_load" as const,
    };
    await expect(
      repository.edit({
        adjustmentId,
        context,
        expectedVersion: 1,
        operations: [operation],
        reason: "Coach reduced the load.",
      }),
    ).resolves.toMatchObject({ operations: [operation], version: 2 });
    const programme = await repository.approve({
      adjustmentId,
      approval: "standard",
      context,
      expectedVersion: 2,
      reason: "Coach approved the reduced load.",
    });
    expect(programme.payload.days[0]?.exercises[0]).toMatchObject({
      loadKg: 30,
      rpe: 7,
      sets: 4,
    });
    const [storedProgramme, actions] = await Promise.all([
      adapter.database.query.programmes.findFirst({
        where: eq(programmes.id, programme.id),
      }),
      adapter.database
        .select()
        .from(coachActions)
        .where(eq(coachActions.adjustmentId, adjustmentId)),
    ]);
    expect(storedProgramme?.approvalKind).toBe("standard");
    expect(actions.some((action) => action.action === "approved")).toBe(true);
  });

  it("fails closed when a load reduction targets a bodyweight prescription", async () => {
    const base = await adapter.database.query.programmes.findFirst({
      where: eq(programmes.id, baseProgrammeId),
    });
    if (base === undefined) throw new Error("Expected the adjustment base programme.");
    const payload = structuredClone(programmePayloadSchema.parse(base.payload));
    const exercise = payload.days[0]?.exercises[0];
    if (exercise === undefined) throw new Error("Expected one prescribed exercise.");
    exercise.loadKg = null;
    const persistedPayload = {
      ...payload,
      days: payload.days.map((day) => ({
        ...day,
        exercises: day.exercises.map((candidate) => ({
          ...candidate,
          loadKg: candidate.loadKg ?? null,
        })),
      })),
    };
    await adapter.database
      .update(programmes)
      .set({ payload: persistedPayload })
      .where(eq(programmes.id, baseProgrammeId));
    await expect(
      repository.edit({
        adjustmentId,
        context,
        expectedVersion: 1,
        operations: [
          {
            exerciseId: sourceExerciseId,
            percent: 25,
            rationale: "No explicit load exists.",
            type: "reduce_load",
          },
        ],
        reason: undefined,
      }),
    ).rejects.toMatchObject({
      code: "unsupported_adjustment",
      message: "The programme does not store a load prescription to reduce safely.",
    });
  });

  it("approves an exact documented swap", async () => {
    const operation = {
      equivalenceId: "20000000-0000-4000-8000-000000000001",
      exerciseId: sourceExerciseId,
      rationale: "Use the code-owned equivalent.",
      replacementFamily: "horizontal_pull" as const,
      replacementName: "Seated cable row",
      type: "swap_exercise" as const,
    };
    await adapter.database
      .update(adjustments)
      .set({ operations: [operation] })
      .where(eq(adjustments.id, adjustmentId));
    const programme = await repository.approve({
      adjustmentId,
      approval: "standard",
      context,
      expectedVersion: 1,
      reason: "Coach approved the exact equivalent.",
    });
    expect(programme.payload.days[0]?.exercises[0]).toMatchObject({
      family: "horizontal_pull",
      name: "Seated cable row",
    });
  });

  it("requires an explicit reasoned override for a blocked adjustment", async () => {
    await adapter.database
      .update(adjustments)
      .set({ reviewBand: "blocked" })
      .where(eq(adjustments.id, adjustmentId));
    await expect(
      repository.approve({
        adjustmentId,
        approval: "standard",
        context,
        expectedVersion: 1,
        reason: undefined,
      }),
    ).rejects.toMatchObject({ code: "blocked_requires_override" });
    await expect(
      repository.approve({
        adjustmentId,
        approval: "override",
        context,
        expectedVersion: 1,
        reason: "  ",
      }),
    ).rejects.toMatchObject({ code: "override_reason_required" });

    const programme = await repository.approve({
      adjustmentId,
      approval: "override",
      context,
      expectedVersion: 1,
      reason: "  Coach accepts the documented blocked finding.  ",
    });
    const action = await adapter.database.query.coachActions.findFirst({
      where: eq(coachActions.adjustmentId, adjustmentId),
    });
    const storedProgramme = await adapter.database.query.programmes.findFirst({
      where: eq(programmes.id, programme.id),
    });
    expect(storedProgramme?.approvalKind).toBe("override");
    expect(action).toMatchObject({
      action: "overrode_block",
      reason: "Coach accepts the documented blocked finding.",
    });
  });

  it("rejects override for a nonblocked adjustment", async () => {
    await expect(
      repository.approve({
        adjustmentId,
        approval: "override",
        context,
        expectedVersion: 1,
        reason: "Not eligible for override.",
      }),
    ).rejects.toMatchObject({ code: "invalid_state_transition" });
  });

  it("publishes the deterministic blocked adjustment seed only by override", async () => {
    const blockedSeedId = "00000000-0000-4000-8000-000000001002";
    await expect(
      repository.approve({
        adjustmentId: blockedSeedId,
        approval: "standard",
        context,
        expectedVersion: 1,
        reason: undefined,
      }),
    ).rejects.toMatchObject({ code: "blocked_requires_override" });
    await expect(
      repository.approve({
        adjustmentId: blockedSeedId,
        approval: "override",
        context,
        expectedVersion: 1,
        reason: "Coach accepts the deterministic blocked fixture.",
      }),
    ).resolves.toMatchObject({ status: "published", version: 2 });
  });

  it.each([
    {
      equivalenceId: "20000000-0000-4000-8000-000000009999",
      exerciseId: sourceExerciseId,
      rationale: "Unknown equivalence.",
      replacementFamily: "horizontal_pull" as const,
      replacementName: "Seated cable row",
      type: "swap_exercise" as const,
    },
    {
      equivalenceId: "20000000-0000-4000-8000-000000000001",
      exerciseId: sourceExerciseId,
      rationale: "Mismatched name.",
      replacementFamily: "horizontal_pull" as const,
      replacementName: "Invented replacement",
      type: "swap_exercise" as const,
    },
    {
      equivalenceId: "20000000-0000-4000-8000-000000000001",
      exerciseId: sourceExerciseId,
      rationale: "Mismatched family.",
      replacementFamily: "squat" as const,
      replacementName: "Seated cable row",
      type: "swap_exercise" as const,
    },
  ])("rejects an unproven swap during approval", async (operation) => {
    await adapter.database
      .update(adjustments)
      .set({ operations: [operation] })
      .where(eq(adjustments.id, adjustmentId));
    await expect(
      repository.approve({
        adjustmentId,
        approval: "standard",
        context,
        expectedVersion: 1,
        reason: "Coach attempted an unproven swap.",
      }),
    ).rejects.toMatchObject({ code: "unsupported_adjustment" });
    expect(await repository.get(adjustmentId)).toMatchObject({ status: "queued", version: 1 });
  });

  it.each([
    [
      {
        exerciseId: sourceExerciseId,
        rationale: "Would remove every set.",
        setsToRemove: 4,
        type: "reduce_volume" as const,
      },
      "Adjustment would remove every prescribed set.",
    ],
    [
      {
        exerciseId: "00000000-0000-4000-8000-000000009991",
        rationale: "Unknown source exercise.",
        setsToRemove: 1,
        type: "reduce_volume" as const,
      },
      "Adjustment references an unknown exercise.",
    ],
    [
      {
        equivalenceId: "00000000-0000-4000-8000-000000009992",
        exerciseId: sourceExerciseId,
        rationale: "Unknown equivalence.",
        replacementFamily: "horizontal_pull" as const,
        replacementName: "Seated cable row",
        type: "swap_exercise" as const,
      },
      "Adjustment references an unknown exercise equivalence.",
    ],
    [
      {
        equivalenceId: "20000000-0000-4000-8000-000000000001",
        exerciseId: sourceExerciseId,
        rationale: "Mismatched name.",
        replacementFamily: "horizontal_pull" as const,
        replacementName: "Arbitrary unlisted row",
        type: "swap_exercise" as const,
      },
      "Adjustment equivalence does not match the replacement exercise name.",
    ],
    [
      {
        equivalenceId: "20000000-0000-4000-8000-000000000001",
        exerciseId: sourceExerciseId,
        rationale: "Mismatched family.",
        replacementFamily: "squat" as const,
        replacementName: "Seated cable row",
        type: "swap_exercise" as const,
      },
      "Adjustment equivalence does not match the replacement movement family.",
    ],
    [
      {
        equivalenceId: "20000000-0000-4000-8000-000000000002",
        exerciseId: sourceExerciseId,
        rationale: "Mismatched source family.",
        replacementFamily: "squat" as const,
        replacementName: "Goblet squat",
        type: "swap_exercise" as const,
      },
      "Adjustment equivalence does not match the source movement family.",
    ],
  ])("rejects an unsafe or unresolved operation", async (operation, message) => {
    await expect(
      repository.edit({
        adjustmentId,
        context,
        expectedVersion: 1,
        operations: [operation],
        reason: undefined,
      }),
    ).rejects.toMatchObject({ code: "unsupported_adjustment", message });
    expect(await repository.get(adjustmentId)).toMatchObject({ version: 1 });
  });

  it("returns typed not-found, version, state, and stale-base conflicts", async () => {
    await expect(
      repository.edit({
        adjustmentId: "00000000-0000-4000-8000-000000009999",
        context,
        expectedVersion: 1,
        operations: seededOperations,
        reason: undefined,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      repository.edit({
        adjustmentId,
        context,
        expectedVersion: 2,
        operations: seededOperations,
        reason: undefined,
      }),
    ).rejects.toMatchObject({ code: "version_conflict" });

    await adapter.database
      .update(adjustments)
      .set({ status: "rejected" })
      .where(eq(adjustments.id, adjustmentId));
    await expect(
      repository.edit({
        adjustmentId,
        context,
        expectedVersion: 1,
        operations: seededOperations,
        reason: undefined,
      }),
    ).rejects.toMatchObject({ code: "invalid_state_transition" });

    await adapter.database
      .update(adjustments)
      .set({ status: "queued" })
      .where(eq(adjustments.id, adjustmentId));
    await adapter.database
      .update(programmes)
      .set({ status: "superseded", supersededBy: "00000000-0000-4000-8000-000000000601" })
      .where(eq(programmes.id, baseProgrammeId));
    await expect(
      repository.edit({
        adjustmentId,
        context,
        expectedVersion: 1,
        operations: seededOperations,
        reason: undefined,
      }),
    ).rejects.toMatchObject({ code: "stale_adjustment" });
  });
});
