import { describe, expect, it, vi } from "vitest";

import { OpenAICompatibleTransport } from "../../agents/gateway/openai-compatible-transport.js";
import type { JudgeInput } from "./judge.js";
import { createLiveJudges, LiveJudge } from "./live-judges.js";

const input: JudgeInput = {
  agentOutput: { answer: "agent output only" },
  citations: [],
  claims: [],
  clientFixture: { id: "synthetic-client", goal: "strength" },
  fixtureId: "fixture-1",
  intent: "programme",
  sectionIds: ["ctx-01", "ctx-03"],
  signals: {
    acknowledgesChange: false,
    coherenceIssues: 0,
    contradictsHistory: false,
    criticalCoherenceIssue: false,
    fabricatedCitation: false,
    interventionReferencesGoal: true,
    interventionReferencesSession: true,
    tierProportionate: true,
    unsupportedSpecifics: false,
  },
};

describe("live judges", () => {
  it("runs each rubric separately with only output, trace ids, and client fixture", async () => {
    const generate = vi
      .spyOn(OpenAICompatibleTransport.prototype, "generate")
      .mockResolvedValueOnce({
        output: { rationale: "A critical rubric failure.", score: 1 },
        usage: { costUsd: 0, inputTokens: 3, outputTokens: 2 },
      })
      .mockResolvedValueOnce({
        output: { rationale: "Several rubric failures.", score: 2 },
        usage: { costUsd: 0, inputTokens: 3, outputTokens: 2 },
      })
      .mockResolvedValueOnce({
        output: { rationale: "An intermediate rubric result.", score: 3 },
        usage: { costUsd: 0, inputTokens: 3, outputTokens: 2 },
      })
      .mockResolvedValueOnce({
        output: { rationale: "A strong rubric result.", score: 4 },
        usage: { costUsd: 0, inputTokens: 3, outputTokens: 2 },
      })
      .mockResolvedValueOnce({
        output: { rationale: "The supplied evidence satisfies this rubric.", score: 5 },
        usage: { costUsd: 0, inputTokens: 3, outputTokens: 2 },
      });
    const judges = createLiveJudges({
      apiKey: "test-key",
      baseUrl: "http://model.test/v1",
      modelId: "judge-a",
    });

    const results = await Promise.all(judges.map((judge) => judge.evaluate(input)));
    expect(results.map((result) => result.name)).toEqual([
      "grounding",
      "coherence",
      "consistency",
      "intervention",
    ]);
    expect(results.map((result) => result.score)).toEqual([1, 2, 3, 4]);
    expect(results.every((result) => result.judgeModel === "judge-a")).toBe(true);
    await expect(judges[0]?.evaluate(input)).resolves.toMatchObject({ score: 5 });
    expect(generate).toHaveBeenCalledTimes(5);
    expect(new Set(generate.mock.calls.map(([request]) => request.system)).size).toBe(4);
    for (const [request] of generate.mock.calls) {
      expect(JSON.parse(request.context)).toEqual({
        agentOutput: input.agentOutput,
        clientFixture: input.clientFixture,
        contextTraceSectionIds: input.sectionIds,
      });
      expect(request.context).not.toMatch(/generatorPrompt|reasoning/u);
      expect(request.model).toBe("judge-a");
    }
  });

  it("fails closed when either required blind-judge input is absent", async () => {
    const judge = new LiveJudge({
      apiKey: "test-key",
      baseUrl: "http://model.test/v1",
      modelId: "judge-a",
      name: "grounding",
    });
    await expect(judge.evaluate({ ...input, agentOutput: undefined })).rejects.toThrow(
      /requires agent output and a client fixture/u,
    );
    await expect(judge.evaluate({ ...input, clientFixture: undefined })).rejects.toThrow(
      /requires agent output and a client fixture/u,
    );
  });
});
