import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { DatabaseSession } from "../database-types.js";
import { programmes } from "../schema.js";

export type ProgrammeRecord = typeof programmes.$inferSelect;

export class ProgrammeRepository {
  constructor(private readonly database: DatabaseSession) {}

  async findById(programmeId: string): Promise<ProgrammeRecord | undefined> {
    const row = await this.database.query.programmes.findFirst({
      where: eq(programmes.id, programmeId),
    });
    return row;
  }

  async findCurrentPublished(
    clientId: string,
    weekStart: string,
  ): Promise<ProgrammeRecord | undefined> {
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

  async listReviewQueue(): Promise<ProgrammeRecord[]> {
    const rows = await this.database
      .select()
      .from(programmes)
      .where(eq(programmes.status, "queued"))
      .orderBy(
        sql`CASE ${programmes.reviewBand} WHEN 'blocked' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END`,
        asc(programmes.createdAt),
        asc(programmes.id),
      );
    return rows;
  }

  async listHistory(clientId: string): Promise<ProgrammeRecord[]> {
    const rows = await this.database
      .select()
      .from(programmes)
      .where(eq(programmes.clientId, clientId))
      .orderBy(desc(programmes.weekStart), desc(programmes.version), desc(programmes.createdAt));
    return rows;
  }
}
