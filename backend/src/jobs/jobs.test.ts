import { describe, expect, it } from "vitest";

import type { RunAccountabilityForClient } from "../application/accountability.js";
import type { ExecutionContext } from "../application/core.js";
import type { GenerateProgramme } from "../application/programmes.js";
import type { ClientReadPort, JobPort } from "../application/ports.js";
import { dailyAccountabilityRunKey, RunDailyAccountabilityJob } from "./daily-accountability.js";
import { RunWeeklyPlanJob, weeklyPlanRunKey, type JobSummary } from "./weekly-plan.js";

const effectiveAt = new Date("2026-08-02T12:00:00.000Z");
const context: ExecutionContext = {
  requestId: "request-jobs",
  actorId: "00000000-0000-4000-8000-000000000001",
  effectiveAt,
  idempotencyKey: "job:key:0001",
};
const completed: JobSummary = {
  runKey: "weekly-plan:2026-08-03",
  status: "completed",
  processed: 3,
  succeeded: 2,
  failed: 1,
};

function replayPort(value: JobSummary): JobPort {
  return {
    claim() {
      return Promise.resolve({ kind: "completed", value });
    },
    complete() {
      return Promise.reject(new Error("Completed replays must not complete again"));
    },
    fail() {
      return Promise.reject(new Error("Completed replays must not fail"));
    },
  };
}

describe("stable scheduled job keys", () => {
  it("derives keys only from job type and logical window", () => {
    expect(weeklyPlanRunKey("2026-08-03")).toBe("weekly-plan:2026-08-03");
    expect(dailyAccountabilityRunKey(effectiveAt)).toBe("daily-accountability:2026-08-02");
  });

  it("rejects a caller key that does not match the weekly logical window", async () => {
    const job = new RunWeeklyPlanJob(
      {} as ClientReadPort,
      {} as GenerateProgramme,
      replayPort(completed),
    );
    await expect(
      job.execute({ targetWeekStart: "2026-08-03", runKey: "wrong" }, context),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("returns a completed weekly replay without running client work", async () => {
    const job = new RunWeeklyPlanJob(
      {} as ClientReadPort,
      {} as GenerateProgramme,
      replayPort(completed),
    );
    await expect(
      job.execute({ targetWeekStart: "2026-08-03", runKey: "weekly-plan:2026-08-03" }, context),
    ).resolves.toEqual(completed);
  });

  it("returns a completed daily replay without running per-client work", async () => {
    const daily: JobSummary = {
      ...completed,
      runKey: "daily-accountability:2026-08-02",
    };
    const job = new RunDailyAccountabilityJob(
      {} as ClientReadPort,
      {} as RunAccountabilityForClient,
      replayPort(daily),
    );
    await expect(
      job.execute({ effectiveAt, runKey: "daily-accountability:2026-08-02" }, context),
    ).resolves.toEqual(daily);
  });
});
