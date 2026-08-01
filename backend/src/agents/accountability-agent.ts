import {
  accountabilityModelOutputSchema,
  type AccountabilityModelOutput,
} from "@spotter/contracts";

import { AgentRuntimeError } from "./errors.js";
import type { AgentExecutionRequest } from "./runtime/runner.js";
import type { AgentRunner } from "./runtime/runner.js";

type DraftableTier = 1 | 2 | 3;
type AccountabilityAgentRequest = Omit<AgentExecutionRequest, "intent"> & {
  readonly deterministicTier: DraftableTier;
};

const kindByTier = {
  1: "client_nudge",
  2: "reduced_plan_offer",
  3: "coach_context_brief",
} as const;

export class AccountabilityAgent {
  public constructor(private readonly runner: AgentRunner) {}

  public async generate(request: AccountabilityAgentRequest): Promise<AccountabilityModelOutput> {
    return this.runner.execute({ ...request, intent: "accountability" }, (output) => {
      const parsed = accountabilityModelOutputSchema.safeParse(output);
      if (
        !parsed.success ||
        parsed.data.tier !== request.deterministicTier ||
        parsed.data.kind !== kindByTier[request.deterministicTier]
      ) {
        throw new AgentRuntimeError(
          "model_output_invalid",
          "Accountability output does not match the deterministic tier",
          false,
        );
      }
      return parsed.data;
    });
  }
}
