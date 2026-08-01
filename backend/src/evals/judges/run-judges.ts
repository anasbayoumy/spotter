import type { EvaluationIntent, JudgeResult } from "../types";
import { judgeInputSchema, requiredJudgeNames, type Judge, type JudgeInput } from "./judge";
import { recordedJudges } from "./recorded-judges";

export async function runRecordedJudges(
  intent: EvaluationIntent,
  rawInput: unknown,
  judges: readonly Judge[] = recordedJudges,
): Promise<readonly JudgeResult[]> {
  const input: JudgeInput = judgeInputSchema.parse(rawInput);
  if (input.intent !== intent)
    throw new Error("Judge input intent does not match evaluation intent.");
  const byName = new Map(judges.map((judge) => [judge.name, judge]));
  return Promise.all(
    requiredJudgeNames(intent).map((name) => {
      const judge = byName.get(name);
      if (judge === undefined) throw new Error(`Required ${name} judge is not configured.`);
      return judge.evaluate(input);
    }),
  );
}

export function assertIndependentModels(generatorModel: string, judgeModel: string): void {
  const generator = generatorModel.trim().toLowerCase();
  const judge = judgeModel.trim().toLowerCase();
  if (generator.length === 0 || judge.length === 0) {
    throw new Error("Generator and judge model identifiers must be non-empty.");
  }
  if (generator === judge) {
    throw new Error("Generator and judge model identifiers must differ.");
  }
}
