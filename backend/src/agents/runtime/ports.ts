import type { AgentIntent, ContextTraceAttempt } from "../context/types";
import type { ModelMode, ModelUsage } from "../gateway/model-gateway";

export interface AgentClock {
  now(): Date;
  monotonicMilliseconds(): number;
}

export interface AgentIdGenerator {
  next(): string;
}

export interface ContextTracePort {
  create(trace: ContextTraceAttempt): Promise<void>;
}

export interface AgentRunTelemetry {
  readonly id: string;
  readonly attemptKey: string;
  readonly agent: AgentIntent;
  readonly mode: ModelMode;
  readonly promptVersion: string;
  readonly schemaFailure: boolean;
  readonly schemaRetryCount: 0 | 1;
  readonly model: string;
  readonly traceId: string;
  readonly usage: ModelUsage | null;
  readonly latencyMs: number;
  readonly output: unknown;
  readonly errorCode: string | null;
  readonly createdAt: string;
}

export interface AgentRunPort {
  create(run: AgentRunTelemetry): Promise<void>;
}
