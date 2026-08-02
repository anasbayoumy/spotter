import { randomUUID } from "node:crypto";

import {
  accountabilityDetailSchema,
  adjustmentSchema,
  checkInSchema,
  clientConstraintSchema,
  clientDetailSchema,
  clientSummarySchema,
  contextTraceAttemptSchema,
  engagementInputsSchema,
  gateResultSchema,
  inAppMessageSchema,
  jobRunSummarySchema,
  judgeResultSchema,
  programmeModelOutputSchema,
  programmePayloadSchema,
  programmeReviewSchema,
  programmeSchema,
  scorecardSchema,
  sessionSchema,
  todaySchema,
  type Adjustment,
  type AdjustmentOperation,
  type AdjustmentTrigger,
  type CheckIn,
  type ClientDetail,
  type ClientSummary,
  type ContextTraceAttempt,
  type EngagementInputs,
  type Programme,
  type ProgrammePayload,
  type ProgrammeReview,
  type ReviewBand,
  type Session,
} from "@spotter/contracts";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  ApplicationError,
  type IdempotencyClaim,
  type IdempotencyPort,
} from "../../../application/core";
import type {
  AccountabilityPort,
  AdjustmentPort,
  AdjustmentTriggerPort,
  AgentAuditPort,
  CheckInPort,
  ClientReadPort,
  JobPort,
  ProgrammePort,
  ScorecardPort,
  SessionPort,
  TracePort,
} from "../../../application/ports";
import type {
  AccountabilityDetail,
  InAppMessage,
  Scorecard,
  Today,
} from "../../../application/read-models";
import { validateDocumentedExerciseSwap } from "../../../domain/exercise-equivalences";
import { DatabaseInvariantError, isUniqueViolation } from "../database-error";
import type { DatabaseAdapter, DatabaseSession } from "../database-types";
import { PublishProgrammeTransaction } from "../publish-programme";
import {
  accountabilityStates,
  adjustmentTriggers,
  adjustments,
  agentRuns,
  appEvents,
  checkIns,
  clientConstraints,
  clients,
  coachActions,
  contextTraces,
  engagementScores,
  evalResults,
  idempotencyRecords,
  jobRuns,
  messageGuards,
  messages,
  programmes,
  sessions,
  type JsonObject,
  type JsonValue,
} from "../schema";
import { DrizzleUnitOfWork } from "../unit-of-work";

const jsonObjectSchema = z.record(z.string(), z.json());
const jsonValueSchema = z.json();
const selectedTraceSchema = z.object({ sections: z.array(z.unknown()) }).loose();
const visibleMessageStatuses = ["sent"] as const;

function jsonObject(value: unknown): JsonObject {
  return jsonObjectSchema.parse(value);
}

function jsonValue(value: unknown): JsonValue {
  return jsonValueSchema.parse(value);
}

function instant(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function localDate(effectiveAt: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(effectiveAt);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new DatabaseInvariantError("dependency_unavailable", "Unable to resolve client date.");
  }
  return `${year}-${month}-${day}`;
}

function subtractDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

type ClientRow = typeof clients.$inferSelect;
type ProgrammeRow = typeof programmes.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type CheckInRow = typeof checkIns.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type AdjustmentRow = typeof adjustments.$inferSelect;

function clientFromRow(row: ClientRow): ClientSummary {
  return clientSummarySchema.parse({
    coachId: row.coachId,
    createdAt: row.createdAt.toISOString(),
    dataClassification: row.dataClassification,
    goals: row.goals,
    handle: row.handle,
    id: row.id,
    profile: row.profile,
    status: row.status,
    timezone: row.timezone,
  });
}

function programmeFromRow(row: ProgrammeRow): Programme {
  return programmeSchema.parse({
    approvedAt: instant(row.approvedAt),
    approvedBy: row.approvedBy,
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
    generatedBy: row.generatedBy,
    id: row.id,
    mesocycle: row.mesocycle,
    payload: row.payload,
    reviewBand: row.reviewBand,
    status: row.status,
    supersededBy: row.supersededBy,
    validFrom: instant(row.validFrom),
    version: row.version,
    week: row.week,
  });
}

function sessionFromRow(row: SessionRow): Session {
  return sessionSchema.parse({
    actual: row.actual,
    clientId: row.clientId,
    id: row.id,
    notes: row.notes,
    performedAt: instant(row.performedAt),
    planned: row.planned,
    programmeId: row.programmeId,
    rpe: row.rpe,
    scheduledFor: row.scheduledFor,
    status: row.status,
    version: row.version,
  });
}

function checkInFromRow(row: CheckInRow): CheckIn {
  return checkInSchema.parse({
    body: row.body,
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    latencyHours: row.latencyHours,
    readiness: row.readiness,
    requiresHumanEscalation: row.requiresHumanEscalation,
    respondedAt: row.respondedAt.toISOString(),
    sentiment: row.sentiment,
  });
}

function messageFromRow(row: MessageRow): InAppMessage {
  return inAppMessageSchema.parse({
    actor: row.actor === "automation" ? "agent" : "coach",
    body: row.body,
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    sentAt: instant(row.sentAt),
    status: row.status,
    suppressedAt: instant(row.suppressedAt),
    suppressionReason: row.suppressionReason,
    tier: row.tier,
  });
}

function adjustmentFromRow(row: AdjustmentRow): Adjustment {
  return adjustmentSchema.parse({
    appliedProgrammeId: row.appliedProgrammeId,
    approvedAt: instant(row.approvedAt),
    approvedBy: row.approvedBy,
    baseProgrammeId: row.baseProgrammeId,
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    operations: row.operations,
    reviewBand: row.reviewBand,
    sourceEventKey: row.sourceEventKey,
    status: row.status === "superseded" ? "stale" : row.status,
    trigger: row.trigger,
    version: row.version,
  });
}

async function currentPublishedProgramme(
  database: DatabaseSession,
  clientId: string,
): Promise<ProgrammeRow | undefined> {
  return database.query.programmes.findFirst({
    orderBy: [desc(programmes.validFrom), desc(programmes.createdAt), desc(programmes.id)],
    where: and(
      eq(programmes.clientId, clientId),
      eq(programmes.status, "published"),
      isNull(programmes.supersededBy),
    ),
  });
}

async function currentPublishedProgrammeWithSessions(
  database: DatabaseSession,
  clientId: string,
): Promise<{
  readonly programme: ProgrammeRow | undefined;
  readonly sessions: readonly SessionRow[];
}> {
  const currentProgramme = database.$with("current_programme").as(
    database
      .select()
      .from(programmes)
      .where(
        and(
          eq(programmes.clientId, clientId),
          eq(programmes.status, "published"),
          isNull(programmes.supersededBy),
        ),
      )
      .orderBy(desc(programmes.validFrom), desc(programmes.createdAt), desc(programmes.id))
      .limit(1),
  );
  const rows = await database
    .with(currentProgramme)
    .select()
    .from(currentProgramme)
    .leftJoin(sessions, eq(sessions.programmeId, currentProgramme.id))
    .orderBy(asc(sessions.scheduledFor), asc(sessions.id))
    .limit(200);

  return {
    programme: rows[0]?.current_programme,
    sessions: rows.flatMap((row) => (row.sessions === null ? [] : [row.sessions])),
  };
}

export class DrizzleClientReadRepository implements ClientReadPort {
  public constructor(private readonly database: DatabaseSession) {}

  public async listSyntheticActive(): Promise<readonly ClientSummary[]> {
    const rows = await this.database
      .select()
      .from(clients)
      .where(and(eq(clients.status, "active"), eq(clients.dataClassification, "synthetic")))
      .orderBy(asc(clients.handle), asc(clients.id));
    return rows.map(clientFromRow);
  }

  public async getDetail(clientId: string, effectiveAt: Date): Promise<ClientDetail | undefined> {
    const [client, constraintRows, programme, sessionRows, checkInRows, messageRows] =
      await Promise.all([
        this.database.query.clients.findFirst({
          where: and(eq(clients.id, clientId), eq(clients.dataClassification, "synthetic")),
        }),
        this.database
          .select()
          .from(clientConstraints)
          .where(
            and(
              eq(clientConstraints.clientId, clientId),
              isNull(clientConstraints.supersededBy),
              lte(clientConstraints.validFrom, effectiveAt),
              or(
                isNull(clientConstraints.validUntil),
                gt(clientConstraints.validUntil, effectiveAt),
              ),
            ),
          )
          .orderBy(asc(clientConstraints.createdAt), asc(clientConstraints.id)),
        currentPublishedProgramme(this.database, clientId),
        this.database
          .select()
          .from(sessions)
          .where(eq(sessions.clientId, clientId))
          .orderBy(desc(sessions.scheduledFor), desc(sessions.id))
          .limit(200),
        this.database
          .select()
          .from(checkIns)
          .where(eq(checkIns.clientId, clientId))
          .orderBy(desc(checkIns.respondedAt), desc(checkIns.id))
          .limit(100),
        this.database
          .select()
          .from(messages)
          .where(eq(messages.clientId, clientId))
          .orderBy(desc(messages.createdAt), desc(messages.id))
          .limit(100),
      ]);
    if (client === undefined) return undefined;
    const date = localDate(effectiveAt, client.timezone);
    const due = sessionRows.filter((session) => session.scheduledFor <= date);
    const adherence = (days: number): number | null => {
      const cutoff = subtractDays(date, days - 1);
      const window = due.filter((session) => session.scheduledFor >= cutoff);
      return window.length === 0
        ? null
        : window.filter((session) => session.status === "completed").length / window.length;
    };
    return clientDetailSchema.parse({
      activeConstraints: constraintRows.map((constraint) =>
        clientConstraintSchema.parse({
          clientId: constraint.clientId,
          createdAt: constraint.createdAt.toISOString(),
          detail: constraint.detail,
          id: constraint.id,
          kind: constraint.kind,
          severity: constraint.severity,
          source: constraint.source,
          validFrom: constraint.validFrom.toISOString(),
          validUntil: instant(constraint.validUntil),
        }),
      ),
      adherence14d: adherence(14),
      adherence7d: adherence(7),
      checkIns: checkInRows.map(checkInFromRow),
      client: clientFromRow(client),
      currentProgramme: programme === undefined ? null : programmeFromRow(programme),
      messages: messageRows.map(messageFromRow),
      sessions: sessionRows.map(sessionFromRow),
    });
  }

  public async getToday(clientId: string, effectiveAt: Date): Promise<Today | undefined> {
    const [client, current, outstanding] = await Promise.all([
      this.database.query.clients.findFirst({
        where: and(eq(clients.id, clientId), eq(clients.dataClassification, "synthetic")),
      }),
      currentPublishedProgrammeWithSessions(this.database, clientId),
      this.database.query.messages.findFirst({
        orderBy: [desc(messages.sentAt), desc(messages.id)],
        where: and(
          eq(messages.clientId, clientId),
          eq(messages.status, "sent"),
          sql`${messages.sentAt} IS NOT NULL`,
        ),
      }),
    ]);
    if (client === undefined) return undefined;
    const date = localDate(effectiveAt, client.timezone);
    const { programme, sessions: programmeSessions } = current;
    const nextSession = programmeSessions.find((session) => session.scheduledFor > date);
    const todaySession = programmeSessions.find((session) => session.scheduledFor === date);
    return todaySchema.parse({
      clientId,
      localDate: date,
      nextSession: nextSession === undefined ? null : sessionFromRow(nextSession),
      outstandingMessage: outstanding === undefined ? null : messageFromRow(outstanding),
      programme: programme === undefined ? null : programmeFromRow(programme),
      session: todaySession === undefined ? null : sessionFromRow(todaySession),
      timezone: client.timezone,
    });
  }

  public async listVisibleMessages(clientId: string): Promise<readonly InAppMessage[]> {
    const rows = await this.database
      .select()
      .from(messages)
      .where(
        and(eq(messages.clientId, clientId), inArray(messages.status, [...visibleMessageStatuses])),
      )
      .orderBy(desc(messages.sentAt), desc(messages.id))
      .limit(100);
    return rows.map(messageFromRow);
  }
}

export class DrizzleTraceRepository implements TracePort {
  public constructor(private readonly database: DatabaseSession) {}

  public async persistBeforeModel(trace: ContextTraceAttempt): Promise<void> {
    await this.database
      .insert(contextTraces)
      .values({
        budget: trace.budget,
        clientId: trace.clientId,
        effectiveAt: new Date(trace.createdAt),
        id: trace.id,
        intent: trace.intent,
        rendered: trace.rendered,
        selected: jsonObject({ sections: trace.sections }),
        tokenCount: trace.tokenCount,
        turnId: trace.turnId,
      })
      .onConflictDoNothing();
  }

  public async get(traceId: string): Promise<ContextTraceAttempt | undefined> {
    const row = await this.database.query.contextTraces.findFirst({
      where: eq(contextTraces.id, traceId),
    });
    if (row === undefined) return undefined;
    const selected = selectedTraceSchema.parse(row.selected);
    return contextTraceAttemptSchema.parse({
      budget: row.budget,
      clientId: row.clientId,
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      intent: row.intent,
      rendered: row.rendered,
      sections: selected.sections,
      tokenCount: row.tokenCount,
      turnId: row.turnId,
    });
  }
}

interface StagedSuccess {
  readonly input: Parameters<AgentAuditPort["recordSuccess"]>[0];
}

export class BufferedAgentAuditRepository implements AgentAuditPort {
  readonly #successes = new Map<string, StagedSuccess>();

  public constructor(private readonly database: DatabaseSession) {}

  public recordSuccess(input: Parameters<AgentAuditPort["recordSuccess"]>[0]): Promise<string> {
    const runId = randomUUID();
    this.#successes.set(runId, { input });
    return Promise.resolve(runId);
  }

  public async recordFailure(input: Parameters<AgentAuditPort["recordFailure"]>[0]): Promise<void> {
    await this.database.insert(agentRuns).values({
      agent: input.kind,
      attemptKey: `${input.kind}:${input.context.idempotencyKey}:failed`,
      errorCode: input.errorCode,
      id: randomUUID(),
      latencyMs: 0,
      model: "recorded/spotter-v1",
      promptVersion: "application-v1",
      status: "failed",
      traceId: input.traceId,
    });
  }

  public async persistSuccess(database: DatabaseSession, runId: string): Promise<void> {
    const staged = this.#successes.get(runId);
    if (staged === undefined) {
      const existing = await database.query.agentRuns.findFirst({ where: eq(agentRuns.id, runId) });
      if (existing !== undefined) return;
      throw new DatabaseInvariantError(
        "dependency_unavailable",
        "Agent audit buffer is unavailable.",
      );
    }
    const { input } = staged;
    await database.insert(agentRuns).values({
      agent: input.kind,
      attemptKey: `${input.kind}:${input.context.idempotencyKey}:succeeded`,
      errorCode: null,
      id: runId,
      latencyMs: 0,
      model: "recorded/spotter-v1",
      output: jsonObject(input.output),
      promptVersion: "application-v1",
      status: "succeeded",
      traceId: input.traceId,
    });
    const evaluations = [
      ...input.gates.map((gate) => ({
        agentRunId: runId,
        id: gate.id,
        judgeModel: null,
        kind: "gate" as const,
        name: gate.name,
        passed: gate.passed,
        rationale: gate.rationale,
        score: null,
      })),
      ...input.judges.map((judge) => ({
        agentRunId: runId,
        id: judge.id,
        judgeModel: judge.judgeModel,
        kind: "judge" as const,
        name: judge.name,
        passed: null,
        rationale: judge.rationale,
        score: judge.score,
      })),
    ];
    if (evaluations.length > 0) await database.insert(evalResults).values(evaluations);
    this.#successes.delete(runId);
  }
}

export class DrizzleProgrammeApplicationRepository implements ProgrammePort {
  public constructor(
    private readonly adapter: DatabaseAdapter,
    private readonly audit: BufferedAgentAuditRepository,
  ) {}

  private get database(): DatabaseSession {
    return this.adapter.database;
  }

  public async list(input: {
    readonly clientId?: string;
    readonly status?: string;
    readonly band?: ReviewBand;
  }): Promise<readonly Programme[]> {
    const conditions: SQL[] = [];
    if (input.clientId !== undefined) conditions.push(eq(programmes.clientId, input.clientId));
    if (input.status !== undefined) {
      const status = z
        .enum(["draft", "queued", "published", "rejected", "superseded"])
        .parse(input.status);
      conditions.push(eq(programmes.status, status));
    }
    if (input.band !== undefined) conditions.push(eq(programmes.reviewBand, input.band));
    const rows = await this.database
      .select()
      .from(programmes)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(
        sql`CASE ${programmes.reviewBand} WHEN 'blocked' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END`,
        asc(programmes.createdAt),
        asc(programmes.id),
      )
      .limit(100);
    return rows.map(programmeFromRow);
  }

  public async getReview(programmeId: string): Promise<ProgrammeReview | undefined> {
    const programme = await this.database.query.programmes.findFirst({
      where: eq(programmes.id, programmeId),
    });
    if (programme === undefined) return undefined;
    if (programme.generatedBy === null) {
      throw new DatabaseInvariantError(
        "dependency_unavailable",
        "Programme audit run is unavailable.",
      );
    }
    const run = await this.database.query.agentRuns.findFirst({
      where: eq(agentRuns.id, programme.generatedBy),
    });
    if (run === undefined) {
      throw new DatabaseInvariantError(
        "dependency_unavailable",
        "Programme audit run is unavailable.",
      );
    }
    const trace = await this.database.query.contextTraces.findFirst({
      where: eq(contextTraces.id, run.traceId),
    });
    if (trace === undefined) {
      throw new DatabaseInvariantError("dependency_unavailable", "Programme trace is unavailable.");
    }
    const evaluationRows = await this.database
      .select()
      .from(evalResults)
      .where(eq(evalResults.agentRunId, run.id))
      .orderBy(asc(evalResults.createdAt), asc(evalResults.id));
    const parsedOutput = programmeModelOutputSchema.safeParse(run.output);
    return programmeReviewSchema.parse({
      citations: parsedOutput.success ? parsedOutput.data.citations : [],
      gates: evaluationRows
        .filter((evaluation) => evaluation.kind === "gate")
        .map((evaluation) =>
          gateResultSchema.parse({
            id: evaluation.id,
            name: evaluation.name,
            passed: evaluation.passed,
            rationale: evaluation.rationale,
          }),
        ),
      judges: evaluationRows
        .filter((evaluation) => evaluation.kind === "judge")
        .map((evaluation) =>
          judgeResultSchema.parse({
            id: evaluation.id,
            judgeModel: evaluation.judgeModel,
            name: evaluation.name,
            rationale: evaluation.rationale,
            score: evaluation.score,
          }),
        ),
      model: run.model,
      programme: programmeFromRow(programme),
      promptVersion: run.promptVersion,
      traceId: trace.id,
    });
  }

  public async queueGenerated(
    input: Parameters<ProgrammePort["queueGenerated"]>[0],
  ): Promise<ProgrammeReview> {
    const programmeId = randomUUID();
    const weekStart = input.payload.days[0]?.scheduledDate;
    if (weekStart === undefined) {
      throw new ApplicationError("validation_failed", "Programme requires a scheduled day.");
    }
    await this.adapter.transaction(async (database) => {
      const latest = await database.query.programmes.findFirst({
        orderBy: [desc(programmes.version)],
        where: and(eq(programmes.clientId, input.clientId), eq(programmes.weekStart, weekStart)),
      });
      await this.audit.persistSuccess(database, input.runId);
      await database.insert(programmes).values({
        clientId: input.clientId,
        generatedBy: input.runId,
        id: programmeId,
        mesocycle: latest?.mesocycle ?? 1,
        payload: jsonObject(input.payload),
        reviewBand: input.band,
        status: "queued",
        version: (latest?.version ?? 0) + 1,
        week: latest?.week ?? 1,
        weekStart,
      });
    });
    const result = await this.getReview(programmeId);
    if (result === undefined)
      throw new DatabaseInvariantError("dependency_unavailable", "Queued programme was not found.");
    return result;
  }

  public async edit(input: Parameters<ProgrammePort["edit"]>[0]): Promise<ProgrammeReview> {
    const existing = await this.getReview(input.programmeId);
    if (existing === undefined)
      throw new ApplicationError("programme_not_found", "Programme does not exist.");
    const newProgrammeId = randomUUID();
    const runId = randomUUID();
    const weekStart =
      input.payload.days[0]?.scheduledDate ?? existing.programme.payload.days[0]?.scheduledDate;
    if (weekStart === undefined) {
      throw new ApplicationError("validation_failed", "Programme requires a scheduled day.");
    }
    await this.adapter.transaction(async (database) => {
      await database.execute(
        sql`SELECT id FROM programmes WHERE id = ${input.programmeId} FOR UPDATE`,
      );
      const locked = await database.query.programmes.findFirst({
        where: eq(programmes.id, input.programmeId),
      });
      if (locked === undefined) {
        throw new ApplicationError("programme_not_found", "Programme does not exist.");
      }
      if (locked.version !== input.expectedVersion || locked.status !== existing.programme.status) {
        throw new ApplicationError("version_conflict", "Programme changed during editing.");
      }
      await database.insert(agentRuns).values({
        agent: "programme",
        attemptKey: `programme.edit:${input.context.idempotencyKey}`,
        id: runId,
        latencyMs: 0,
        model: "recorded/coach-edit",
        output: jsonObject({ citations: existing.citations, payload: input.payload }),
        promptVersion: "coach-edit-v1",
        status: "succeeded",
        traceId: existing.traceId,
      });
      const evaluations = [
        ...input.gates.map((gate) => ({
          agentRunId: runId,
          id: gate.id,
          kind: "gate" as const,
          name: gate.name,
          passed: gate.passed,
          rationale: gate.rationale,
        })),
        ...existing.judges.map((result) => ({
          agentRunId: runId,
          id: randomUUID(),
          judgeModel: result.judgeModel,
          kind: "judge" as const,
          name: result.name,
          rationale: result.rationale,
          score: result.score,
        })),
      ];
      if (evaluations.length > 0) await database.insert(evalResults).values(evaluations);
      await database.insert(programmes).values({
        clientId: existing.programme.clientId,
        generatedBy: runId,
        id: newProgrammeId,
        mesocycle: existing.programme.mesocycle,
        payload: jsonObject(input.payload),
        reviewBand: input.band,
        status: "queued",
        version: existing.programme.version + 1,
        week: existing.programme.week,
        weekStart,
      });
      if (locked.status === "queued") {
        await database
          .update(programmes)
          .set({ status: "rejected" })
          .where(
            and(
              eq(programmes.id, input.programmeId),
              eq(programmes.status, "queued"),
              eq(programmes.version, input.expectedVersion),
            ),
          );
      }
      await database.insert(coachActions).values({
        action: "edited",
        clientId: existing.programme.clientId,
        coachId: input.context.actorId,
        diff: jsonObject({ after: input.payload, before: existing.programme.payload }),
        id: randomUUID(),
        programmeId: newProgrammeId,
        requestId: input.context.requestId,
      });
    });
    const result = await this.getReview(newProgrammeId);
    if (result === undefined)
      throw new DatabaseInvariantError("dependency_unavailable", "Edited programme was not found.");
    return result;
  }

  public async reject(input: Parameters<ProgrammePort["reject"]>[0]): Promise<Programme> {
    const row = await this.database.query.programmes.findFirst({
      where: eq(programmes.id, input.programmeId),
    });
    if (row === undefined)
      throw new ApplicationError("programme_not_found", "Programme does not exist.");
    if (row.version !== input.expectedVersion)
      throw new ApplicationError("version_conflict", "Programme version changed.");
    if (row.status !== "draft" && row.status !== "queued")
      throw new ApplicationError(
        "invalid_state_transition",
        "Only pending programmes can be rejected.",
      );
    await this.adapter.transaction(async (database) => {
      await database.execute(sql`SELECT id FROM programmes WHERE id = ${row.id} FOR UPDATE`);
      const locked = await database.query.programmes.findFirst({
        where: eq(programmes.id, row.id),
      });
      if (locked === undefined) {
        throw new ApplicationError("programme_not_found", "Programme does not exist.");
      }
      if (locked.version !== input.expectedVersion) {
        throw new ApplicationError("version_conflict", "Programme version changed.");
      }
      if (locked.status !== "draft" && locked.status !== "queued") {
        throw new ApplicationError(
          "invalid_state_transition",
          "Only pending programmes can be rejected.",
        );
      }
      await database
        .update(programmes)
        .set({ status: "rejected" })
        .where(
          and(
            eq(programmes.id, row.id),
            eq(programmes.version, input.expectedVersion),
            inArray(programmes.status, ["draft", "queued"]),
          ),
        );
      await database.insert(coachActions).values({
        action: "rejected",
        clientId: row.clientId,
        coachId: input.context.actorId,
        id: randomUUID(),
        programmeId: row.id,
        reason: input.reason,
        requestId: input.context.requestId,
      });
    });
    const rejected = await this.database.query.programmes.findFirst({
      where: eq(programmes.id, row.id),
    });
    if (rejected === undefined)
      throw new DatabaseInvariantError(
        "dependency_unavailable",
        "Rejected programme was not found.",
      );
    return programmeFromRow(rejected);
  }

  public async publish(input: Parameters<ProgrammePort["publish"]>[0]): Promise<Programme> {
    const current = await this.database.query.programmes.findFirst({
      where: eq(programmes.id, input.programmeId),
    });
    if (current === undefined)
      throw new ApplicationError("programme_not_found", "Programme does not exist.");
    if (current.version !== input.expectedVersion)
      throw new ApplicationError("version_conflict", "Programme version changed.");
    const payload = programmePayloadSchema.parse(current.payload);
    const publisher = new PublishProgrammeTransaction(new DrizzleUnitOfWork(this.adapter));
    await publisher.execute({
      actionId: randomUUID(),
      approval: input.approval,
      approvedAt: input.context.effectiveAt,
      candidateProgrammeId: input.programmeId,
      coachId: input.context.actorId,
      idempotencyKey: `${input.context.idempotencyKey}:publication`,
      idempotencyRecordId: randomUUID(),
      requestHash: `${input.programmeId}:${String(input.expectedVersion)}:${input.approval}:${input.reason ?? ""}`,
      requestId: input.context.requestId,
      sessions: payload.days.map((day) => ({
        id: randomUUID(),
        planned: jsonValue(day.exercises),
        scheduledFor: day.scheduledDate,
        sessionKey: `day-${String(day.dayIndex)}`,
      })),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    });
    const published = await this.database.query.programmes.findFirst({
      where: eq(programmes.id, input.programmeId),
    });
    if (published === undefined)
      throw new DatabaseInvariantError(
        "dependency_unavailable",
        "Published programme was not found.",
      );
    return programmeFromRow(published);
  }
}

export class DrizzleSessionRepository implements SessionPort {
  public constructor(private readonly adapter: DatabaseAdapter) {}

  private get database(): DatabaseSession {
    return this.adapter.database;
  }

  public async list(input: Parameters<SessionPort["list"]>[0]): Promise<readonly Session[]> {
    const conditions: SQL[] = [eq(sessions.clientId, input.clientId)];
    if (input.from !== undefined) conditions.push(gte(sessions.scheduledFor, input.from));
    if (input.to !== undefined) conditions.push(lte(sessions.scheduledFor, input.to));
    const rows = await this.database
      .select()
      .from(sessions)
      .where(and(...conditions))
      .orderBy(asc(sessions.scheduledFor), asc(sessions.id))
      .limit(100);
    return rows.map(sessionFromRow);
  }

  public async get(sessionId: string): Promise<Session | undefined> {
    const row = await this.database.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    return row === undefined ? undefined : sessionFromRow(row);
  }

  public async log(input: Parameters<SessionPort["log"]>[0]): Promise<Session> {
    const row = await this.requireMutable(input.sessionId, input.clientId, input.expectedVersion);
    if (row.status === "completed")
      throw new ApplicationError(
        "invalid_state_transition",
        "Completed session work cannot be changed.",
      );
    const [updated] = await this.database
      .update(sessions)
      .set({ actual: jsonValue(input.actual), notes: input.notes, version: row.version + 1 })
      .where(and(eq(sessions.id, row.id), eq(sessions.version, input.expectedVersion)))
      .returning();
    if (updated === undefined) {
      throw new ApplicationError("version_conflict", "Session version changed.");
    }
    return sessionFromRow(updated);
  }

  public async complete(input: Parameters<SessionPort["complete"]>[0]): Promise<Session> {
    const existing = await this.database.query.sessions.findFirst({
      where: eq(sessions.id, input.sessionId),
    });
    if (existing?.status === "completed") return sessionFromRow(existing);
    const row = await this.requireMutable(input.sessionId, input.clientId, input.expectedVersion);
    if (row.actual === null)
      throw new ApplicationError(
        "invalid_state_transition",
        "Session work must be logged before completion.",
      );
    const [updated] = await this.database
      .update(sessions)
      .set({
        performedAt: new Date(input.performedAt),
        rpe: input.rpe,
        status: "completed",
        version: row.version + 1,
      })
      .where(and(eq(sessions.id, row.id), eq(sessions.version, input.expectedVersion)))
      .returning();
    if (updated === undefined) {
      throw new ApplicationError("version_conflict", "Session version changed.");
    }
    return sessionFromRow(updated);
  }

  private async requireMutable(
    sessionId: string,
    clientId: string,
    expectedVersion: number,
  ): Promise<SessionRow> {
    const row = await this.database.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    if (row === undefined) throw new ApplicationError("not_found", "Session does not exist.");
    if (row.clientId !== clientId)
      throw new ApplicationError("invalid_state_transition", "Session belongs to another client.");
    if (row.version !== expectedVersion)
      throw new ApplicationError("version_conflict", "Session version changed.");
    const programme = await this.database.query.programmes.findFirst({
      where: eq(programmes.id, row.programmeId),
    });
    if (programme?.status !== "published" || programme.supersededBy !== null) {
      throw new ApplicationError("stale_programme", "Session programme is no longer current.");
    }
    return row;
  }
}

export class DrizzleCheckInRepository implements CheckInPort {
  public constructor(private readonly adapter: DatabaseAdapter) {}

  public async create(input: Parameters<CheckInPort["create"]>[0]): Promise<CheckIn> {
    const id = randomUUID();
    await this.adapter.transaction(async (database) => {
      await database.insert(checkIns).values({
        body: input.body,
        clientId: input.clientId,
        id,
        readiness: input.readiness,
        requiresHumanEscalation: input.requiresHumanEscalation,
        respondedAt: new Date(input.respondedAt),
      });
      if (input.requiresHumanEscalation) {
        await database.insert(messages).values({
          actor: "coach",
          body: "A synthetic check-in requires human review.",
          clientId: input.clientId,
          id: randomUUID(),
          status: "drafted",
          tier: 0,
        });
      }
    });
    const row = await this.adapter.database.query.checkIns.findFirst({
      where: eq(checkIns.id, id),
    });
    if (row === undefined)
      throw new DatabaseInvariantError("dependency_unavailable", "Stored check-in was not found.");
    return checkInFromRow(row);
  }
}

export class DrizzleAdjustmentTriggerRepository implements AdjustmentTriggerPort {
  public constructor(private readonly database: DatabaseSession) {}

  public async request(input: Parameters<AdjustmentTriggerPort["request"]>[0]): Promise<void> {
    await this.database
      .insert(adjustmentTriggers)
      .values({
        clientId: input.clientId,
        id: randomUUID(),
        sourceEventKey: input.sourceEventKey,
        trigger: jsonObject(input.trigger),
      })
      .onConflictDoNothing();
  }
}

function applyOperations(
  payload: ProgrammePayload,
  operations: readonly AdjustmentOperation[],
): ProgrammePayload {
  const copy = structuredClone(payload);
  for (const operation of operations) {
    let matched = false;
    for (const day of copy.days) {
      const exercise = day.exercises.find((candidate) => candidate.id === operation.exerciseId);
      if (exercise === undefined) continue;
      matched = true;
      if (operation.type === "reduce_volume") {
        if (exercise.sets - operation.setsToRemove < 1) {
          throw new ApplicationError(
            "unsupported_adjustment",
            "Adjustment would remove every prescribed set.",
          );
        }
        exercise.sets -= operation.setsToRemove;
      } else if (operation.type === "swap_exercise") {
        validateDocumentedExerciseSwap({
          equivalenceId: operation.equivalenceId,
          replacementFamily: operation.replacementFamily,
          replacementName: operation.replacementName,
          sourceFamily: exercise.family,
        });
        exercise.name = operation.replacementName;
        exercise.family = operation.replacementFamily;
      } else {
        if (exercise.loadKg === undefined || exercise.loadKg === null) {
          throw new ApplicationError(
            "unsupported_adjustment",
            "The programme does not store a load prescription to reduce safely.",
          );
        }
        const reduced = Math.round(exercise.loadKg * (100 - operation.percent)) / 100;
        exercise.loadKg = Object.is(reduced, -0) ? 0 : reduced;
      }
    }
    if (!matched)
      throw new ApplicationError(
        "unsupported_adjustment",
        "Adjustment references an unknown exercise.",
      );
  }
  return programmePayloadSchema.parse(copy);
}

export class DrizzleAdjustmentRepository implements AdjustmentPort {
  public constructor(
    private readonly adapter: DatabaseAdapter,
    private readonly audit: BufferedAgentAuditRepository,
  ) {}

  private get database(): DatabaseSession {
    return this.adapter.database;
  }

  public async list(input: Parameters<AdjustmentPort["list"]>[0]): Promise<readonly Adjustment[]> {
    const conditions: SQL[] = [];
    if (input.clientId !== undefined) conditions.push(eq(adjustments.clientId, input.clientId));
    if (input.status !== undefined) {
      const status = z
        .enum(["draft", "queued", "approved", "rejected", "applied", "stale"])
        .parse(input.status);
      conditions.push(eq(adjustments.status, status));
    }
    const rows = await this.database
      .select()
      .from(adjustments)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(desc(adjustments.createdAt), desc(adjustments.id))
      .limit(100);
    return rows.map(adjustmentFromRow);
  }

  public async resolveGenerationInput(
    input: Parameters<AdjustmentPort["resolveGenerationInput"]>[0],
  ): Promise<
    | {
        readonly baseProgrammeId: string;
        readonly sourceEventKey: string;
        readonly trigger: AdjustmentTrigger;
      }
    | undefined
  > {
    const programme = await currentPublishedProgramme(this.database, input.clientId);
    if (programme === undefined) return undefined;
    if (input.sourceEventKey === undefined) {
      return {
        baseProgrammeId: programme.id,
        sourceEventKey: `coach:${input.clientId}:${randomUUID()}`,
        trigger: { coachId: input.actorId, type: "explicit_coach" },
      };
    }
    const row = await this.database.query.adjustmentTriggers.findFirst({
      where: and(
        eq(adjustmentTriggers.clientId, input.clientId),
        eq(adjustmentTriggers.sourceEventKey, input.sourceEventKey),
      ),
    });
    if (row === undefined) return undefined;
    return {
      baseProgrammeId: programme.id,
      sourceEventKey: row.sourceEventKey,
      trigger: z
        .discriminatedUnion("type", [
          z.object({ coachId: z.uuid(), type: z.literal("explicit_coach") }),
          z.object({
            checkInId: z.uuid(),
            readiness: z.number().int().min(1).max(2),
            type: z.literal("low_readiness"),
          }),
          z.object({
            rpe: z.number().min(9).max(10),
            sessionId: z.uuid(),
            type: z.literal("high_rpe"),
          }),
          z.object({
            completionRatio: z.number().min(0).max(0.7),
            sessionId: z.uuid(),
            type: z.literal("low_completion"),
          }),
        ])
        .parse(row.trigger),
    };
  }

  public async queueGenerated(
    input: Parameters<AdjustmentPort["queueGenerated"]>[0],
  ): Promise<Adjustment> {
    const existing = await this.database.query.adjustments.findFirst({
      where: and(
        eq(adjustments.clientId, input.clientId),
        eq(adjustments.sourceEventKey, input.sourceEventKey),
      ),
    });
    if (existing !== undefined) return adjustmentFromRow(existing);
    const id = randomUUID();
    try {
      await this.adapter.transaction(async (database) => {
        await this.audit.persistSuccess(database, input.runId);
        await database.insert(adjustments).values({
          baseProgrammeId: input.baseProgrammeId,
          clientId: input.clientId,
          generatedBy: input.runId,
          id,
          operations: input.output.operations.map(jsonValue),
          reviewBand: input.band,
          sourceEventKey: input.sourceEventKey,
          status: "queued",
          trigger: jsonObject(input.trigger),
          version: 1,
        });
      });
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
    }
    const stored = await this.database.query.adjustments.findFirst({
      where: and(
        eq(adjustments.clientId, input.clientId),
        eq(adjustments.sourceEventKey, input.sourceEventKey),
      ),
    });
    if (stored === undefined)
      throw new DatabaseInvariantError(
        "dependency_unavailable",
        "Queued adjustment was not found.",
      );
    return adjustmentFromRow(stored);
  }

  public async get(adjustmentId: string): Promise<Adjustment | undefined> {
    const row = await this.database.query.adjustments.findFirst({
      where: eq(adjustments.id, adjustmentId),
    });
    return row === undefined ? undefined : adjustmentFromRow(row);
  }

  public async edit(input: Parameters<AdjustmentPort["edit"]>[0]): Promise<Adjustment> {
    await this.adapter.transaction(async (database) => {
      await database.execute(
        sql`SELECT id FROM adjustments WHERE id = ${input.adjustmentId} FOR UPDATE`,
      );
      const adjustment = await database.query.adjustments.findFirst({
        where: eq(adjustments.id, input.adjustmentId),
      });
      if (adjustment === undefined)
        throw new ApplicationError("not_found", "Adjustment does not exist.");
      if (adjustment.version !== input.expectedVersion)
        throw new ApplicationError("version_conflict", "Adjustment version changed.");
      if (adjustment.status !== "draft" && adjustment.status !== "queued") {
        throw new ApplicationError(
          "invalid_state_transition",
          "Only pending adjustments can be edited.",
        );
      }

      await database.execute(
        sql`SELECT id FROM programmes WHERE id = ${adjustment.baseProgrammeId} FOR UPDATE`,
      );
      const base = await database.query.programmes.findFirst({
        where: eq(programmes.id, adjustment.baseProgrammeId),
      });
      if (base?.status !== "published" || base.supersededBy !== null) {
        throw new ApplicationError(
          "stale_adjustment",
          "Adjustment base programme is no longer current.",
        );
      }
      const operations = input.operations.map((operation) => structuredClone(operation));
      applyOperations(programmePayloadSchema.parse(base.payload), operations);
      const updated = await database
        .update(adjustments)
        .set({ operations: operations.map(jsonValue), version: adjustment.version + 1 })
        .where(
          and(
            eq(adjustments.id, adjustment.id),
            eq(adjustments.version, input.expectedVersion),
            inArray(adjustments.status, ["draft", "queued"]),
          ),
        )
        .returning({ id: adjustments.id });
      if (updated.length !== 1) {
        throw new ApplicationError("version_conflict", "Adjustment version changed.");
      }
      await database.insert(coachActions).values({
        action: "edited",
        adjustmentId: adjustment.id,
        clientId: adjustment.clientId,
        coachId: input.context.actorId,
        diff: jsonObject({
          after: { operations, version: adjustment.version + 1 },
          before: { operations: adjustment.operations, version: adjustment.version },
        }),
        id: randomUUID(),
        reason: input.reason,
        requestId: input.context.requestId,
      });
    });
    const edited = await this.database.query.adjustments.findFirst({
      where: eq(adjustments.id, input.adjustmentId),
    });
    if (edited === undefined) {
      throw new DatabaseInvariantError(
        "dependency_unavailable",
        "Edited adjustment was not found.",
      );
    }
    return adjustmentFromRow(edited);
  }

  public async approve(input: Parameters<AdjustmentPort["approve"]>[0]): Promise<Programme> {
    const newProgrammeId = randomUUID();
    await this.adapter.transaction(async (database) => {
      await database.execute(
        sql`SELECT id FROM adjustments WHERE id = ${input.adjustmentId} FOR UPDATE`,
      );
      const adjustment = await database.query.adjustments.findFirst({
        where: eq(adjustments.id, input.adjustmentId),
      });
      if (adjustment === undefined)
        throw new ApplicationError("not_found", "Adjustment does not exist.");
      if (adjustment.version !== input.expectedVersion)
        throw new ApplicationError("version_conflict", "Adjustment version changed.");
      if (adjustment.status !== "queued")
        throw new ApplicationError(
          "invalid_state_transition",
          "Only queued adjustments can be approved.",
        );
      if (input.approval === "standard" && adjustment.reviewBand === "blocked") {
        throw new ApplicationError(
          "blocked_requires_override",
          "Blocked adjustment requires an override.",
        );
      }
      const reason = input.reason?.trim();
      if (input.approval === "override") {
        if (adjustment.reviewBand !== "blocked") {
          throw new ApplicationError(
            "invalid_state_transition",
            "Only blocked adjustments can be overridden.",
          );
        }
        if (reason === undefined || reason.length === 0) {
          throw new ApplicationError(
            "override_reason_required",
            "Adjustment override requires a reason.",
          );
        }
      }
      const base = await database.query.programmes.findFirst({
        where: eq(programmes.id, adjustment.baseProgrammeId),
      });
      if (base?.status !== "published" || base.supersededBy !== null) {
        await database
          .update(adjustments)
          .set({ status: "stale", version: adjustment.version + 1 })
          .where(eq(adjustments.id, adjustment.id));
        throw new ApplicationError(
          "stale_adjustment",
          "Adjustment base programme is no longer current.",
        );
      }
      const adjustedPayload = applyOperations(
        programmePayloadSchema.parse(base.payload),
        adjustmentFromRow(adjustment).operations,
      );
      await database.insert(programmes).values({
        clientId: base.clientId,
        generatedBy: adjustment.generatedBy,
        id: newProgrammeId,
        mesocycle: base.mesocycle,
        payload: jsonObject(adjustedPayload),
        reviewBand: adjustment.reviewBand,
        status: "queued",
        version: base.version + 1,
        week: base.week,
        weekStart: base.weekStart,
      });
      await database
        .update(programmes)
        .set({ status: "superseded", supersededBy: newProgrammeId })
        .where(eq(programmes.id, base.id));
      await database
        .update(programmes)
        .set({
          approvalKind: input.approval,
          approvedAt: input.context.effectiveAt,
          approvedBy: input.context.actorId,
          status: "published",
          validFrom: input.context.effectiveAt,
        })
        .where(eq(programmes.id, newProgrammeId));
      await database
        .update(adjustments)
        .set({
          appliedProgrammeId: newProgrammeId,
          approvedAt: input.context.effectiveAt,
          approvedBy: input.context.actorId,
          status: "applied",
          version: adjustment.version + 1,
        })
        .where(eq(adjustments.id, adjustment.id));
      await database.insert(sessions).values(
        adjustedPayload.days.map((day) => ({
          clientId: base.clientId,
          id: randomUUID(),
          planned: jsonValue(day.exercises),
          programmeId: newProgrammeId,
          scheduledFor: day.scheduledDate,
          sessionKey: `day-${String(day.dayIndex)}`,
        })),
      );
      await database.insert(coachActions).values({
        action: input.approval === "override" ? "overrode_block" : "approved",
        adjustmentId: adjustment.id,
        clientId: base.clientId,
        coachId: input.context.actorId,
        id: randomUUID(),
        reason,
        requestId: input.context.requestId,
      });
    });
    const programme = await this.database.query.programmes.findFirst({
      where: eq(programmes.id, newProgrammeId),
    });
    if (programme === undefined)
      throw new DatabaseInvariantError(
        "dependency_unavailable",
        "Applied programme was not found.",
      );
    return programmeFromRow(programme);
  }

  public async reject(input: Parameters<AdjustmentPort["reject"]>[0]): Promise<Adjustment> {
    await this.adapter.transaction(async (database) => {
      await database.execute(
        sql`SELECT id FROM adjustments WHERE id = ${input.adjustmentId} FOR UPDATE`,
      );
      const adjustment = await database.query.adjustments.findFirst({
        where: eq(adjustments.id, input.adjustmentId),
      });
      if (adjustment === undefined) {
        throw new ApplicationError("not_found", "Adjustment does not exist.");
      }
      if (adjustment.version !== input.expectedVersion) {
        throw new ApplicationError("version_conflict", "Adjustment version changed.");
      }
      if (adjustment.status !== "draft" && adjustment.status !== "queued") {
        throw new ApplicationError(
          "invalid_state_transition",
          "Only pending adjustments can be rejected.",
        );
      }
      const updated = await database
        .update(adjustments)
        .set({ status: "rejected", version: adjustment.version + 1 })
        .where(
          and(
            eq(adjustments.id, adjustment.id),
            eq(adjustments.version, input.expectedVersion),
            inArray(adjustments.status, ["draft", "queued"]),
          ),
        )
        .returning({ id: adjustments.id });
      if (updated.length !== 1) {
        throw new ApplicationError("version_conflict", "Adjustment version changed.");
      }
      await database.insert(coachActions).values({
        action: "rejected",
        adjustmentId: adjustment.id,
        clientId: adjustment.clientId,
        coachId: input.context.actorId,
        id: randomUUID(),
        reason: input.reason,
        requestId: input.context.requestId,
      });
    });
    const rejected = await this.database.query.adjustments.findFirst({
      where: eq(adjustments.id, input.adjustmentId),
    });
    if (rejected === undefined)
      throw new DatabaseInvariantError(
        "dependency_unavailable",
        "Rejected adjustment was not found.",
      );
    return adjustmentFromRow(rejected);
  }
}

function adherence(completed: number, planned: number): number | null {
  return planned === 0 ? null : completed / planned;
}

export class DrizzleAccountabilityRepository implements AccountabilityPort {
  public constructor(
    private readonly adapter: DatabaseAdapter,
    private readonly audit: BufferedAgentAuditRepository,
  ) {}

  private get database(): DatabaseSession {
    return this.adapter.database;
  }

  public async get(clientId: string): Promise<AccountabilityDetail | undefined> {
    const client = await this.database.query.clients.findFirst({
      where: and(eq(clients.id, clientId), eq(clients.dataClassification, "synthetic")),
    });
    if (client === undefined) return undefined;
    const [state, score, messageRows] = await Promise.all([
      this.database.query.accountabilityStates.findFirst({
        where: eq(accountabilityStates.clientId, clientId),
      }),
      this.database.query.engagementScores.findFirst({
        orderBy: [desc(engagementScores.computedAt), desc(engagementScores.id)],
        where: eq(engagementScores.clientId, clientId),
      }),
      this.database
        .select()
        .from(messages)
        .where(eq(messages.clientId, clientId))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(100),
    ]);
    return accountabilityDetailSchema.parse({
      latestScore:
        score === undefined
          ? null
          : {
              adherence14d: score.adherence14d,
              adherence7d: score.adherence7d,
              clientId: score.clientId,
              computedAt: score.computedAt.toISOString(),
              id: score.id,
              inputs: score.inputs,
              score: score.score,
              tier: score.tier,
            },
      messages: messageRows.map(messageFromRow),
      state: {
        automationPaused: state?.automationPaused ?? false,
        churnFlagged: state?.churnFlagged ?? false,
        clientId,
        lastTransitionAt: (state?.transitionedAt ?? client.createdAt).toISOString(),
        owner: state?.owner ?? "none",
        tier: state?.tier ?? 0,
        version: state?.version ?? 1,
      },
    });
  }

  public async loadInputs(clientId: string, effectiveAt: Date): Promise<EngagementInputs> {
    const client = await this.database.query.clients.findFirst({ where: eq(clients.id, clientId) });
    if (client === undefined)
      throw new ApplicationError("client_not_found", "Client does not exist.");
    const date = localDate(effectiveAt, client.timezone);
    const cutoff14 = subtractDays(date, 13);
    const cutoff7 = subtractDays(date, 6);
    const [sessionRows, checkInRows, open, rpeRows] = await Promise.all([
      this.database
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.clientId, clientId),
            gte(sessions.scheduledFor, cutoff14),
            lte(sessions.scheduledFor, date),
          ),
        ),
      this.database
        .select()
        .from(checkIns)
        .where(eq(checkIns.clientId, clientId))
        .orderBy(desc(checkIns.respondedAt))
        .limit(10),
      this.database.query.appEvents.findFirst({
        orderBy: [desc(appEvents.occurredAt)],
        where: and(eq(appEvents.clientId, clientId), eq(appEvents.kind, "app_open")),
      }),
      this.database
        .select({ rpe: sessions.rpe })
        .from(sessions)
        .where(
          and(
            eq(sessions.clientId, clientId),
            eq(sessions.status, "completed"),
            sql`${sessions.rpe} IS NOT NULL`,
          ),
        )
        .orderBy(desc(sessions.performedAt))
        .limit(5),
    ]);
    const dueRows = sessionRows.filter((session) => session.status !== "scheduled");
    const seven = dueRows.filter((session) => session.scheduledFor >= cutoff7);
    const completed7 = seven.filter((session) => session.status === "completed").length;
    const completed14 = dueRows.filter((session) => session.status === "completed").length;
    const latencies = checkInRows
      .map((checkIn) => checkIn.latencyHours)
      .filter((value): value is number => value !== null && value > 0);
    const baseline = latencies.slice(1);
    const daysSinceOpen =
      open === undefined
        ? null
        : Math.max(
            0,
            Math.floor(
              (new Date(`${date}T00:00:00.000Z`).valueOf() -
                new Date(
                  `${localDate(open.occurredAt, client.timezone)}T00:00:00.000Z`,
                ).valueOf()) /
                86_400_000,
            ),
          );
    const rpes = rpeRows.map((row) => row.rpe).filter((value): value is number => value !== null);
    return engagementInputsSchema.parse({
      baselineCheckInCount: baseline.length,
      baselineCheckInLatencyHours:
        baseline.length === 0
          ? null
          : baseline.reduce((total, value) => total + value, 0) / baseline.length,
      completedDue14d: completed14,
      completedDue7d: completed7,
      currentCheckInLatencyHours: latencies[0] ?? null,
      daysSinceOpen,
      missedDue14d: dueRows.filter((session) => session.status === "missed").length,
      missedDue7d: seven.filter((session) => session.status === "missed").length,
      plannedDue14d: dueRows.length,
      plannedDue7d: seven.length,
      rpeDrift:
        rpes.length < 2
          ? null
          : (rpes[0] ?? 0) -
            rpes.slice(1).reduce((total, value) => total + value, 0) / (rpes.length - 1),
    });
  }

  public async commitDecision(
    input: Parameters<AccountabilityPort["commitDecision"]>[0],
  ): Promise<AccountabilityDetail> {
    await this.adapter.transaction(async (database) => {
      await database
        .insert(messageGuards)
        .values({ clientId: input.clientId })
        .onConflictDoNothing();
      await database.execute(
        sql`SELECT client_id FROM message_guards WHERE client_id = ${input.clientId} FOR UPDATE`,
      );
      const [guard, currentState] = await Promise.all([
        database.query.messageGuards.findFirst({
          where: eq(messageGuards.clientId, input.clientId),
        }),
        database.query.accountabilityStates.findFirst({
          where: eq(accountabilityStates.clientId, input.clientId),
        }),
      ]);
      const preserveHumanOwnership =
        currentState?.owner === "coach" && input.nextState.owner !== "coach";
      const committedState = preserveHumanOwnership
        ? {
            automationPaused: currentState.automationPaused,
            churnFlagged: currentState.churnFlagged,
            owner: currentState.owner,
            tier: currentState.tier,
            version: Math.max(input.nextState.version, currentState.version + 1),
          }
        : input.nextState;
      if (input.runId !== null) await this.audit.persistSuccess(database, input.runId);
      const computationKey = `daily:${input.context.effectiveAt.toISOString().slice(0, 10)}`;
      const candidateScoreId = randomUUID();
      const insertedScores = await database
        .insert(engagementScores)
        .values({
          adherence14d: adherence(input.inputs.completedDue14d, input.inputs.plannedDue14d),
          adherence7d: adherence(input.inputs.completedDue7d, input.inputs.plannedDue7d),
          clientId: input.clientId,
          computationKey,
          computedAt: input.context.effectiveAt,
          daysSinceOpen: input.inputs.daysSinceOpen,
          id: candidateScoreId,
          inputs: jsonObject(input.inputs),
          policyVersion: "v1",
          score: Math.max(
            0,
            Math.min(
              100,
              100 * (adherence(input.inputs.completedDue14d, input.inputs.plannedDue14d) ?? 1),
            ),
          ),
          tier: input.tier,
        })
        .onConflictDoNothing()
        .returning({ id: engagementScores.id });
      const storedScore =
        insertedScores[0] ??
        (await database.query.engagementScores.findFirst({
          where: and(
            eq(engagementScores.clientId, input.clientId),
            eq(engagementScores.computationKey, computationKey),
          ),
        }));
      if (storedScore === undefined) {
        throw new DatabaseInvariantError(
          "dependency_unavailable",
          "Accountability score was not found after its atomic claim.",
        );
      }
      const scoreId = storedScore.id;
      await database
        .insert(accountabilityStates)
        .values({
          automationPaused: committedState.automationPaused,
          churnFlagged: committedState.churnFlagged,
          clientId: input.clientId,
          latestScoreId: scoreId,
          owner: committedState.owner,
          tier: committedState.tier,
          transitionedAt: input.context.effectiveAt,
          version: committedState.version,
        })
        .onConflictDoUpdate({
          set: {
            automationPaused: committedState.automationPaused,
            churnFlagged: committedState.churnFlagged,
            latestScoreId: scoreId,
            owner: committedState.owner,
            tier: committedState.tier,
            transitionedAt: input.context.effectiveAt,
            version: committedState.version,
          },
          target: accountabilityStates.clientId,
        });
      if (input.tier >= 3) {
        await database
          .update(messages)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(messages.clientId, input.clientId),
              eq(messages.actor, "automation"),
              eq(messages.status, "drafted"),
            ),
          );
      }
      if (input.draftedContent !== null && input.tier >= 1 && input.tier <= 3) {
        if (input.tier === 1) {
          const eligible =
            input.automatedSendAllowed &&
            committedState.owner !== "coach" &&
            (guard?.lastAutomatedSentAt === null ||
              guard?.lastAutomatedSentAt === undefined ||
              input.context.effectiveAt.valueOf() - guard.lastAutomatedSentAt.valueOf() >=
                48 * 60 * 60 * 1_000);
          await database.insert(messages).values({
            actor: "automation",
            body: input.draftedContent,
            clientId: input.clientId,
            engagementScoreId: scoreId,
            id: randomUUID(),
            sentAt: eligible ? input.context.effectiveAt : null,
            status: eligible ? "sent" : "suppressed",
            suppressedAt: eligible ? null : input.context.effectiveAt,
            suppressionReason: eligible ? null : "automated_message_within_48h_or_human_owned",
            tier: 1,
          });
          if (eligible) {
            await database
              .update(messageGuards)
              .set({
                lastAutomatedSentAt: input.context.effectiveAt,
                version: sql`${messageGuards.version} + 1`,
              })
              .where(eq(messageGuards.clientId, input.clientId));
          }
        } else {
          await database.insert(messages).values({
            actor: "coach",
            body: input.draftedContent,
            clientId: input.clientId,
            engagementScoreId: scoreId,
            id: randomUUID(),
            status: "drafted",
            tier: input.tier,
          });
        }
      }
    });
    const result = await this.get(input.clientId);
    if (result === undefined)
      throw new DatabaseInvariantError(
        "dependency_unavailable",
        "Accountability state was not found.",
      );
    return result;
  }
}

export class DrizzleScorecardRepository implements ScorecardPort {
  public constructor(private readonly database: DatabaseSession) {}

  public async get(): Promise<Scorecard> {
    const [evaluationRows, runRows, published] = await Promise.all([
      this.database.select().from(evalResults),
      this.database.select().from(agentRuns),
      this.database.select().from(programmes).where(eq(programmes.status, "published")),
    ]);
    const safetyPassRateByGate: Record<
      string,
      { value: number; sampleSize: number; availability: "available" }
    > = {};
    const judgeDistribution: Record<string, number[]> = {};
    for (const evaluation of evaluationRows) {
      if (evaluation.kind === "gate" && evaluation.passed !== null) {
        const matching = evaluationRows.filter(
          (candidate) =>
            candidate.kind === "gate" &&
            candidate.name === evaluation.name &&
            candidate.passed !== null,
        );
        safetyPassRateByGate[evaluation.name] = {
          availability: "available",
          sampleSize: matching.length,
          value: matching.filter((candidate) => candidate.passed).length / matching.length,
        };
      }
      if (evaluation.kind === "judge" && evaluation.score !== null) {
        const distribution = judgeDistribution[evaluation.name] ?? [0, 0, 0, 0, 0];
        const index = evaluation.score - 1;
        distribution[index] = (distribution[index] ?? 0) + 1;
        judgeDistribution[evaluation.name] = distribution;
      }
    }
    const latencies = runRows.map((run) => run.latencyMs).sort((left, right) => left - right);
    const percentile = (fraction: number): number | null =>
      latencies.length === 0
        ? null
        : (latencies[
            Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * fraction))
          ] ?? null);
    const totalCost = runRows.reduce((total, run) => total + run.costUsd, 0);
    const modes = new Set(
      runRows.map((run) => (run.model.startsWith("recorded") ? "recorded" : "live")),
    );
    const metric = (value: number | null, sampleSize: number): Scorecard["bandAccuracy"] => ({
      availability: value === null ? ("unavailable" as const) : ("available" as const),
      sampleSize,
      value,
    });
    return scorecardSchema.parse({
      bandAccuracy: metric(null, 0),
      calibrationKappaByJudge: {},
      costPerPublishedPlanUsd: metric(
        published.length === 0 ? null : totalCost / published.length,
        published.length,
      ),
      generatedAt: new Date().toISOString(),
      judgeDistribution,
      latencyP50Ms: metric(percentile(0.5), latencies.length),
      latencyP95Ms: metric(percentile(0.95), latencies.length),
      mode: modes.size > 1 ? "mixed" : modes.has("live") ? "live" : "recorded",
      safetyPassRateByGate,
    });
  }
}

export class DrizzleJobRepository implements JobPort {
  public constructor(private readonly database: DatabaseSession) {}

  public async claim(
    runKey: string,
    jobType: "weekly_plan" | "daily_accountability",
  ): Promise<Awaited<ReturnType<JobPort["claim"]>>> {
    const id = randomUUID();
    await this.database
      .insert(jobRuns)
      .values({
        id,
        jobType,
        requestId: runKey,
        stableKey: runKey,
        startedAt: new Date(),
      })
      .onConflictDoNothing();
    const row = await this.database.query.jobRuns.findFirst({
      where: eq(jobRuns.stableKey, runKey),
    });
    if (row === undefined)
      throw new DatabaseInvariantError("dependency_unavailable", "Job run claim was not found.");
    if (row.status === "completed") {
      const summary = jobRunSummarySchema.parse(row.summary);
      if (summary.status !== "completed")
        throw new DatabaseInvariantError(
          "dependency_unavailable",
          "Stored job summary is invalid.",
        );
      return {
        kind: "completed",
        value: {
          failed: summary.failed,
          processed: summary.processed,
          runKey: summary.runKey,
          status: "completed",
          succeeded: summary.succeeded,
        },
      };
    }
    if (row.id !== id && row.status === "running")
      throw new ApplicationError("operation_in_progress", "Job is already running.");
    if (row.status === "failed") {
      await this.database
        .update(jobRuns)
        .set({
          attempt: row.attempt + 1,
          errorCode: null,
          status: "running",
          startedAt: new Date(),
        })
        .where(eq(jobRuns.id, row.id));
    }
    return { kind: "claimed" };
  }

  public async complete(runKey: string, value: unknown, completedAt: Date): Promise<void> {
    await this.database
      .update(jobRuns)
      .set({ completedAt, status: "completed", summary: jsonObject(value) })
      .where(eq(jobRuns.stableKey, runKey));
  }

  public async fail(runKey: string, errorCode: string, failedAt: Date): Promise<void> {
    await this.database
      .update(jobRuns)
      .set({ completedAt: failedAt, errorCode, status: "failed" })
      .where(eq(jobRuns.stableKey, runKey));
  }
}

export class DrizzleApplicationIdempotencyRepository implements IdempotencyPort {
  public constructor(private readonly database: DatabaseSession) {}

  public async claim<T>(input: {
    readonly scope: string;
    readonly actorId: string;
    readonly key: string;
    readonly requestFingerprint: string;
  }): Promise<IdempotencyClaim<T>> {
    const id = randomUUID();
    await this.database
      .insert(idempotencyRecords)
      .values({
        actorScope: input.actorId,
        id,
        key: input.key,
        operationScope: input.scope,
        requestHash: input.requestFingerprint,
        state: "in_progress",
      })
      .onConflictDoNothing();
    const row = await this.database.query.idempotencyRecords.findFirst({
      where: and(
        eq(idempotencyRecords.operationScope, input.scope),
        eq(idempotencyRecords.actorScope, input.actorId),
        eq(idempotencyRecords.key, input.key),
      ),
    });
    if (row === undefined)
      throw new DatabaseInvariantError(
        "dependency_unavailable",
        "Idempotency claim was not found.",
      );
    if (row.requestHash !== input.requestFingerprint)
      throw new ApplicationError(
        "idempotency_key_reused",
        "Idempotency key was reused with different input.",
      );
    if (row.state === "completed" && row.response !== null) {
      return { kind: "completed", recordId: row.id, value: structuredClone(row.response) as T };
    }
    if (row.state === "failed") {
      await this.database
        .update(idempotencyRecords)
        .set({ errorCode: null, state: "in_progress" })
        .where(eq(idempotencyRecords.id, row.id));
      return { kind: "claimed", recordId: row.id };
    }
    if (row.id !== id)
      throw new ApplicationError(
        "operation_in_progress",
        "An identical operation is already running.",
      );
    return { kind: "claimed", recordId: row.id };
  }

  public async complete(recordId: string, value: unknown, completedAt: Date): Promise<void> {
    await this.database
      .update(idempotencyRecords)
      .set({
        completedAt,
        response: jsonObject(value),
        responseStatus: 200,
        state: "completed",
      })
      .where(eq(idempotencyRecords.id, recordId));
  }

  public async fail(recordId: string, code: string, failedAt: Date): Promise<void> {
    await this.database
      .update(idempotencyRecords)
      .set({
        completedAt: failedAt,
        errorCode: code,
        state: "failed",
      })
      .where(eq(idempotencyRecords.id, recordId));
  }
}
