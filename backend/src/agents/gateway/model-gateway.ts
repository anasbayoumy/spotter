import type { AgentIntent } from "../context/types.js";

export type ModelMode = "recorded" | "live";

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface ModelGatewayRequest {
  readonly intent: AgentIntent;
  readonly recordingKey: string;
  readonly traceId: string;
  readonly promptVersion: string;
  readonly system: string;
  readonly context: string;
  readonly signal: AbortSignal;
}

export interface ModelGatewayResponse {
  readonly output: unknown;
  readonly usage: ModelUsage | null;
}

export interface ModelGateway {
  readonly mode: ModelMode;
  readonly modelId: string;
  generate(request: ModelGatewayRequest): Promise<ModelGatewayResponse>;
}
