import { z } from "zod";

import type { EvaluationIntent, JudgeName, JudgeResult } from "../types.js";

export const judgeInputSchema = z
  .object({
    citations: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
    claims: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
    fixtureId: z.string().trim().min(1).max(120),
    intent: z.enum(["accountability", "adjustment", "programme"]),
    sectionIds: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
    signals: z
      .object({
        acknowledgesChange: z.boolean().default(false),
        coherenceIssues: z.number().int().min(0).max(100).default(0),
        contradictsHistory: z.boolean().default(false),
        criticalCoherenceIssue: z.boolean().default(false),
        fabricatedCitation: z.boolean().default(false),
        interventionReferencesGoal: z.boolean().default(true),
        interventionReferencesSession: z.boolean().default(true),
        tierProportionate: z.boolean().default(true),
        unsupportedSpecifics: z.boolean().default(false),
      })
      .strict()
      .default({
        acknowledgesChange: false,
        coherenceIssues: 0,
        contradictsHistory: false,
        criticalCoherenceIssue: false,
        fabricatedCitation: false,
        interventionReferencesGoal: true,
        interventionReferencesSession: true,
        tierProportionate: true,
        unsupportedSpecifics: false,
      }),
  })
  .strict();

export type JudgeInput = z.infer<typeof judgeInputSchema>;

export interface Judge {
  readonly name: JudgeName;
  readonly rubricVersion: string;
  evaluate(input: JudgeInput): Promise<JudgeResult>;
}

export function requiredJudgeNames(intent: EvaluationIntent): readonly JudgeName[] {
  return intent === "accountability"
    ? ["grounding", "intervention"]
    : ["grounding", "coherence", "consistency"];
}
