export type AgentRuntimeErrorCode =
  | "context_hard_constraints_exceed_budget"
  | "dependency_unavailable"
  | "model_output_invalid"
  | "model_timeout"
  | "recording_not_found"
  | "recording_prompt_mismatch"
  | "validation_failed";

export class AgentRuntimeError extends Error {
  public constructor(
    public readonly code: AgentRuntimeErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}

export function toAgentRuntimeError(error: unknown): AgentRuntimeError {
  if (error instanceof AgentRuntimeError) return error;
  if (error instanceof ZodError) {
    return new AgentRuntimeError("model_output_invalid", "The model output is invalid", false);
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new AgentRuntimeError("model_timeout", "The model request exceeded its deadline", true);
  }
  return new AgentRuntimeError("dependency_unavailable", "The model dependency failed", true);
}
import { ZodError } from "zod";
