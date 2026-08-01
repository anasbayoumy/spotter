import type {
  AccountabilityModelOutput,
  Adjustment,
  AdjustmentModelOutput,
  AdjustmentTrigger,
  CheckIn,
  ClientDetail,
  ClientSummary,
  ContextTrace,
  EngagementInputs,
  GateResult,
  JudgeResult,
  Programme,
  ProgrammeModelOutput,
  ProgrammePayload,
  ProgrammeReview,
  ReviewBand,
  Session,
} from "@spotter/contracts";

import type { AccountabilityStateValue, AccountabilityTier } from "../domain/index";
import type { ExecutionContext } from "./core";
import type { AccountabilityDetail, InAppMessage, Scorecard, Today } from "./read-models";

export type AgentKind = "programme" | "adjustment" | "accountability";
export type EvaluatedOutput =
  | ProgrammeModelOutput
  | AdjustmentModelOutput
  | AccountabilityModelOutput;

export interface AssembledContext {
  readonly trace: ContextTrace;
}

export interface ClientReadPort {
  listSyntheticActive(): Promise<readonly ClientSummary[]>;
  getDetail(clientId: string, effectiveAt: Date): Promise<ClientDetail | undefined>;
  getToday(clientId: string, effectiveAt: Date): Promise<Today | undefined>;
  listVisibleMessages(clientId: string): Promise<readonly InAppMessage[]>;
}

export interface ProgrammePort {
  list(input: {
    readonly clientId?: string;
    readonly status?: string;
    readonly band?: ReviewBand;
  }): Promise<readonly Programme[]>;
  getReview(programmeId: string): Promise<ProgrammeReview | undefined>;
  queueGenerated(input: {
    readonly clientId: string;
    readonly payload: ProgrammePayload;
    readonly band: ReviewBand;
    readonly traceId: string;
    readonly runId: string;
    readonly gates: readonly GateResult[];
    readonly judges: readonly JudgeResult[];
    readonly context: ExecutionContext;
  }): Promise<ProgrammeReview>;
  edit(input: {
    readonly programmeId: string;
    readonly payload: ProgrammePayload;
    readonly expectedVersion: number;
    readonly gates: readonly GateResult[];
    readonly band: ReviewBand;
    readonly context: ExecutionContext;
  }): Promise<ProgrammeReview>;
  reject(input: {
    readonly programmeId: string;
    readonly expectedVersion: number;
    readonly reason: string | undefined;
    readonly context: ExecutionContext;
  }): Promise<Programme>;
  publish(input: {
    readonly programmeId: string;
    readonly expectedVersion: number;
    readonly approval: "standard" | "override";
    readonly reason: string | undefined;
    readonly context: ExecutionContext;
  }): Promise<Programme>;
}

export interface SessionPort {
  list(input: {
    readonly clientId: string;
    readonly from?: string;
    readonly to?: string;
  }): Promise<readonly Session[]>;
  get(sessionId: string): Promise<Session | undefined>;
  log(input: {
    readonly sessionId: string;
    readonly clientId: string;
    readonly actual: Session["actual"];
    readonly notes: string | null;
    readonly expectedVersion: number;
    readonly context: ExecutionContext;
  }): Promise<Session>;
  complete(input: {
    readonly sessionId: string;
    readonly clientId: string;
    readonly rpe: number;
    readonly performedAt: string;
    readonly expectedVersion: number;
    readonly context: ExecutionContext;
  }): Promise<Session>;
}

export interface CheckInPort {
  create(input: {
    readonly clientId: string;
    readonly readiness: number;
    readonly body: string;
    readonly respondedAt: string;
    readonly requiresHumanEscalation: boolean;
    readonly context: ExecutionContext;
  }): Promise<CheckIn>;
}

export interface AdjustmentPort {
  list(input: {
    readonly clientId?: string;
    readonly status?: string;
  }): Promise<readonly Adjustment[]>;
  resolveGenerationInput(input: {
    readonly clientId: string;
    readonly sourceEventKey: string | undefined;
    readonly actorId: string;
  }): Promise<
    | {
        readonly baseProgrammeId: string;
        readonly sourceEventKey: string;
        readonly trigger: AdjustmentTrigger;
      }
    | undefined
  >;
  queueGenerated(input: {
    readonly clientId: string;
    readonly baseProgrammeId: string;
    readonly sourceEventKey: string;
    readonly trigger: AdjustmentTrigger;
    readonly output: AdjustmentModelOutput;
    readonly band: ReviewBand;
    readonly traceId: string;
    readonly runId: string;
    readonly gates: readonly GateResult[];
    readonly judges: readonly JudgeResult[];
    readonly context: ExecutionContext;
  }): Promise<Adjustment>;
  get(adjustmentId: string): Promise<Adjustment | undefined>;
  approve(input: {
    readonly adjustmentId: string;
    readonly expectedVersion: number;
    readonly reason: string | undefined;
    readonly context: ExecutionContext;
  }): Promise<Programme>;
  reject(input: {
    readonly adjustmentId: string;
    readonly expectedVersion: number;
    readonly reason: string | undefined;
    readonly context: ExecutionContext;
  }): Promise<Adjustment>;
}

export interface ContextAssemblerPort {
  assemble(input: {
    readonly kind: AgentKind;
    readonly clientId: string;
    readonly effectiveAt: Date;
    readonly targetWeekStart?: string;
  }): Promise<AssembledContext>;
}

export interface TracePort {
  persistBeforeModel(trace: ContextTrace): Promise<void>;
  get(traceId: string): Promise<ContextTrace | undefined>;
}

export interface ModelGatewayPort {
  generateProgramme(trace: ContextTrace): Promise<ProgrammeModelOutput>;
  generateAdjustment(trace: ContextTrace): Promise<AdjustmentModelOutput>;
  draftAccountability(trace: ContextTrace, tier: 1 | 2 | 3): Promise<AccountabilityModelOutput>;
}

export interface EvaluationPort {
  runGates(
    kind: AgentKind,
    trace: ContextTrace,
    output: EvaluatedOutput,
  ): Promise<readonly GateResult[]>;
  runJudges(
    kind: AgentKind,
    trace: ContextTrace,
    output: EvaluatedOutput,
  ): Promise<readonly JudgeResult[]>;
}

export interface AgentAuditPort {
  recordSuccess(input: {
    readonly kind: AgentKind;
    readonly traceId: string;
    readonly output: EvaluatedOutput;
    readonly gates: readonly GateResult[];
    readonly judges: readonly JudgeResult[];
    readonly context: ExecutionContext;
  }): Promise<string>;
  recordFailure(input: {
    readonly kind: AgentKind;
    readonly traceId: string;
    readonly errorCode: string;
    readonly context: ExecutionContext;
  }): Promise<void>;
}

export interface RedFlagPort {
  hasRedFlag(text: string): boolean;
  escalate(input: {
    readonly clientId: string;
    readonly sourceId: string;
    readonly context: ExecutionContext;
  }): Promise<void>;
}

export interface AdjustmentTriggerPort {
  request(input: {
    readonly clientId: string;
    readonly sourceEventKey: string;
    readonly trigger: AdjustmentTrigger;
    readonly context: ExecutionContext;
  }): Promise<void>;
}

export interface AccountabilityPort {
  get(clientId: string): Promise<AccountabilityDetail | undefined>;
  loadInputs(clientId: string, effectiveAt: Date): Promise<EngagementInputs>;
  commitDecision(input: {
    readonly clientId: string;
    readonly inputs: EngagementInputs;
    readonly tier: AccountabilityTier;
    readonly nextState: AccountabilityStateValue;
    readonly draftedContent: string | null;
    readonly automatedSendAllowed: boolean;
    readonly traceId: string | null;
    readonly runId: string | null;
    readonly context: ExecutionContext;
  }): Promise<AccountabilityDetail>;
}

export interface ScorecardPort {
  get(): Promise<Scorecard>;
}

export interface JobPort {
  claim(
    runKey: string,
    jobType: "weekly_plan" | "daily_accountability",
  ): Promise<
    | { readonly kind: "claimed" }
    | {
        readonly kind: "completed";
        readonly value: {
          readonly runKey: string;
          readonly status: "completed";
          readonly processed: number;
          readonly succeeded: number;
          readonly failed: number;
        };
      }
  >;
  complete(runKey: string, value: unknown, completedAt: Date): Promise<void>;
  fail(runKey: string, errorCode: string, failedAt: Date): Promise<void>;
}
