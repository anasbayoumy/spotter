import { programmeModelOutputSchema, type ProgrammeModelOutput } from "@spotter/contracts";

import type { AgentExecutionRequest } from "./runtime/runner";
import type { AgentRunner } from "./runtime/runner";

export type ProgrammeAgentRequest = Omit<AgentExecutionRequest, "intent">;

export class ProgrammeAgent {
  public constructor(private readonly runner: AgentRunner) {}

  public async generate(request: ProgrammeAgentRequest): Promise<ProgrammeModelOutput> {
    return this.runner.execute({ ...request, intent: "programme" }, (output) =>
      programmeModelOutputSchema.parse(output),
    );
  }
}
