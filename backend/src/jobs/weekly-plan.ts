import type { ExecutionContext } from "../application/core.js";
import { ApplicationError } from "../application/core.js";
import type { GenerateProgramme } from "../application/programmes.js";
import type { ClientReadPort, JobPort } from "../application/ports.js";

export interface JobSummary {
  readonly runKey: string;
  readonly status: "completed";
  readonly processed: number;
  readonly succeeded: number;
  readonly failed: number;
}

export function weeklyPlanRunKey(targetWeekStart: string): string {
  return `weekly-plan:${targetWeekStart}`;
}

export class RunWeeklyPlanJob {
  public constructor(
    private readonly clients: ClientReadPort,
    private readonly generateProgramme: GenerateProgramme,
    private readonly jobs: JobPort,
  ) {}

  public async execute(
    input: { readonly targetWeekStart: string; readonly runKey: string },
    context: ExecutionContext,
  ): Promise<JobSummary> {
    const expectedKey = weeklyPlanRunKey(input.targetWeekStart);
    if (input.runKey !== expectedKey) {
      throw new ApplicationError(
        "validation_failed",
        "Weekly job run key does not match its logical window.",
      );
    }
    const claim = await this.jobs.claim(expectedKey, "weekly_plan");
    if (claim.kind === "completed") return claim.value;
    try {
      const clients = await this.clients.listSyntheticActive();
      let succeeded = 0;
      let failed = 0;
      for (const client of clients) {
        try {
          await this.generateProgramme.execute(
            { clientId: client.id, targetWeekStart: input.targetWeekStart },
            {
              ...context,
              idempotencyKey: `${expectedKey}:${client.id}`,
              requestId: `${context.requestId}:${client.handle}`,
            },
          );
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
