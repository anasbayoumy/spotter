import { judgeResultSchema } from "@spotter/contracts";

import { LiveModelGateway } from "../../agents/gateway/live-gateway";
import { OpenAICompatibleTransport } from "../../agents/gateway/openai-compatible-transport";
import type { JudgeResult } from "../types";
import type { Judge, JudgeInput } from "./judge";

const outputSchema = judgeResultSchema.pick({ rationale: true, score: true }).strict();
const liveJudgeDeadlineMilliseconds = 120_000;

const rubricPrompts = {
  coherence: `You are the programme-coherence judge. Score only the supplied agent output against
the supplied client fixture. Use this exact rubric: 1 for a critical schedule, equipment, or load
conflict; 2 for several unresolved conflicts; 3 for one material unresolved conflict; 5 when the
programme is coherent with schedule, equipment, and history. Use 4 only when it is stronger than 3
but has a minor non-material issue. Return only the requested JSON score and concise rationale.`,
  consistency: `You are the history-consistency judge. Score only the supplied agent output against
the supplied client fixture. Use this exact rubric: 2 when the output contradicts current history or
preference without acknowledging the change; 4 when it acknowledges and explains a documented
change; 5 when it does not contradict current history or preferences. Use 1 for a severe direct
contradiction and 3 for an ambiguous material inconsistency. Return only the requested JSON score
and concise rationale.`,
  grounding: `You are the citation-grounding judge. Score only the supplied agent output, context
trace section ids, and client fixture. Use this exact rubric: 1 if a citation is fabricated or none
is supplied; 3 when citations resolve but the output contains unsupported specifics; 5 when every
citation resolves and every specific claim is supported. Use 2 or 4 only for intermediate cases.
Return only the requested JSON score and concise rationale.`,
  intervention: `You are the accountability-intervention judge. Score only the supplied agent
output against the supplied client fixture. Use this exact rubric: 5 when the intervention is
specific, goal-linked, session-linked, and proportionate; 4 when it misses one contextual element;
2 when only one of those elements is satisfied; 1 when it is generic and disproportionate. Use 3
only for a genuinely intermediate case. Return only the requested JSON score and concise rationale.`,
} as const;

interface LiveJudgeOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly name: JudgeResult["name"];
}

function parseJudgeScore(score: number): JudgeResult["score"] {
  switch (score) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      return score;
    default:
      throw new Error("Judge score is outside the supported rubric.");
  }
}

export class LiveJudge implements Judge {
  public readonly name: JudgeResult["name"];
  public readonly rubricVersion = "v1";
  readonly #gateway: LiveModelGateway;

  public constructor(options: LiveJudgeOptions) {
    this.name = options.name;
    this.#gateway = new LiveModelGateway(
      new OpenAICompatibleTransport({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        outputDescription:
          '{"score":1|2|3|4|5,"rationale":"concise non-empty text"}. No other keys.',
        outputSchema,
        schemaName: `${options.name} judge output`,
      }),
      { modelId: options.modelId },
    );
  }

  public async evaluate(input: JudgeInput): Promise<JudgeResult> {
    if (input.agentOutput === undefined || input.clientFixture === undefined) {
      throw new Error(`Live ${this.name} judge requires agent output and a client fixture.`);
    }
    const response = await this.#gateway.generate({
      context: JSON.stringify({
        agentOutput: input.agentOutput,
        clientFixture: input.clientFixture,
        contextTraceSectionIds: input.sectionIds,
      }),
      intent: input.intent,
      promptVersion: this.rubricVersion,
      recordingKey: `judge.${this.name}`,
      signal: AbortSignal.timeout(liveJudgeDeadlineMilliseconds),
      system: rubricPrompts[this.name],
      traceId: input.fixtureId,
    });
    const result = outputSchema.parse(response.output);
    return {
      judgeModel: this.#gateway.modelId,
      name: this.name,
      rationale: result.rationale,
      rubricVersion: this.rubricVersion,
      score: parseJudgeScore(result.score),
    };
  }
}

export function createLiveJudges(options: Omit<LiveJudgeOptions, "name">): readonly Judge[] {
  return (["grounding", "coherence", "consistency", "intervention"] as const).map(
    (name) => new LiveJudge({ ...options, name }),
  );
}
