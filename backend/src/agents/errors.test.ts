import { describe, expect, it } from "vitest";

import { AgentRuntimeError, toAgentRuntimeError } from "./errors.js";

describe("agent error mapping", () => {
  it("preserves typed errors and sanitizes dependency failures", () => {
    const typed = new AgentRuntimeError("recording_not_found", "missing", false);
    expect(toAgentRuntimeError(typed)).toBe(typed);
    expect(toAgentRuntimeError(new Error("provider secret response"))).toMatchObject({
      code: "dependency_unavailable",
      message: "The model dependency failed",
    });
    expect(toAgentRuntimeError(new DOMException("aborted", "AbortError"))).toMatchObject({
      code: "model_timeout",
      retryable: true,
    });
  });
});
