import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";

import type { DatabaseSession } from "../database-types.js";
import { clientConstraints, clientNotes, programmes } from "../schema.js";

export type ClientConstraintRecord = typeof clientConstraints.$inferSelect;
export type ClientNoteRecord = typeof clientNotes.$inferSelect;
export type ContextProgrammeRecord = typeof programmes.$inferSelect;

export class ContextRepository {
  constructor(private readonly database: DatabaseSession) {}

  async findActiveHardConstraints(
    clientId: string,
    effectiveAt: Date,
  ): Promise<ClientConstraintRecord[]> {
    const rows = await this.database
      .select()
      .from(clientConstraints)
      .where(
        and(
          eq(clientConstraints.clientId, clientId),
          eq(clientConstraints.severity, "hard"),
          isNull(clientConstraints.supersededBy),
          lte(clientConstraints.validFrom, effectiveAt),
          or(isNull(clientConstraints.validUntil), gt(clientConstraints.validUntil, effectiveAt)),
        ),
      )
      .orderBy(clientConstraints.createdAt, clientConstraints.id);
    return rows;
  }

  async findEligibleNotes(
    clientId: string,
    effectiveAt: Date,
    limit = 50,
  ): Promise<ClientNoteRecord[]> {
    const rows = await this.database
      .select()
      .from(clientNotes)
      .where(
        and(
          eq(clientNotes.clientId, clientId),
          isNull(clientNotes.supersededBy),
          lte(clientNotes.validFrom, effectiveAt),
          or(isNull(clientNotes.validUntil), gt(clientNotes.validUntil, effectiveAt)),
        ),
      )
      .orderBy(desc(clientNotes.createdAt), clientNotes.id)
      .limit(Math.max(1, Math.min(limit, 100)));
    return rows;
  }

  async findCurrentProgramme(
    clientId: string,
    weekStart: string,
  ): Promise<ContextProgrammeRecord | undefined> {
    const row = await this.database.query.programmes.findFirst({
      where: and(
        eq(programmes.clientId, clientId),
        eq(programmes.weekStart, weekStart),
        eq(programmes.status, "published"),
        isNull(programmes.supersededBy),
      ),
    });
    return row;
  }
}
