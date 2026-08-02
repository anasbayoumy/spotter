import type { InferInsertModel } from "drizzle-orm";

import type { DatabaseSession } from "../database-types";
import { agentRuns, contextTraces, evalResults, type JsonObject } from "../schema";

export class AuditRepository {
  constructor(private readonly database: DatabaseSession) {}

  async insertContextTrace(input: InferInsertModel<typeof contextTraces>): Promise<string> {
    const [row] = await this.database
      .insert(contextTraces)
      .values(input)
      .returning({ id: contextTraces.id });
    if (row === undefined) {
      throw new Error("Context trace insert returned no row.");
    }
    return row.id;
  }

  async insertFailedRun(
    input: Omit<InferInsertModel<typeof agentRuns>, "output" | "status"> & {
      readonly errorCode: string;
    },
  ): Promise<string> {
    const [row] = await this.database
      .insert(agentRuns)
      .values({ ...input, output: null, status: "failed" })
      .returning({ id: agentRuns.id });
    if (row === undefined) {
      throw new Error("Agent run insert returned no row.");
    }
    return row.id;
  }

  async insertSuccessfulPipeline(
    run: Omit<InferInsertModel<typeof agentRuns>, "errorCode" | "status"> & {
      readonly output: JsonObject;
    },
    evaluations: readonly InferInsertModel<typeof evalResults>[],
  ): Promise<string> {
    const [row] = await this.database
      .insert(agentRuns)
      .values({ ...run, errorCode: null, status: "succeeded" })
      .returning({ id: agentRuns.id });
    if (row === undefined) {
      throw new Error("Agent run insert returned no row.");
    }
    if (evaluations.length > 0) {
      await this.database.insert(evalResults).values([...evaluations]);
    }
    return row.id;
  }
}
