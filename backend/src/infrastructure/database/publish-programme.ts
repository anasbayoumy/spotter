import { and, eq, isNull, sql } from "drizzle-orm";

import { DatabaseInvariantError, isUniqueViolation } from "./database-error";
import type { UnitOfWork } from "./unit-of-work";
import { coachActions, programmes, sessions, type JsonObject, type JsonValue } from "./schema";
import { IdempotencyRepository } from "./repositories/idempotency-repository";

export interface ProgrammeSessionMaterialization {
  readonly id: string;
  readonly sessionKey: string;
  readonly scheduledFor: string;
  readonly planned: JsonValue;
}

export interface PublishProgrammeCommand {
  readonly actionId: string;
  readonly approval: "standard" | "override";
  readonly approvedAt: Date;
  readonly candidateProgrammeId: string;
  readonly coachId: string;
  readonly idempotencyKey: string;
  readonly idempotencyRecordId: string;
  readonly reason?: string;
  readonly requestHash: string;
  readonly requestId: string;
  readonly sessions: readonly ProgrammeSessionMaterialization[];
}

export interface PublishProgrammeResult {
  readonly programmeId: string;
  readonly status: "published";
}

function recoverPublishedProgrammeResult(response: JsonObject): PublishProgrammeResult {
  const programmeId = response["programmeId"];
  const status = response["status"];
  if (typeof programmeId !== "string" || status !== "published") {
    throw new DatabaseInvariantError(
      "dependency_unavailable",
      "Stored idempotency response does not match the programme publication contract.",
    );
  }

  return { programmeId, status };
}

export class PublishProgrammeTransaction {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async execute(command: PublishProgrammeCommand): Promise<PublishProgrammeResult> {
    try {
      return await this.unitOfWork.run(async (database) => {
        const idempotency = new IdempotencyRepository(database);
        const claim = await idempotency.claim({
          actorScope: command.coachId,
          id: command.idempotencyRecordId,
          key: command.idempotencyKey,
          operationScope: "programme.publish",
          requestHash: command.requestHash,
        });
        if (claim.kind === "completed") {
          return recoverPublishedProgrammeResult(claim.response);
        }

        await database.execute(
          sql`SELECT id FROM programmes WHERE id = ${command.candidateProgrammeId} FOR UPDATE`,
        );
        const candidate = await database.query.programmes.findFirst({
          where: eq(programmes.id, command.candidateProgrammeId),
        });
        if (candidate === undefined) {
          throw new DatabaseInvariantError("not_found", "Programme does not exist.");
        }
        if (candidate.status !== "queued") {
          throw new DatabaseInvariantError(
            "invalid_state_transition",
            "Only a queued programme can be published.",
          );
        }
        if (candidate.reviewBand === "blocked" && command.approval !== "override") {
          throw new DatabaseInvariantError(
            "blocked_requires_override",
            "Blocked programme requires override.",
          );
        }
        const reason = command.reason?.trim();
        if (command.approval === "override" && candidate.reviewBand !== "blocked") {
          throw new DatabaseInvariantError(
            "invalid_state_transition",
            "Only a blocked programme can be overridden.",
          );
        }
        if (command.approval === "override" && !reason) {
          throw new DatabaseInvariantError(
            "override_reason_required",
            "Override requires a non-empty reason.",
          );
        }

        const currentSlot = and(
          eq(programmes.clientId, candidate.clientId),
          eq(programmes.weekStart, candidate.weekStart),
          eq(programmes.status, "published"),
          isNull(programmes.supersededBy),
        );
        const observedCurrent = await database.query.programmes.findFirst({
          where: currentSlot,
        });
        if (this.unitOfWork.capabilities.advisoryLocks) {
          await database.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${candidate.clientId}:${candidate.weekStart}`}, 0))`,
          );
        }
        await database.execute(sql`
          SELECT id FROM programmes
          WHERE client_id = ${candidate.clientId} AND week_start = ${candidate.weekStart}
            AND status = 'published' AND superseded_by IS NULL
          FOR UPDATE
        `);
        const lockedCurrent = await database.query.programmes.findFirst({ where: currentSlot });
        if (lockedCurrent?.id !== observedCurrent?.id) {
          throw new DatabaseInvariantError(
            "publication_conflict",
            "Another publication changed this programme slot.",
          );
        }

        await database
          .update(programmes)
          .set({ status: "superseded", supersededBy: candidate.id })
          .where(currentSlot);
        await database
          .update(programmes)
          .set({
            approvalKind: command.approval,
            approvedAt: command.approvedAt,
            approvedBy: command.coachId,
            status: "published",
            validFrom: command.approvedAt,
          })
          .where(and(eq(programmes.id, candidate.id), eq(programmes.status, "queued")));

        if (command.sessions.length > 0) {
          await database
            .insert(sessions)
            .values(
              command.sessions.map((session) => ({
                clientId: candidate.clientId,
                id: session.id,
                planned: session.planned,
                programmeId: candidate.id,
                scheduledFor: session.scheduledFor,
                sessionKey: session.sessionKey,
              })),
            )
            .onConflictDoNothing();
        }
        await database.insert(coachActions).values({
          action: command.approval === "override" ? "overrode_block" : "approved",
          clientId: candidate.clientId,
          coachId: command.coachId,
          id: command.actionId,
          programmeId: candidate.id,
          reason: reason,
          requestId: command.requestId,
        });

        const response: JsonObject = { programmeId: candidate.id, status: "published" };
        await idempotency.complete(claim.recordId, 200, response, command.approvedAt);
        return { programmeId: candidate.id, status: "published" };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DatabaseInvariantError(
          "publication_conflict",
          "Another publication won this programme slot.",
          {
            cause: error,
          },
        );
      }
      throw error;
    }
  }
}
