import type {
  accountabilityDetailSchema,
  adjustmentSchema,
  checkInSchema,
  clientDetailSchema,
  clientSummarySchema,
  completeSessionRequestSchema,
  contextTraceSchema,
  createCheckInRequestSchema,
  dailyAccountabilityJobRequestSchema,
  editAdjustmentRequestSchema,
  editProgrammeRequestSchema,
  generateAdjustmentRequestSchema,
  generateProgrammeRequestSchema,
  inAppMessageSchema,
  jobRunSummarySchema,
  lifecycleMutationRequestSchema,
  listAdjustmentsQuerySchema,
  listClientsQuerySchema,
  listMessagesQuerySchema,
  listProgrammesQuerySchema,
  listSessionsQuerySchema,
  logSessionRequestSchema,
  overrideProgrammeRequestSchema,
  overrideAdjustmentRequestSchema,
  programmeReviewSchema,
  programmeSchema,
  reviewAdjustmentRequestSchema,
  runAccountabilityRequestSchema,
  scorecardSchema,
  sessionSchema,
  todaySchema,
  weeklyPlanJobRequestSchema,
} from "@spotter/contracts";
import type { Logger } from "pino";
import type { z } from "zod";

import { AgentRuntimeError } from "../agents/errors";
import { type RunAccountabilityForClient } from "../application/accountability";
import {
  type ApproveAdjustment,
  type EditAdjustmentProposal,
  type GenerateAdjustment,
  type OverrideBlockedAdjustment,
  type RejectAdjustment,
} from "../application/adjustments";
import { ApplicationError, type ExecutionContext } from "../application/core";
import {
  type GetAccountabilityState,
  type GetClientDetail,
  type GetClientToday,
  type GetContextTrace,
  type GetProgrammeReview,
  type GetScorecard,
  type GetSession,
  type ListAdjustments,
  type ListClientMessages,
  type ListDemoClients,
  type ListProgrammes,
  type ListSessions,
} from "../application/queries";
import {
  type ApproveProgramme,
  type EditProgrammeProposal,
  type GenerateProgramme,
  type OverrideBlockedProgramme,
  type RejectProgramme,
} from "../application/programmes";
import {
  type CompleteSession,
  type CreateCheckIn,
  type LogSessionWork,
} from "../application/sessions";
import { DomainError } from "../domain/index";
import {
  DatabaseInvariantError,
  isDatabaseDependencyUnavailable,
} from "../infrastructure/database/database-error";
import { type RunDailyAccountabilityJob } from "../jobs/daily-accountability";
import { type RunWeeklyPlanJob } from "../jobs/weekly-plan";

export interface BackendRequestContext {
  readonly requestId: string;
  readonly effectiveAt: Date;
  readonly idempotencyKey?: string;
}

type ListClientsInput = z.infer<typeof listClientsQuerySchema>;
type ListMessagesInput = z.infer<typeof listMessagesQuerySchema>;
type ListProgrammesInput = z.infer<typeof listProgrammesQuerySchema>;
type GenerateProgrammeInput = z.infer<typeof generateProgrammeRequestSchema>;
type EditProgrammeInput = z.infer<typeof editProgrammeRequestSchema>;
type LifecycleInput = z.infer<typeof lifecycleMutationRequestSchema>;
type OverrideProgrammeInput = z.infer<typeof overrideProgrammeRequestSchema>;
type ListSessionsInput = z.infer<typeof listSessionsQuerySchema>;
type LogSessionInput = z.infer<typeof logSessionRequestSchema>;
type CompleteSessionInput = z.infer<typeof completeSessionRequestSchema>;
type CreateCheckInInput = z.infer<typeof createCheckInRequestSchema>;
type GenerateAdjustmentInput = z.infer<typeof generateAdjustmentRequestSchema>;
type EditAdjustmentInput = z.infer<typeof editAdjustmentRequestSchema>;
type OverrideAdjustmentInput = z.infer<typeof overrideAdjustmentRequestSchema>;
type ListAdjustmentsInput = z.infer<typeof listAdjustmentsQuerySchema>;
type ReviewAdjustmentInput = z.infer<typeof reviewAdjustmentRequestSchema>;
type RunAccountabilityInput = z.infer<typeof runAccountabilityRequestSchema>;
type WeeklyJobInput = z.infer<typeof weeklyPlanJobRequestSchema>;
type DailyJobInput = z.infer<typeof dailyAccountabilityJobRequestSchema>;

export interface BackendFacade {
  readonly clients: {
    list(
      input: ListClientsInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof clientSummarySchema>[]>;
    detail(
      clientId: string,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof clientDetailSchema>>;
    today(clientId: string, context: BackendRequestContext): Promise<z.infer<typeof todaySchema>>;
    messages(
      clientId: string,
      input: ListMessagesInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof inAppMessageSchema>[]>;
  };
  readonly programmes: {
    list(
      input: ListProgrammesInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof programmeSchema>[]>;
    detail(
      programmeId: string,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof programmeReviewSchema>>;
    generate(
      input: GenerateProgrammeInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof programmeReviewSchema>>;
    edit(
      programmeId: string,
      input: EditProgrammeInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof programmeReviewSchema>>;
    approve(
      programmeId: string,
      input: LifecycleInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof programmeSchema>>;
    reject(
      programmeId: string,
      input: LifecycleInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof programmeSchema>>;
    override(
      programmeId: string,
      input: OverrideProgrammeInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof programmeSchema>>;
  };
  readonly sessions: {
    list(
      input: ListSessionsInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof sessionSchema>[]>;
    detail(
      sessionId: string,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof sessionSchema>>;
    log(
      sessionId: string,
      input: LogSessionInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof sessionSchema>>;
    complete(
      sessionId: string,
      input: CompleteSessionInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof sessionSchema>>;
  };
  readonly checkIns: {
    create(
      input: CreateCheckInInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof checkInSchema>>;
  };
  readonly adjustments: {
    generate(
      input: GenerateAdjustmentInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof adjustmentSchema>>;
    list(
      input: ListAdjustmentsInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof adjustmentSchema>[]>;
    edit(
      adjustmentId: string,
      input: EditAdjustmentInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof adjustmentSchema>>;
    approve(
      adjustmentId: string,
      input: ReviewAdjustmentInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof programmeSchema>>;
    override(
      adjustmentId: string,
      input: OverrideAdjustmentInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof programmeSchema>>;
    reject(
      adjustmentId: string,
      input: ReviewAdjustmentInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof adjustmentSchema>>;
  };
  readonly accountability: {
    detail(
      clientId: string,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof accountabilityDetailSchema>>;
    run(
      input: RunAccountabilityInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof accountabilityDetailSchema>>;
  };
  readonly traces: {
    detail(
      traceId: string,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof contextTraceSchema>>;
  };
  readonly scorecard: {
    detail(context: BackendRequestContext): Promise<z.infer<typeof scorecardSchema>>;
  };
  readonly jobs: {
    weeklyPlan(
      input: WeeklyJobInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof jobRunSummarySchema>>;
    dailyAccountability(
      input: DailyJobInput,
      context: BackendRequestContext,
    ): Promise<z.infer<typeof jobRunSummarySchema>>;
  };
}

export interface BackendUseCases {
  readonly listClients: ListDemoClients;
  readonly getClientDetail: GetClientDetail;
  readonly getClientToday: GetClientToday;
  readonly listClientMessages: ListClientMessages;
  readonly listProgrammes: ListProgrammes;
  readonly getProgrammeReview: GetProgrammeReview;
  readonly generateProgramme: GenerateProgramme;
  readonly editProgramme: EditProgrammeProposal;
  readonly approveProgramme: ApproveProgramme;
  readonly rejectProgramme: RejectProgramme;
  readonly overrideProgramme: OverrideBlockedProgramme;
  readonly listSessions: ListSessions;
  readonly getSession: GetSession;
  readonly logSession: LogSessionWork;
  readonly completeSession: CompleteSession;
  readonly createCheckIn: CreateCheckIn;
  readonly generateAdjustment: GenerateAdjustment;
  readonly editAdjustment: EditAdjustmentProposal;
  readonly listAdjustments: ListAdjustments;
  readonly approveAdjustment: ApproveAdjustment;
  readonly overrideAdjustment: OverrideBlockedAdjustment;
  readonly rejectAdjustment: RejectAdjustment;
  readonly getAccountability: GetAccountabilityState;
  readonly runAccountability: RunAccountabilityForClient;
  readonly getTrace: GetContextTrace;
  readonly getScorecard: GetScorecard;
  readonly weeklyPlanJob: RunWeeklyPlanJob;
  readonly dailyAccountabilityJob: RunDailyAccountabilityJob;
}

function applicationError(error: unknown): ApplicationError | undefined {
  if (error instanceof ApplicationError) return error;
  if (error instanceof DomainError) {
    const codes = {
      blocked_requires_override: "blocked_requires_override",
      invalid_state_transition: "invalid_state_transition",
      invalid_value: "validation_failed",
      override_reason_required: "override_reason_required",
      stale_adjustment: "stale_adjustment",
      unsupported_adjustment: "unsupported_adjustment",
      version_conflict: "version_conflict",
    } as const;
    return new ApplicationError(codes[error.code], error.message, error.details, { cause: error });
  }
  if (error instanceof DatabaseInvariantError) {
    const code = error.code === "publication_conflict" ? "version_conflict" : error.code;
    return new ApplicationError(code, error.message, {}, { cause: error });
  }
  if (error instanceof AgentRuntimeError) {
    const code = error.code === "recording_prompt_mismatch" ? "recording_not_found" : error.code;
    return new ApplicationError(code, error.message, {}, { cause: error });
  }
  if (isDatabaseDependencyUnavailable(error)) {
    return new ApplicationError(
      "dependency_unavailable",
      "A required service is temporarily unavailable.",
      {},
      { cause: error },
    );
  }
  return undefined;
}

export class ProductionBackendFacade implements BackendFacade {
  public readonly clients: BackendFacade["clients"];
  public readonly programmes: BackendFacade["programmes"];
  public readonly sessions: BackendFacade["sessions"];
  public readonly checkIns: BackendFacade["checkIns"];
  public readonly adjustments: BackendFacade["adjustments"];
  public readonly accountability: BackendFacade["accountability"];
  public readonly traces: BackendFacade["traces"];
  public readonly scorecard: BackendFacade["scorecard"];
  public readonly jobs: BackendFacade["jobs"];

  public constructor(
    private readonly useCases: BackendUseCases,
    private readonly coachId: string,
    private readonly logger: Logger,
  ) {
    this.clients = {
      list: (input, context) =>
        this.invoke(context, async () => {
          if (input.status !== "active") return [];
          return [...(await this.useCases.listClients.execute())];
        }),
      detail: (clientId, context) =>
        this.invoke(context, () =>
          this.useCases.getClientDetail.execute(clientId, context.effectiveAt),
        ),
      today: (clientId, context) =>
        this.invoke(context, () =>
          this.useCases.getClientToday.execute(clientId, context.effectiveAt),
        ),
      messages: (clientId, input, context) =>
        this.invoke(context, async () =>
          [...(await this.useCases.listClientMessages.execute(clientId))].filter(
            (message) => input.status === undefined || message.status === input.status,
          ),
        ),
    };
    this.programmes = {
      list: (input, context) =>
        this.invoke(context, async () => [
          ...(await this.useCases.listProgrammes.execute({
            ...(input.band === undefined ? {} : { band: input.band }),
            ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
            ...(input.status === undefined ? {} : { status: input.status }),
          })),
        ]),
      detail: (programmeId, context) =>
        this.invoke(context, () => this.useCases.getProgrammeReview.execute(programmeId)),
      generate: (input, context) =>
        this.invoke(context, () =>
          this.useCases.generateProgramme.execute(input, this.executionContext(context)),
        ),
      edit: (programmeId, input, context) =>
        this.invoke(context, () =>
          this.useCases.editProgramme.execute(programmeId, input, this.executionContext(context)),
        ),
      approve: (programmeId, input, context) =>
        this.invoke(context, () =>
          this.useCases.approveProgramme.execute(
            programmeId,
            input,
            this.executionContext(context),
          ),
        ),
      reject: (programmeId, input, context) =>
        this.invoke(context, () =>
          this.useCases.rejectProgramme.execute(
            programmeId,
            {
              expectedVersion: input.expectedVersion,
              ...(input.reason === undefined ? {} : { reason: input.reason }),
            },
            this.executionContext(context),
          ),
        ),
      override: (programmeId, input, context) =>
        this.invoke(context, () =>
          this.useCases.overrideProgramme.executeOverride(
            programmeId,
            input,
            this.executionContext(context),
          ),
        ),
    };
    this.sessions = {
      list: (input, context) =>
        this.invoke(context, async () => [
          ...(await this.useCases.listSessions.execute({
            clientId: input.clientId,
            ...(input.from === undefined ? {} : { from: input.from }),
            ...(input.to === undefined ? {} : { to: input.to }),
          })),
        ]),
      detail: (sessionId, context) =>
        this.invoke(context, () => this.useCases.getSession.execute(sessionId)),
      log: (sessionId, input, context) =>
        this.invoke(context, () =>
          this.useCases.logSession.execute(sessionId, input, this.executionContext(context)),
        ),
      complete: (sessionId, input, context) =>
        this.invoke(context, () =>
          this.useCases.completeSession.execute(sessionId, input, this.executionContext(context)),
        ),
    };
    this.checkIns = {
      create: (input, context) =>
        this.invoke(context, () =>
          this.useCases.createCheckIn.execute(input, this.executionContext(context)),
        ),
    };
    this.adjustments = {
      generate: (input, context) =>
        this.invoke(context, () =>
          this.useCases.generateAdjustment.execute(
            {
              clientId: input.clientId,
              ...(input.sourceEventKey === undefined
                ? {}
                : { sourceEventKey: input.sourceEventKey }),
            },
            this.executionContext(context),
          ),
        ),
      list: (input, context) =>
        this.invoke(context, async () => [
          ...(await this.useCases.listAdjustments.execute({
            ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
            ...(input.status === undefined ? {} : { status: input.status }),
          })),
        ]),
      edit: (adjustmentId, input, context) =>
        this.invoke(context, () =>
          this.useCases.editAdjustment.execute(adjustmentId, input, this.executionContext(context)),
        ),
      approve: (adjustmentId, input, context) =>
        this.invoke(context, () =>
          this.useCases.approveAdjustment.execute(
            adjustmentId,
            {
              expectedVersion: input.expectedVersion,
              ...(input.reason === undefined ? {} : { reason: input.reason }),
            },
            this.executionContext(context),
          ),
        ),
      override: (adjustmentId, input, context) =>
        this.invoke(context, () =>
          this.useCases.overrideAdjustment.executeOverride(
            adjustmentId,
            input,
            this.executionContext(context),
          ),
        ),
      reject: (adjustmentId, input, context) =>
        this.invoke(context, () =>
          this.useCases.rejectAdjustment.execute(
            adjustmentId,
            {
              expectedVersion: input.expectedVersion,
              ...(input.reason === undefined ? {} : { reason: input.reason }),
            },
            this.executionContext(context),
          ),
        ),
    };
    this.accountability = {
      detail: (clientId, context) =>
        this.invoke(context, () => this.useCases.getAccountability.execute(clientId)),
      run: (input, context) => {
        const effectiveAt =
          input.effectiveAt === undefined ? context.effectiveAt : new Date(input.effectiveAt);
        return this.invoke({ ...context, effectiveAt }, () =>
          this.useCases.runAccountability.execute(
            input.clientId,
            this.executionContext({ ...context, effectiveAt }),
          ),
        );
      },
    };
    this.traces = {
      detail: (traceId, context) =>
        this.invoke(context, () => this.useCases.getTrace.execute(traceId)),
    };
    this.scorecard = {
      detail: (context) => this.invoke(context, () => this.useCases.getScorecard.execute()),
    };
    this.jobs = {
      weeklyPlan: (input, context) =>
        this.invoke(context, () =>
          this.useCases.weeklyPlanJob.execute(input, this.executionContext(context)),
        ),
      dailyAccountability: (input, context) => {
        const effectiveAt = new Date(input.effectiveAt);
        return this.invoke({ ...context, effectiveAt }, () =>
          this.useCases.dailyAccountabilityJob.execute(
            { effectiveAt, runKey: input.runKey },
            this.executionContext({ ...context, effectiveAt }),
          ),
        );
      },
    };
  }

  private executionContext(context: BackendRequestContext): ExecutionContext {
    return {
      actorId: this.coachId,
      effectiveAt: context.effectiveAt,
      idempotencyKey: context.idempotencyKey ?? `request:${context.requestId}`,
      requestId: context.requestId,
    };
  }

  private async invoke<T>(context: BackendRequestContext, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      const mapped = applicationError(error);
      if (mapped !== undefined) {
        this.logger.warn(
          {
            code: mapped.code,
            errorName: error instanceof Error ? error.name : "Unknown",
            requestId: context.requestId,
          },
          "backend operation rejected",
        );
        throw mapped;
      }
      this.logger.error(
        {
          errorName: error instanceof Error ? error.name : "Unknown",
          requestId: context.requestId,
        },
        "backend operation failed",
      );
      throw new ApplicationError(
        "internal_error",
        "The operation could not be completed.",
        {},
        { cause: error },
      );
    }
  }
}
