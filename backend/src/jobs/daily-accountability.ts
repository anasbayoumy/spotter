import type { RunAccountabilityForClient } from "../application/accountability.js";
import { ApplicationError, type ExecutionContext } from "../application/core.js";
import type { ClientReadPort, JobPort } from "../application/ports.js";
import type { JobSummary } from "./weekly-plan.js";

export function dailyAccountabilityRunKey(effectiveAt: Date): string {
  return `daily-accountability:${effectiveAt.toISOString().slice(0, 10)}`;
}

export class RunDailyAccountabilityJob {
  public constructor(
    private readonly clients: ClientReadPort,
    private readonly runAccountability: RunAccountabilityForClient,
    private readonly jobs: JobPort,
  ) {}

  public async execute(
    input: { readonly effectiveAt: Date; readonly runKey: string },
    context: ExecutionContext,
  ): Promise<JobSummary> {
    const expectedKey = dailyAccountabilityRunKey(input.effectiveAt);
    if (input.runKey !== expectedKey) {
      throw new ApplicationError(
        "validation_failed",
        "Accountability job run key does not match its logical window.",
      );
    }
    const claim = await this.jobs.claim(expectedKey, "daily_accountability");
    if (claim.kind === "completed") return claim.value;
    try {
      const clients = await this.clients.listSyntheticActive();
      let succeeded = 0;
      let failed = 0;
      for (const client of clients) {
        try {
          await this.runAccountability.execute(client.id, {
            ...context,
            effectiveAt: input.effectiveAt,
            idempotencyKey: `${expectedKey}:${client.id}`,
            requestId: `${context.requestId}:${client.handle}`,
          });
          succeeded += 1;
        } catch {
          failed += 1;
        }
      }
      const summary: JobSummary = {
        runKey: expectedKey,
        status: "completed",
        processed: clients.length,
        succeeded,
        failed,
      };
      await this.jobs.complete(expectedKey, summary, context.effectiveAt);
      return summary;
    } catch (error: unknown) {
      await this.jobs.fail(
        expectedKey,
        error instanceof ApplicationError ? error.code : "internal_error",
        context.effectiveAt,
      );
      throw error;
    }
  }
}
