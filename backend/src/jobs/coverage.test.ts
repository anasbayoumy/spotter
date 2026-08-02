import { clientSummarySchema } from "@spotter/contracts";
import { describe, expect, it, vi } from "vitest";

import type { RunAccountabilityForClient } from "../application/accountability.js";
import { ApplicationError, type ExecutionContext } from "../application/core.js";
import type { ClientReadPort, JobPort } from "../application/ports.js";
import type { GenerateProgramme } from "../application/programmes.js";
import { dailyAccountabilityRunKey, RunDailyAccountabilityJob } from "./daily-accountability.js";
import { RunWeeklyPlanJob, weeklyPlanRunKey } from "./weekly-plan.js";

const effectiveAt = new Date("2026-08-02T12:00:00.000Z");
const context: ExecutionContext = {
  requestId: "job-coverage",
  actorId: "00000000-0000-4000-8000-000000000501",
  effectiveAt,
  idempotencyKey: "job:coverage:001",
};
const clients = [
  clientSummarySchema.parse({
    id: "00000000-0000-4000-8000-000000000502",
    handle: "c_first",
    status: "active",
    timezone: "Africa/Cairo",
    goals: { primary: "Synthetic goal", secondary: [], targetDate: null },
    profile: {
      ageBand: "25_34",
      sex: "not_specified",
      trainingAgeMonths: 12,
      equipment: ["barbell"],
      sessionsPerWeek: 3,
    },
    coachId: context.actorId,
    dataClassification: "synthetic",
    createdAt: effectiveAt.toISOString(),
  }),
  clientSummarySchema.parse({
    id: "00000000-0000-4000-8000-000000000503",
    handle: "c_second",
    status: "active",
    timezone: "Africa/Cairo",
    goals: { primary: "Synthetic goal", secondary: [], targetDate: null },
    profile: {
      ageBand: "35_44",
      sex: "not_specified",
      trainingAgeMonths: 24,
      equipment: ["dumbbell"],
      sessionsPerWeek: 4,
    },
    coachId: context.actorId,
    dataClassification: "synthetic",
    createdAt: effectiveAt.toISOString(),
  }),
];

function clientPort(list: ClientReadPort["listSyntheticActive"]): ClientReadPort {
  return {
    listSyntheticActive: list,
    getDetail: () => Promise.resolve(undefined),
    getToday: () => Promise.resolve(undefined),
    listVisibleMessages: () => Promise.resolve([]),
  };
}

function jobPort(overrides: Partial<JobPort> = {}): JobPort {
  return {
    claim: () => Promise.resolve({ kind: "claimed" }),
    complete: () => Promise.resolve(),
    fail: () => Promise.resolve(),
    ...overrides,
  };
}

function programmeRunner(execute: GenerateProgramme["execute"]): GenerateProgramme {
  return { execute } as GenerateProgramme;
}

function accountabilityRunner(
  execute: RunAccountabilityForClient["execute"],
): RunAccountabilityForClient {
  return { execute } as RunAccountabilityForClient;
}

describe("weekly job execution coverage", () => {
  it("continues across clients and completes an accurate mixed summary", async () => {
    const execute = vi
      .fn<GenerateProgramme["execute"]>()
      .mockResolvedValueOnce({} as Awaited<ReturnType<GenerateProgramme["execute"]>>)
      .mockRejectedValueOnce(new Error("one client failed"));
    const complete = vi.fn<JobPort["complete"]>().mockResolvedValue(undefined);
    const runKey = weeklyPlanRunKey("2026-08-03");
    await expect(
      new RunWeeklyPlanJob(
        clientPort(() => Promise.resolve(clients)),
        programmeRunner(execute),
        jobPort({ complete }),
      ).execute({ targetWeekStart: "2026-08-03", runKey }, context),
    ).resolves.toEqual({ runKey, status: "completed", processed: 2, succeeded: 1, failed: 1 });
    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ clientId: clients[0]?.id }),
      expect.objectContaining({ requestId: "job-coverage:c_first" }),
    );
    expect(complete).toHaveBeenCalledWith(
      runKey,
      expect.objectContaining({ processed: 2 }),
      effectiveAt,
    );
  });

  it.each([
    [new ApplicationError("dependency_unavailable", "clients down"), "dependency_unavailable"],
    [new Error("clients down"), "internal_error"],
  ])("fails the claimed run with the stable outer error code", async (failure, expectedCode) => {
    const fail = vi.fn<JobPort["fail"]>().mockResolvedValue(undefined);
    const runKey = weeklyPlanRunKey("2026-08-03");
    const job = new RunWeeklyPlanJob(
      clientPort(() => Promise.reject(failure)),
      programmeRunner(() => Promise.reject(new Error("unused"))),
      jobPort({ fail }),
    );
    await expect(job.execute({ targetWeekStart: "2026-08-03", runKey }, context)).rejects.toBe(
      failure,
    );
    expect(fail).toHaveBeenCalledWith(runKey, expectedCode, effectiveAt);
  });

  it("marks the run failed if final completion persistence fails", async () => {
    const failure = new Error("completion down");
    const fail = vi.fn<JobPort["fail"]>().mockResolvedValue(undefined);
    const runKey = weeklyPlanRunKey("2026-08-03");
    const job = new RunWeeklyPlanJob(
      clientPort(() => Promise.resolve([])),
      programmeRunner(() => Promise.reject(new Error("unused"))),
      jobPort({ complete: () => Promise.reject(failure), fail }),
    );
    await expect(job.execute({ targetWeekStart: "2026-08-03", runKey }, context)).rejects.toBe(
      failure,
    );
    expect(fail).toHaveBeenCalledWith(runKey, "internal_error", effectiveAt);
  });
});

describe("daily job execution coverage", () => {
  it("rejects a mismatched logical run key", async () => {
    const job = new RunDailyAccountabilityJob(
      clientPort(() => Promise.resolve([])),
      accountabilityRunner(() => Promise.reject(new Error("unused"))),
      jobPort(),
    );
    await expect(job.execute({ effectiveAt, runKey: "wrong" }, context)).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("continues across clients with the requested effective instant", async () => {
    const execute = vi
      .fn<RunAccountabilityForClient["execute"]>()
      .mockResolvedValueOnce({} as Awaited<ReturnType<RunAccountabilityForClient["execute"]>>)
      .mockRejectedValueOnce(new Error("one client failed"));
    const complete = vi.fn<JobPort["complete"]>().mockResolvedValue(undefined);
    const runKey = dailyAccountabilityRunKey(effectiveAt);
    await expect(
      new RunDailyAccountabilityJob(
        clientPort(() => Promise.resolve(clients)),
        accountabilityRunner(execute),
        jobPort({ complete }),
      ).execute({ effectiveAt, runKey }, context),
    ).resolves.toEqual({ runKey, status: "completed", processed: 2, succeeded: 1, failed: 1 });
    expect(execute).toHaveBeenNthCalledWith(
      1,
      clients[0]?.id,
      expect.objectContaining({ effectiveAt, requestId: "job-coverage:c_first" }),
    );
    expect(complete).toHaveBeenCalledWith(
      runKey,
      expect.objectContaining({ failed: 1 }),
      effectiveAt,
    );
  });

  it.each([
    [new ApplicationError("dependency_unavailable", "clients down"), "dependency_unavailable"],
    [new Error("clients down"), "internal_error"],
  ])("records typed and unknown outer job failure", async (failure, expectedCode) => {
    const fail = vi.fn<JobPort["fail"]>().mockResolvedValue(undefined);
    const runKey = dailyAccountabilityRunKey(effectiveAt);
    const job = new RunDailyAccountabilityJob(
      clientPort(() => Promise.reject(failure)),
      accountabilityRunner(() => Promise.reject(new Error("unused"))),
      jobPort({ fail }),
    );
    await expect(job.execute({ effectiveAt, runKey }, context)).rejects.toBe(failure);
    expect(fail).toHaveBeenCalledWith(runKey, expectedCode, effectiveAt);
  });

  it("fails the daily run when completion cannot be persisted", async () => {
    const failure = new Error("completion down");
    const fail = vi.fn<JobPort["fail"]>().mockResolvedValue(undefined);
    const runKey = dailyAccountabilityRunKey(effectiveAt);
    const job = new RunDailyAccountabilityJob(
      clientPort(() => Promise.resolve([])),
      accountabilityRunner(() => Promise.reject(new Error("unused"))),
      jobPort({ complete: () => Promise.reject(failure), fail }),
    );
    await expect(job.execute({ effectiveAt, runKey }, context)).rejects.toBe(failure);
    expect(fail).toHaveBeenCalledWith(runKey, "internal_error", effectiveAt);
  });
});
