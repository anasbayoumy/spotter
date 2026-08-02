import { adjustmentModelOutputSchema, type AdjustmentModelOutput } from "@spotter/contracts";

import type { AgentExecutionRequest } from "./runtime/runner";
import type { AgentRunner } from "./runtime/runner";

export type AdjustmentAgentRequest = Omit<AgentExecutionRequest, "intent">;

export class AdjustmentAgent {
  public constructor(private readonly runner: AgentRunner) {}

  public async generate(request: AdjustmentAgentRequest): Promise<AdjustmentModelOutput> {
    return this.runner.execute({ ...request, intent: "adjustment" }, (output) =>
      adjustmentModelOutputSchema.parse(output),
    );
  }
}
