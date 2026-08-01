import { z } from "zod";

import {
  accountabilityDetailSchema,
  inAppMessageSchema,
  runAccountabilityRequestSchema,
} from "./accountability";
import {
  adjustmentSchema,
  generateAdjustmentRequestSchema,
  listAdjustmentsQuerySchema,
  reviewAdjustmentRequestSchema,
} from "./adjustments";
import { apiResponseSchema } from "./envelope";
import { checkInSchema, createCheckInRequestSchema } from "./check-ins";
import { clientConstraintSchema, clientSummarySchema } from "./clients";
import {
  editProgrammeRequestSchema,
  generateProgrammeRequestSchema,
  lifecycleMutationRequestSchema,
  listProgrammesQuerySchema,
  overrideProgrammeRequestSchema,
  programmeReviewSchema,
  programmeSchema,
} from "./programmes";
import { cursorSchema, isoDateSchema, isoInstantSchema, uuidSchema } from "./primitives";
import {
  completeSessionRequestSchema,
  listSessionsQuerySchema,
  logSessionRequestSchema,
  sessionSchema,
} from "./sessions";
import { scorecardSchema } from "./scorecard";
import { contextTraceSchema } from "./traces";

export const idPathParamsSchema = z.object({ id: uuidSchema }).strict();
export const clientPathParamsSchema = z.object({ clientId: uuidSchema }).strict();
export const programmePathParamsSchema = z.object({ programmeId: uuidSchema }).strict();
export const sessionPathParamsSchema = z.object({ sessionId: uuidSchema }).strict();
export const adjustmentPathParamsSchema = z.object({ adjustmentId: uuidSchema }).strict();
export const tracePathParamsSchema = z.object({ traceId: uuidSchema }).strict();

export const clientDetailSchema = z
  .object({
    client: clientSummarySchema,
    activeConstraints: z.array(clientConstraintSchema).max(200),
    currentProgramme: programmeSchema.nullable(),
    sessions: z.array(sessionSchema).max(200),
    checkIns: z.array(checkInSchema).max(100),
    messages: z.array(inAppMessageSchema).max(100),
    adherence7d: z.number().min(0).max(1).nullable(),
    adherence14d: z.number().min(0).max(1).nullable(),
  })
  .strict();

export const todaySchema = z
  .object({
    clientId: uuidSchema,
    localDate: isoDateSchema,
    timezone: z.string().min(1).max(100),
    programme: programmeSchema.nullable(),
    session: sessionSchema.nullable(),
    nextSession: sessionSchema.nullable(),
    outstandingMessage: inAppMessageSchema.nullable(),
  })
  .strict();

export const listClientsQuerySchema = z
  .object({
    status: z.enum(["active", "paused", "churned"]).default("active"),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: cursorSchema,
  })
  .strict();
export const listMessagesQuerySchema = z
  .object({
    status: z.enum(["drafted", "sent", "suppressed", "cancelled"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: cursorSchema,
  })
  .strict();
export const weeklyPlanJobRequestSchema = z
  .object({ targetWeekStart: isoDateSchema, runKey: z.string().trim().min(8).max(200) })
  .strict();
export const dailyAccountabilityJobRequestSchema = z
  .object({ effectiveAt: isoInstantSchema, runKey: z.string().trim().min(8).max(200) })
  .strict();
export const jobRunSummarySchema = z
  .object({
    runKey: z.string().min(8).max(200),
    status: z.enum(["running", "completed", "failed"]),
    processed: z.number().int().min(0),
    succeeded: z.number().int().min(0),
    failed: z.number().int().min(0),
  })
  .strict();

export const apiContracts = {
  clients: {
    list: {
      input: listClientsQuerySchema,
      output: apiResponseSchema(z.array(clientSummarySchema)),
    },
    detail: { input: clientPathParamsSchema, output: apiResponseSchema(clientDetailSchema) },
    today: { input: clientPathParamsSchema, output: apiResponseSchema(todaySchema) },
    messages: {
      input: listMessagesQuerySchema,
      output: apiResponseSchema(z.array(inAppMessageSchema)),
    },
  },
  programmes: {
    list: { input: listProgrammesQuerySchema, output: apiResponseSchema(z.array(programmeSchema)) },
    detail: { input: programmePathParamsSchema, output: apiResponseSchema(programmeReviewSchema) },
    generate: {
      input: generateProgrammeRequestSchema,
      output: apiResponseSchema(programmeReviewSchema),
    },
    edit: { input: editProgrammeRequestSchema, output: apiResponseSchema(programmeReviewSchema) },
    approve: { input: lifecycleMutationRequestSchema, output: apiResponseSchema(programmeSchema) },
    reject: { input: lifecycleMutationRequestSchema, output: apiResponseSchema(programmeSchema) },
    override: { input: overrideProgrammeRequestSchema, output: apiResponseSchema(programmeSchema) },
  },
  sessions: {
    list: { input: listSessionsQuerySchema, output: apiResponseSchema(z.array(sessionSchema)) },
    detail: { input: sessionPathParamsSchema, output: apiResponseSchema(sessionSchema) },
    log: { input: logSessionRequestSchema, output: apiResponseSchema(sessionSchema) },
    complete: { input: completeSessionRequestSchema, output: apiResponseSchema(sessionSchema) },
  },
  checkIns: {
    create: { input: createCheckInRequestSchema, output: apiResponseSchema(checkInSchema) },
  },
  adjustments: {
    generate: {
      input: generateAdjustmentRequestSchema,
      output: apiResponseSchema(adjustmentSchema),
    },
    list: {
      input: listAdjustmentsQuerySchema,
      output: apiResponseSchema(z.array(adjustmentSchema)),
    },
    approve: { input: reviewAdjustmentRequestSchema, output: apiResponseSchema(programmeSchema) },
    reject: { input: reviewAdjustmentRequestSchema, output: apiResponseSchema(adjustmentSchema) },
  },
  accountability: {
    detail: {
      input: clientPathParamsSchema,
      output: apiResponseSchema(accountabilityDetailSchema),
    },
    run: {
      input: runAccountabilityRequestSchema,
      output: apiResponseSchema(accountabilityDetailSchema),
    },
  },
  traces: {
    detail: { input: tracePathParamsSchema, output: apiResponseSchema(contextTraceSchema) },
  },
  scorecard: {
    detail: { input: z.object({}).strict(), output: apiResponseSchema(scorecardSchema) },
  },
  jobs: {
    weeklyPlan: {
      input: weeklyPlanJobRequestSchema,
      output: apiResponseSchema(jobRunSummarySchema),
    },
    dailyAccountability: {
      input: dailyAccountabilityJobRequestSchema,
      output: apiResponseSchema(jobRunSummarySchema),
    },
  },
} as const;

export type ClientDetail = z.infer<typeof clientDetailSchema>;
export type Today = z.infer<typeof todaySchema>;
