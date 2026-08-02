import { and, asc, eq } from "drizzle-orm";

import type { DatabaseSession } from "../database-types";
import { clients } from "../schema";

export type ClientRecord = typeof clients.$inferSelect;

export class ClientRepository {
  constructor(private readonly database: DatabaseSession) {}

  async listActiveSynthetic(): Promise<ClientRecord[]> {
    const rows = await this.database
      .select()
      .from(clients)
      .where(and(eq(clients.status, "active"), eq(clients.dataClassification, "synthetic")))
      .orderBy(asc(clients.handle), asc(clients.id));
    return rows;
  }

  async findSyntheticById(clientId: string): Promise<ClientRecord | undefined> {
    const row = await this.database.query.clients.findFirst({
      where: and(eq(clients.id, clientId), eq(clients.dataClassification, "synthetic")),
    });
    return row;
  }

  async hasActiveNonSyntheticData(): Promise<boolean> {
    const row = await this.database.query.clients.findFirst({
      columns: { id: true },
      where: and(eq(clients.status, "active"), eq(clients.dataClassification, "non_synthetic")),
    });
    return row !== undefined;
  }
}
