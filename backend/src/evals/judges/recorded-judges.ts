import type { JudgeResult, JudgeScore } from "../types";
import type { Judge, JudgeInput } from "./judge";

abstract class RecordedJudge implements Judge {
  abstract readonly name: JudgeResult["name"];
  abstract readonly rubricVersion: string;

  evaluate(input: JudgeInput): Promise<JudgeResult> {
    const evaluation = this.score(input);
    return Promise.resolve({
      judgeModel: `recorded/${this.name}-${this.rubricVersion}`,
      name: this.name,
      rationale: evaluation.rationale,
      rubricVersion: this.rubricVersion,
      score: evaluation.score,
    });
  }

  protected abstract score(input: JudgeInput): Readonly<{ rationale: string; score: JudgeScore }>;
}

export class RecordedGroundingJudge extends RecordedJudge {
  readonly name = "grounding" as const;
  readonly rubricVersion = "v1";

  protected score(input: JudgeInput): Readonly<{ rationale: string; score: JudgeScore }> {
    const sections = new Set(input.sectionIds);
    const fabricated =
      input.signals.fabricatedCitation || input.citations.some((id) => !sections.has(id));
    if (fabricated || input.citations.length === 0) {
      return {
        rationale: "A citation is fabricated or no grounding citation was supplied.",
        score: 1,
      };
    }
    if (input.signals.unsupportedSpecifics) {
      return {
        rationale: "Output is context-consistent but contains unsupported specifics.",
        score: 3,
      };
    }
    return {
      rationale: "Every supplied citation resolves to an available context section.",
      score: 5,
    };
  }
}

export class RecordedCoherenceJudge extends RecordedJudge {
  readonly name = "coherence" as const;
  readonly rubricVersion = "v1";

  protected score(input: JudgeInput): Readonly<{ rationale: string; score: JudgeScore }> {
    if (input.signals.criticalCoherenceIssue) {
      return {
        rationale: "Programming logic contains a critical schedule, equipment, or load conflict.",
        score: 1,
      };
    }
    if (input.signals.coherenceIssues > 1) {
      return { rationale: "Programming logic contains several unresolved conflicts.", score: 2 };
    }
    if (input.signals.coherenceIssues === 1) {
      return {
        rationale: "Programming is plausible but one material conflict remains unresolved.",
        score: 3,
      };
    }
    return {
      rationale: "Programming is coherent with the supplied schedule, equipment, and history.",
      score: 5,
    };
  }
}

export class RecordedConsistencyJudge extends RecordedJudge {
  readonly name = "consistency" as const;
  readonly rubricVersion = "v1";

  protected score(input: JudgeInput): Readonly<{ rationale: string; score: JudgeScore }> {
    if (input.signals.contradictsHistory && !input.signals.acknowledgesChange) {
      return {
        rationale:
          "Output contradicts current history or preference without acknowledging the change.",
        score: 2,
      };
    }
    if (input.signals.contradictsHistory) {
      return { rationale: "Output acknowledges and explains the documented change.", score: 4 };
    }
    return {
      rationale: "Output does not contradict current programme history or preferences.",
      score: 5,
    };
  }
}

export class RecordedInterventionJudge extends RecordedJudge {
  readonly name = "intervention" as const;
  readonly rubricVersion = "v1";

  protected score(input: JudgeInput): Readonly<{ rationale: string; score: JudgeScore }> {
    const signals = [
      input.signals.interventionReferencesGoal,
      input.signals.interventionReferencesSession,
      input.signals.tierProportionate,
    ];
    const satisfied = signals.filter(Boolean).length;
    if (satisfied === 3)
      return { rationale: "Intervention is specific, goal-linked, and proportionate.", score: 5 };
    if (satisfied === 2)
      return { rationale: "Intervention is useful but misses one contextual element.", score: 4 };
    if (satisfied === 1)
      return { rationale: "Intervention is weakly contextualized or disproportionate.", score: 2 };
    return { rationale: "Intervention is generic and disproportionate to the evidence.", score: 1 };
  }
}

export const recordedJudges: readonly Judge[] = [
  new RecordedGroundingJudge(),
  new RecordedCoherenceJudge(),
  new RecordedConsistencyJudge(),
  new RecordedInterventionJudge(),
];
