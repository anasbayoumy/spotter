import { z } from "zod";

import {
  calculateAccountabilityTier,
  type AccountabilityTier,
  type EngagementInputs,
} from "../domain/accountability.js";
import { isCurrentAt } from "../domain/temporal.js";
import { runRecordedJudges } from "./judges/run-judges.js";
import { combineEvaluation } from "./review-band.js";
import { safetyInputSchema, safetyExerciseSchema } from "./safety/contracts.js";
import { maximumAutomatedMessages, runDeterministicSafety } from "./safety/run-gates.js";
import type { GateName, ReviewBand } from "./types.js";

const instant = z.coerce.date();
const safetyPatchSchema = safetyInputSchema.omit({ asOf: true, intent: true }).partial().strict();
const judgeSignalsSchema = z
  .object({
    acknowledgesChange: z.boolean().optional(),
    coherenceIssues: z.number().int().min(0).max(100).optional(),
    contradictsHistory: z.boolean().optional(),
    criticalCoherenceIssue: z.boolean().optional(),
    fabricatedCitation: z.boolean().optional(),
    interventionReferencesGoal: z.boolean().optional(),
    interventionReferencesSession: z.boolean().optional(),
    tierProportionate: z.boolean().optional(),
    unsupportedSpecifics: z.boolean().optional(),
  })
  .strict()
  .default({});

const engagementSchema = z
  .object({
    baselineCheckInCount: z.number().int().min(0),
    baselineCheckInLatencyHours: z.number().positive().nullable(),
    completedDue14d: z.number().int().min(0),
    currentCheckInLatencyHours: z.number().min(0).nullable(),
    daysSinceOpen: z.number().int().min(0).nullable(),
    missedDue14d: z.number().int().min(0),
    missedDue7d: z.number().int().min(0),
    plannedDue14d: z.number().int().min(0),
  })
  .strict();

const temporalRecordSchema = z
  .object({
    id: z.string().trim().min(1),
    surfaceEligible: z.boolean().default(true),
    supersededBy: z.string().trim().min(1).nullable().default(null),
    validFrom: instant,
    validUntil: instant.nullable().default(null),
  })
  .strict();

const budgetSchema = z
  .object({
    budget: z.number().int().positive(),
    hardConstraintTokens: z.number().int().min(0),
    optionalSections: z
      .array(z.object({ id: z.string().trim().min(1), tokens: z.number().int().min(0) }).strict())
      .default([]),
  })
  .strict();

const expectedSchema = z
  .object({
    band: z.enum(["attention", "blocked", "clear"]).optional(),
    budgetOutcome: z.enum(["failed", "proceed"]).optional(),
    gate: z
      .enum([
        "adjustment_operation_scope",
        "forbidden_movement",
        "frequency_breach",
        "intensity_ceiling",
        "medical_language",
        "nudge_rate",
        "unknown_family",
        "volume_spike",
      ])
      .optional(),
    maxMessages: z.union([z.literal(0), z.literal(1)]).optional(),
    outcome: z.enum(["accepted", "attention", "blocked", "escalated", "failed"]),
    selectedOptionalSections: z.array(z.string().trim().min(1)).optional(),
    selectedRecordIds: z.array(z.string().trim().min(1)).optional(),
    tier: z
      .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
      .optional(),
  })
  .strict();

export const goldenFixtureSchema = z
  .object({
    asOf: instant,
    attentionReasons: z.array(z.string().trim().min(1)).default([]),
    budget: budgetSchema.optional(),
    bucket: z.string().trim().min(1),
    citations: z.array(z.string().trim().min(1)).default(["goal"]),
    clientTimezone: z.string().trim().min(1),
    description: z.string().trim().min(1),
    engagement: engagementSchema.optional(),
    expected: expectedSchema,
    id: z.string().regex(/^QA-SAF-\d{3}$/u),
    intent: z.enum(["accountability", "adjustment", "programme"]),
    safety: safetyPatchSchema.default({}),
    schemaVersion: z.literal(1),
    sectionIds: z.array(z.string().trim().min(1)).default(["goal", "history"]),
    signals: judgeSignalsSchema,
    temporalRecords: z.array(temporalRecordSchema).default([]),
  })
  .strict();

export const goldenManifestSchema = z
  .object({ cases: z.array(goldenFixtureSchema).length(50), schemaVersion: z.literal(1) })
  .strict();

export type GoldenFixture = z.infer<typeof goldenFixtureSchema>;
export type GoldenManifest = z.infer<typeof goldenManifestSchema>;

export interface ContextBudgetResult {
  readonly outcome: "failed" | "proceed";
  readonly selectedOptionalSections: readonly string[];
}

export interface GoldenEvaluationResult {
  readonly band: ReviewBand;
  readonly blockedGate: GateName | null;
  readonly budget: ContextBudgetResult | null;
  readonly maxMessages: 0 | 1;
  readonly outcome: "accepted" | "attention" | "blocked" | "escalated" | "failed";
  readonly selectedRecordIds: readonly string[];
  readonly tier: AccountabilityTier | null;
}

export function evaluatePinnedContextBudget(rawBudget: unknown): ContextBudgetResult {
  const budget = budgetSchema.parse(rawBudget);
  if (budget.hardConstraintTokens > budget.budget) {
    return { outcome: "failed", selectedOptionalSections: [] };
  }
  let remaining = budget.budget - budget.hardConstraintTokens;
  const selectedOptionalSections: string[] = [];
  for (const section of budget.optionalSections) {
    if (section.tokens <= remaining) {
      selectedOptionalSections.push(section.id);
      remaining -= section.tokens;
    }
  }
  return { outcome: "proceed", selectedOptionalSections };
}

const defaultExercise = safetyExerciseSchema.parse({
  family: "horizontal_pull",
  id: "safe-row",
  muscleGroups: ["back"],
  name: "Cable row",
  rpe: 7,
  sets: 3,
});

export async function evaluateGoldenFixture(rawFixture: unknown): Promise<GoldenEvaluationResult> {
  const fixture = goldenFixtureSchema.parse(rawFixture);
  const safetyInput = safetyInputSchema.parse({
    adherence14d: null,
    adjustment: null,
    allowedSessions: 3,
    asOf: fixture.asOf,
    checkInText: "",
    constraints: [],
    exercises: [defaultExercise],
    intent: fixture.intent,
    nudge: null,
    outputText: "A safe evidence-linked proposal.",
    plannedSessions: 3,
    volumeChanges: [],
    ...fixture.safety,
  });
  const budget = fixture.budget === undefined ? null : evaluatePinnedContextBudget(fixture.budget);
  const selectedRecordIds = fixture.temporalRecords
    .filter(
      (record) =>
        record.surfaceEligible &&
        isCurrentAt(
          {
            supersededBy: record.supersededBy,
            validFrom: record.validFrom,
            validUntil: record.validUntil,
          },
          fixture.asOf,
        ),
    )
    .map((record) => record.id);
  const tier: AccountabilityTier | null =
    fixture.engagement === undefined
      ? null
      : calculateAccountabilityTier(fixture.engagement as EngagementInputs);
  const safety = runDeterministicSafety(safetyInput);
  const blockedGate = safety.gates.find((gate) => !gate.passed)?.name ?? null;
  const maxMessages = maximumAutomatedMessages(safetyInput);

  if (budget?.outcome === "failed") {
    return {
      band: "blocked",
      blockedGate,
      budget,
      maxMessages,
      outcome: "failed",
      selectedRecordIds,
      tier,
    };
  }
  if (safety.outcome === "escalated" || (tier !== null && tier >= 3)) {
    return {
      band: "blocked",
      blockedGate,
      budget,
      maxMessages,
      outcome: "escalated",
      selectedRecordIds,
      tier,
    };
  }
  if (safety.outcome === "blocked") {
    return {
      band: "blocked",
      blockedGate,
      budget,
      maxMessages,
      outcome: "blocked",
      selectedRecordIds,
      tier,
    };
  }

  const judges = await runRecordedJudges(fixture.intent, {
    citations: fixture.citations,
    claims: [fixture.description],
    fixtureId: fixture.id,
    intent: fixture.intent,
    sectionIds: fixture.sectionIds,
    signals: fixture.signals,
  });
  const proposal = combineEvaluation(safety, judges, fixture.intent, fixture.attentionReasons);
  return {
    band: proposal.reviewBand,
    blockedGate,
    budget,
    maxMessages,
    outcome: proposal.reviewBand === "attention" ? "attention" : "accepted",
    selectedRecordIds,
    tier,
  };
}
