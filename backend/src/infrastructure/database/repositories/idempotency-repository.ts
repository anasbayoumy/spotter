import { and, eq } from "drizzle-orm";

import { DatabaseInvariantError } from "../database-error.js";
import type { DatabaseSession } from "../database-types.js";
import { idempotencyRecords, type JsonObject } from "../schema.js";

export interface ClaimIdempotencyInput {
  readonly id: string;
  readonly operationScope: string;
  readonly actorScope: string;
  readonly key: string;
  readonly requestHash: string;
  readonly lockedUntil?: Date;
}

export type IdempotencyClaim =
  | { readonly kind: "claimed"; readonly recordId: string }
  | {
      readonly kind: "completed";
      readonly recordId: string;
      readonly status: number;
      readonly response: JsonObject;
    };

export class IdempotencyRepository {
  constructor(private readonly database: DatabaseSession) {}

  async claim(input: ClaimIdempotencyInput): Promise<IdempotencyClaim> {
    await this.database
      .insert(idempotencyRecords)
      .values({
        actorScope: input.actorScope,
        id: input.id,
        key: input.key,
        lockedUntil: input.lockedUntil,
        operationScope: input.operationScope,
        requestHash: input.requestHash,
        state: "in_progress",
      })
      .onConflictDoNothing();

    const record = await this.database.query.idempotencyRecords.findFirst({
      where: and(
        eq(idempotencyRecords.operationScope, input.operationScope),
        eq(idempotencyRecords.actorScope, input.actorScope),
        eq(idempotencyRecords.key, input.key),
      ),
    });

    if (record === undefined) {
      throw new DatabaseInvariantError(
        "dependency_unavailable",
        "Unable to claim idempotency record.",
      );
    }
    if (record.requestHash !== input.requestHash) {
      throw new DatabaseInvariantError(
        "idempotency_key_reused",
        "Idempotency key was reused with a different request.",
      );
    }
    if (
      record.state === "completed" &&
      record.response !== null &&
      record.responseStatus !== null
    ) {
      return {
        kind: "completed",
        recordId: record.id,
        response: record.response,
        status: record.responseStatus,
      };
    }
    if (record.id !== input.id) {
      throw new DatabaseInvariantError(
        "operation_in_progress",
        "An identical operation is already in progress.",
      );
    }

    return { kind: "claimed", recordId: record.id };
  }

  async complete(
    recordId: string,
    status: number,
    response: JsonObject,
    completedAt: Date,
  ): Promise<void> {
    await this.database
      .update(idempotencyRecords)
      .set({ completedAt, lockedUntil: null, response, responseStatus: status, state: "completed" })
      .where(and(eq(idempotencyRecords.id, recordId), eq(idempotencyRecords.state, "in_progress")));
  }
}
