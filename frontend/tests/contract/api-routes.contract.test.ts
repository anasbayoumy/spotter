import path from "node:path";

import { apiContracts, apiResponseSchema, type ProgrammePayload } from "@spotter/contracts";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { closeBackend } from "@spotter/backend/server";
import { GET as getAccountability } from "../../src/app/api/v1/accountability/[clientId]/route";
import { POST as runAccountability } from "../../src/app/api/v1/accountability/run/route";
import { POST as approveAdjustment } from "../../src/app/api/v1/adjustments/[adjustmentId]/approve/route";
import { POST as rejectAdjustment } from "../../src/app/api/v1/adjustments/[adjustmentId]/reject/route";
import { POST as overrideAdjustment } from "../../src/app/api/v1/adjustments/[adjustmentId]/override/route";
import { PATCH as editAdjustment } from "../../src/app/api/v1/adjustments/[adjustmentId]/route";
import { POST as generateAdjustment } from "../../src/app/api/v1/adjustments/generate/route";
import { GET as listAdjustments } from "../../src/app/api/v1/adjustments/route";
import { POST as createCheckIn } from "../../src/app/api/v1/check-ins/route";
import { GET as listMessages } from "../../src/app/api/v1/clients/[clientId]/messages/route";
import { GET as getClient } from "../../src/app/api/v1/clients/[clientId]/route";
import { GET as getToday } from "../../src/app/api/v1/clients/[clientId]/today/route";
import { GET as listClients } from "../../src/app/api/v1/clients/route";
import { POST as runDailyJob } from "../../src/app/api/v1/jobs/daily-accountability/route";
import { POST as runWeeklyJob } from "../../src/app/api/v1/jobs/weekly-plan/route";
import { POST as approveProgramme } from "../../src/app/api/v1/programmes/[programmeId]/approve/route";
import { POST as overrideProgramme } from "../../src/app/api/v1/programmes/[programmeId]/override/route";
import { POST as rejectProgramme } from "../../src/app/api/v1/programmes/[programmeId]/reject/route";
import {
  GET as getProgramme,
  PATCH as editProgramme,
} from "../../src/app/api/v1/programmes/[programmeId]/route";
import { POST as generateProgramme } from "../../src/app/api/v1/programmes/generate/route";
import { GET as listProgrammes } from "../../src/app/api/v1/programmes/route";
import { GET as getScorecard } from "../../src/app/api/v1/scorecard/route";
import { POST as completeSession } from "../../src/app/api/v1/sessions/[sessionId]/complete/route";
import { POST as logSession } from "../../src/app/api/v1/sessions/[sessionId]/log/route";
import { GET as getSession } from "../../src/app/api/v1/sessions/[sessionId]/route";
import { GET as listSessions } from "../../src/app/api/v1/sessions/route";
import { GET as getTrace } from "../../src/app/api/v1/traces/[traceId]/route";

const clientHealthy = "00000000-0000-4000-8000-000000000101";
const clientConstrained = "00000000-0000-4000-8000-000000000102";
const clientSparse = "00000000-0000-4000-8000-000000000105";
const clientDisengaged = "00000000-0000-4000-8000-000000000106";
const clientAdjustment = "00000000-0000-4000-8000-000000000107";
const programmeHealthy = "00000000-0000-4000-8000-000000000601";
const programmeBlocked = "00000000-0000-4000-8000-000000000602";
const programmeSparse = "00000000-0000-4000-8000-000000000606";
const sessionHealthy = "00000000-0000-4000-8000-000000000701";
const adjustmentQueued = "00000000-0000-4000-8000-000000001001";
const adjustmentBlocked = "00000000-0000-4000-8000-000000001002";
const traceHealthy = "00000000-0000-4000-8000-000000000201";
const exerciseId = "00000000-0000-4000-8000-000000000301";

function routeContext(
  name: string,
  value: string,
): { readonly params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ [name]: value }) };
}

function jsonRequest(
  path: string,
  method: "PATCH" | "POST",
  body: unknown,
  key: string,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request(`http://local${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
      "x-request-id": `request-${key}`.slice(0, 128),
      ...headers,
    },
    method,
  });
}

describe.sequential("the complete REST route inventory", () => {
  beforeAll(() => {
    Object.assign(process.env, {
      AI_MODE: "recorded",
      ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
      APP_ENV: "demo",
      CRON_SECRET: "contract-cron-secret",
      DATABASE_MODE: "pglite",
      DATA_POLICY: "synthetic_only",
      MIGRATIONS_DIR: path.resolve(import.meta.dirname, "../../../backend/migrations"),
      PGLITE_DATA_DIR: "memory://",
    });
  });

  afterAll(async () => {
    await closeBackend();
  });

  it("serves every documented read endpoint with its shared response contract", async () => {
    const clientsResponse = await listClients(
      new Request("http://local/api/v1/clients?status=active&limit=7", {
        headers: { "x-request-id": "contract-read-request" },
      }),
    );
    expect(clientsResponse.status).toBe(200);
    expect(clientsResponse.headers.get("x-request-id")).toBe("contract-read-request");
    const clients = apiContracts.clients.list.output.parse(await clientsResponse.json());
    expect(clients.error).toBeNull();
    expect(clients.data).toHaveLength(7);
    expect(clients.meta).toMatchObject({ cursor: null, hasMore: false, total: 7 });

    const client = apiContracts.clients.detail.output.parse(
      await (
        await getClient(
          new Request(`http://local/api/v1/clients/${clientHealthy}`),
          routeContext("clientId", clientHealthy),
        )
      ).json(),
    );
    expect(client.error).toBeNull();

    const today = apiContracts.clients.today.output.parse(
      await (
        await getToday(
          new Request(`http://local/api/v1/clients/${clientHealthy}/today`),
          routeContext("clientId", clientHealthy),
        )
      ).json(),
    );
    expect(today.error).toBeNull();
    if (today.error !== null) throw new Error(today.error.message);
    expect(today.data.nextSession).toMatchObject({ id: sessionHealthy, status: "scheduled" });

    const messages = apiContracts.clients.messages.output.parse(
      await (
        await listMessages(
          new Request(`http://local/api/v1/clients/${clientDisengaged}/messages?limit=10`),
          routeContext("clientId", clientDisengaged),
        )
      ).json(),
    );
    expect(messages.error).toBeNull();

    const programmes = apiContracts.programmes.list.output.parse(
      await (
        await listProgrammes(
          new Request(`http://local/api/v1/programmes?clientId=${clientHealthy}&limit=10`),
        )
      ).json(),
    );
    expect(programmes.error).toBeNull();

    const programme = apiContracts.programmes.detail.output.parse(
      await (
        await getProgramme(
          new Request(`http://local/api/v1/programmes/${programmeHealthy}`),
          routeContext("programmeId", programmeHealthy),
        )
      ).json(),
    );
    expect(programme.error).toBeNull();

    const sessions = apiContracts.sessions.list.output.parse(
      await (
        await listSessions(
          new Request(`http://local/api/v1/sessions?clientId=${clientHealthy}&limit=10`),
        )
      ).json(),
    );
    expect(sessions.error).toBeNull();
    if (sessions.error !== null) throw new Error(sessions.error.message);
    expect(sessions.data).toHaveLength(2);
    expect(sessions.data.map((item) => [item.id, item.status])).toEqual([
      ["00000000-0000-4000-8000-000000000708", "missed"],
      [sessionHealthy, "scheduled"],
    ]);

    const session = apiContracts.sessions.detail.output.parse(
      await (
        await getSession(
          new Request(`http://local/api/v1/sessions/${sessionHealthy}`),
          routeContext("sessionId", sessionHealthy),
        )
      ).json(),
    );
    expect(session.error).toBeNull();

    const adjustments = apiContracts.adjustments.list.output.parse(
      await (
        await listAdjustments(
          new Request(`http://local/api/v1/adjustments?clientId=${clientAdjustment}&limit=10`),
        )
      ).json(),
    );
    expect(adjustments.error).toBeNull();

    const accountability = apiContracts.accountability.detail.output.parse(
      await (
        await getAccountability(
          new Request(`http://local/api/v1/accountability/${clientDisengaged}`),
          routeContext("clientId", clientDisengaged),
        )
      ).json(),
    );
    expect(accountability.error).toBeNull();
    if (accountability.error !== null) throw new Error(accountability.error.message);
    expect(accountability.data.state).toMatchObject({
      automationPaused: true,
      owner: "coach",
      tier: 3,
    });
    expect(
      accountability.data.messages.some(
        (message) => message.actor === "agent" && message.status === "sent",
      ),
    ).toBe(false);

    const trace = apiContracts.traces.detail.output.parse(
      await (
        await getTrace(
          new Request(`http://local/api/v1/traces/${traceHealthy}`),
          routeContext("traceId", traceHealthy),
        )
      ).json(),
    );
    expect(trace.error).toBeNull();

    const scorecard = apiContracts.scorecard.detail.output.parse(
      await (await getScorecard(new Request("http://local/api/v1/scorecard"))).json(),
    );
    expect(scorecard.error).toBeNull();
  });

  it("logs and completes a session and stores a readiness check-in", async () => {
    const actual = [
      {
        exerciseId,
        sets: [{ completed: true, loadKg: 30, reps: 8, rpe: 7, setIndex: 1 }],
      },
    ];
    const loggedResponse = await logSession(
      jsonRequest(
        `/api/v1/sessions/${sessionHealthy}/log`,
        "POST",
        { actual, clientId: clientHealthy, expectedVersion: 1, notes: "Synthetic route test." },
        "session-log-001",
      ),
      routeContext("sessionId", sessionHealthy),
    );
    expect(loggedResponse.status).toBe(200);
    const logged = apiContracts.sessions.log.output.parse(await loggedResponse.json());
    expect(logged.error).toBeNull();
    if (logged.error !== null) throw new Error(logged.error.message);
    expect(logged.data.version).toBe(2);

    const completedResponse = await completeSession(
      jsonRequest(
        `/api/v1/sessions/${sessionHealthy}/complete`,
        "POST",
        {
          clientId: clientHealthy,
          expectedVersion: 2,
          performedAt: "2026-08-03T07:00:00.000Z",
          rpe: 7,
        },
        "session-complete-001",
      ),
      routeContext("sessionId", sessionHealthy),
    );
    expect(completedResponse.status).toBe(200);
    const completed = apiContracts.sessions.complete.output.parse(await completedResponse.json());
    expect(completed.error).toBeNull();

    const checkInRequest = jsonRequest(
      "/api/v1/check-ins",
      "POST",
      {
        body: "Synthetic readiness is steady.",
        clientId: clientHealthy,
        readiness: 5,
        respondedAt: "2026-08-03T08:00:00.000Z",
      },
      "check-in-replay-001",
    );
    const createdResponse = await createCheckIn(checkInRequest);
    expect(createdResponse.status).toBe(201);
    const created = apiContracts.checkIns.create.output.parse(await createdResponse.json());
    expect(created.error).toBeNull();
    if (created.error !== null) throw new Error(created.error.message);

    const replayedResponse = await createCheckIn(
      jsonRequest(
        "/api/v1/check-ins",
        "POST",
        {
          body: "Synthetic readiness is steady.",
          clientId: clientHealthy,
          readiness: 5,
          respondedAt: "2026-08-03T08:00:00.000Z",
        },
        "check-in-replay-001",
      ),
    );
    const replayed = apiContracts.checkIns.create.output.parse(await replayedResponse.json());
    expect(replayed.error).toBeNull();
    if (replayed.error !== null) throw new Error(replayed.error.message);
    expect(replayed.data.id).toBe(created.data.id);

    const conflict = await createCheckIn(
      jsonRequest(
        "/api/v1/check-ins",
        "POST",
        {
          body: "Different normalized input.",
          clientId: clientHealthy,
          readiness: 4,
          respondedAt: "2026-08-03T08:00:00.000Z",
        },
        "check-in-replay-001",
      ),
    );
    expect(conflict.status).toBe(409);
    const conflictEnvelope = apiContracts.checkIns.create.output.parse(await conflict.json());
    expect(conflictEnvelope.error?.code).toBe("idempotency_key_reused");
  });

  it("enforces programme review lifecycle while supporting generation and edits", async () => {
    const blocked = await approveProgramme(
      jsonRequest(
        `/api/v1/programmes/${programmeBlocked}/approve`,
        "POST",
        { expectedVersion: 1 },
        "programme-blocked-001",
      ),
      routeContext("programmeId", programmeBlocked),
    );
    expect(blocked.status).toBe(422);
    const blockedEnvelope = apiContracts.programmes.approve.output.parse(await blocked.json());
    expect(blockedEnvelope.error?.code).toBe("blocked_requires_override");

    const overridden = await overrideProgramme(
      jsonRequest(
        `/api/v1/programmes/${programmeBlocked}/override`,
        "POST",
        { expectedVersion: 1, reason: "Synthetic coach accepted the documented constraint." },
        "programme-override-001",
      ),
      routeContext("programmeId", programmeBlocked),
    );
    expect(overridden.status).toBe(200);
    expect(apiContracts.programmes.override.output.parse(await overridden.json()).error).toBeNull();

    const approved = await approveProgramme(
      jsonRequest(
        `/api/v1/programmes/${programmeSparse}/approve`,
        "POST",
        { expectedVersion: 1 },
        "programme-approve-001",
      ),
      routeContext("programmeId", programmeSparse),
    );
    expect(approved.status).toBe(200);
    expect(apiContracts.programmes.approve.output.parse(await approved.json()).error).toBeNull();

    const baseReview = apiContracts.programmes.detail.output.parse(
      await (
        await getProgramme(
          new Request(`http://local/api/v1/programmes/${programmeSparse}`),
          routeContext("programmeId", programmeSparse),
        )
      ).json(),
    );
    if (baseReview.error !== null) throw new Error(baseReview.error.message);
    const editedPayload: ProgrammePayload = {
      ...baseReview.data.programme.payload,
      summary: "Synthetic coach-edited programme summary.",
    };
    const editedResponse = await editProgramme(
      jsonRequest(
        `/api/v1/programmes/${programmeSparse}`,
        "PATCH",
        { expectedVersion: 1, payload: editedPayload, reason: "Synthetic review edit." },
        "programme-edit-001",
      ),
      routeContext("programmeId", programmeSparse),
    );
    expect(editedResponse.status).toBe(200);
    const edited = apiContracts.programmes.edit.output.parse(await editedResponse.json());
    expect(edited.error).toBeNull();
    if (edited.error !== null) throw new Error(edited.error.message);

    const rejected = await rejectProgramme(
      jsonRequest(
        `/api/v1/programmes/${edited.data.programme.id}/reject`,
        "POST",
        { expectedVersion: edited.data.programme.version, reason: "Synthetic replacement." },
        "programme-reject-001",
      ),
      routeContext("programmeId", edited.data.programme.id),
    );
    expect(rejected.status).toBe(200);
    expect(apiContracts.programmes.reject.output.parse(await rejected.json()).error).toBeNull();

    const generatedRequest = {
      clientId: clientHealthy,
      targetWeekStart: "2026-08-10",
    };
    const generatedResponse = await generateProgramme(
      jsonRequest(
        "/api/v1/programmes/generate",
        "POST",
        generatedRequest,
        "programme-generate-replay-001",
      ),
    );
    expect(generatedResponse.status).toBe(201);
    const generated = apiContracts.programmes.generate.output.parse(await generatedResponse.json());
    expect(generated.error).toBeNull();

    const replayedResponse = await generateProgramme(
      jsonRequest(
        "/api/v1/programmes/generate",
        "POST",
        generatedRequest,
        "programme-generate-replay-001",
      ),
    );
    const replayed = apiContracts.programmes.generate.output.parse(await replayedResponse.json());
    expect(replayed.error).toBeNull();
    if (generated.error !== null || replayed.error !== null) throw new Error("Generation failed");
    expect(replayed.data.programme.id).toBe(generated.data.programme.id);
  });

  it("generates, rejects, and applies adjustment proposals", async () => {
    const generatedResponse = await generateAdjustment(
      jsonRequest(
        "/api/v1/adjustments/generate",
        "POST",
        { clientId: clientAdjustment },
        "adjustment-generate-001",
      ),
    );
    expect(generatedResponse.status).toBe(201);
    const generated = apiContracts.adjustments.generate.output.parse(
      await generatedResponse.json(),
    );
    expect(generated.error).toBeNull();
    if (generated.error !== null) throw new Error(generated.error.message);

    const rejected = await rejectAdjustment(
      jsonRequest(
        `/api/v1/adjustments/${generated.data.id}/reject`,
        "POST",
        { expectedVersion: generated.data.version, reason: "Synthetic route coverage." },
        "adjustment-reject-001",
      ),
      routeContext("adjustmentId", generated.data.id),
    );
    expect(rejected.status).toBe(200);
    expect(apiContracts.adjustments.reject.output.parse(await rejected.json()).error).toBeNull();

    const editedResponse = await editAdjustment(
      jsonRequest(
        `/api/v1/adjustments/${adjustmentQueued}`,
        "PATCH",
        {
          expectedVersion: 1,
          operations: [
            {
              exerciseId,
              percent: 25,
              rationale: "Retain the synthetic session with less prescribed load.",
              type: "reduce_load",
            },
          ],
          reason: "Coach selected a smaller synthetic session.",
        },
        "adjustment-edit-001",
      ),
      routeContext("adjustmentId", adjustmentQueued),
    );
    expect(editedResponse.status).toBe(200);
    const edited = apiContracts.adjustments.edit.output.parse(await editedResponse.json());
    expect(edited.error).toBeNull();
    if (edited.error !== null) throw new Error(edited.error.message);
    expect(edited.data).toMatchObject({
      appliedProgrammeId: null,
      status: "queued",
      version: 2,
    });

    const applied = await approveAdjustment(
      jsonRequest(
        `/api/v1/adjustments/${adjustmentQueued}/approve`,
        "POST",
        { expectedVersion: edited.data.version, reason: "Synthetic readiness reduction." },
        "adjustment-approve-001",
      ),
      routeContext("adjustmentId", adjustmentQueued),
    );
    expect(applied.status).toBe(200);
    const appliedEnvelope = apiContracts.adjustments.approve.output.parse(await applied.json());
    expect(appliedEnvelope.error).toBeNull();
    if (appliedEnvelope.error !== null) throw new Error(appliedEnvelope.error.message);
    expect(appliedEnvelope.data.payload.days[0]?.exercises[0]).toMatchObject({
      loadKg: 30,
      rpe: 7,
      sets: 4,
    });
  });

  it("fails closed on blocked adjustment approval and publishes only by reasoned override", async () => {
    const blocked = await approveAdjustment(
      jsonRequest(
        `/api/v1/adjustments/${adjustmentBlocked}/approve`,
        "POST",
        { expectedVersion: 1, reason: "Ordinary approval must not bypass the band." },
        "adjustment-blocked-standard-001",
      ),
      routeContext("adjustmentId", adjustmentBlocked),
    );
    expect(blocked.status).toBe(422);
    expect(apiContracts.adjustments.approve.output.parse(await blocked.json()).error?.code).toBe(
      "blocked_requires_override",
    );

    const overrideRequest = jsonRequest(
      `/api/v1/adjustments/${adjustmentBlocked}/override`,
      "POST",
      { expectedVersion: 1, reason: "Coach accepts the documented blocked finding." },
      "adjustment-blocked-override-001",
    );
    const overridden = await overrideAdjustment(
      overrideRequest.clone(),
      routeContext("adjustmentId", adjustmentBlocked),
    );
    expect(overridden.status).toBe(200);
    const envelope = apiContracts.adjustments.override.output.parse(await overridden.json());
    expect(envelope.error).toBeNull();
    if (envelope.error !== null) throw new Error(envelope.error.message);
    expect(envelope.data.payload.days[0]?.exercises[0]).toMatchObject({
      loadKg: 40,
      rpe: 7,
      sets: 3,
    });

    const replayed = await overrideAdjustment(
      overrideRequest,
      routeContext("adjustmentId", adjustmentBlocked),
    );
    const replayedEnvelope = apiContracts.adjustments.override.output.parse(await replayed.json());
    expect(replayedEnvelope.error).toBeNull();
    if (replayedEnvelope.error !== null) throw new Error(replayedEnvelope.error.message);
    expect(replayedEnvelope.data.id).toBe(envelope.data.id);
  });

  it("runs accountability and both protected scheduled jobs", async () => {
    const accountabilityResponse = await runAccountability(
      jsonRequest(
        "/api/v1/accountability/run",
        "POST",
        { clientId: clientHealthy, effectiveAt: "2026-08-03T09:00:00.000Z" },
        "accountability-run-001",
      ),
    );
    expect(accountabilityResponse.status).toBe(200);
    const firstAccountability = apiContracts.accountability.run.output.parse(
      await accountabilityResponse.json(),
    );
    expect(firstAccountability.error).toBeNull();
    if (firstAccountability.error !== null) throw new Error(firstAccountability.error.message);
    expect(firstAccountability.data.state).toMatchObject({ owner: "automation", tier: 1 });
    expect(
      firstAccountability.data.messages.filter((message) => message.status === "sent"),
    ).toHaveLength(1);

    const replay = await runAccountability(
      jsonRequest(
        "/api/v1/accountability/run",
        "POST",
        { clientId: clientHealthy, effectiveAt: "2026-08-03T09:00:00.000Z" },
        "accountability-run-001",
      ),
    );
    const replayedAccountability = apiContracts.accountability.run.output.parse(
      await replay.json(),
    );
    expect(replayedAccountability.data).toEqual(firstAccountability.data);
    if (replayedAccountability.error !== null)
      throw new Error(replayedAccountability.error.message);
    expect(
      replayedAccountability.data.messages.filter((message) => message.status === "sent"),
    ).toHaveLength(1);

    const freshRetry = await runAccountability(
      jsonRequest(
        "/api/v1/accountability/run",
        "POST",
        { clientId: clientHealthy, effectiveAt: "2026-08-03T09:00:00.000Z" },
        "accountability-run-002",
      ),
    );
    const suppressedAccountability = apiContracts.accountability.run.output.parse(
      await freshRetry.json(),
    );
    expect(suppressedAccountability.error).toBeNull();
    if (suppressedAccountability.error !== null)
      throw new Error(suppressedAccountability.error.message);
    expect(
      suppressedAccountability.data.messages.filter((message) => message.status === "sent"),
    ).toHaveLength(1);
    expect(
      suppressedAccountability.data.messages.filter((message) => message.status === "suppressed"),
    ).toHaveLength(1);

    const weeklyResponse = await runWeeklyJob(
      jsonRequest(
        "/api/v1/jobs/weekly-plan",
        "POST",
        { runKey: "weekly-plan:2026-08-10", targetWeekStart: "2026-08-10" },
        "weekly-job-001",
      ),
    );
    expect(weeklyResponse.status).toBe(200);
    const weekly = apiContracts.jobs.weeklyPlan.output.parse(await weeklyResponse.json());
    expect(weekly.error).toBeNull();
    if (weekly.error !== null) throw new Error(weekly.error.message);
    expect(weekly.data.processed).toBe(7);

    const dailyResponse = await runDailyJob(
      jsonRequest(
        "/api/v1/jobs/daily-accountability",
        "POST",
        {
          effectiveAt: "2026-08-04T06:00:00.000Z",
          runKey: "daily-accountability:2026-08-04",
        },
        "daily-job-001",
      ),
    );
    expect(dailyResponse.status).toBe(200);
    const daily = apiContracts.jobs.dailyAccountability.output.parse(await dailyResponse.json());
    expect(daily.error).toBeNull();
    if (daily.error !== null) throw new Error(daily.error.message);
    expect(daily.data.processed).toBe(7);
  });

  it("rejects cron calls without the configured secret outside demo mode", async () => {
    process.env["APP_ENV"] = "production";
    try {
      const response = await runWeeklyJob(
        jsonRequest(
          "/api/v1/jobs/weekly-plan",
          "POST",
          { runKey: "weekly-plan:2026-08-17", targetWeekStart: "2026-08-17" },
          "weekly-job-unauthorized-001",
        ),
      );
      expect(response.status).toBe(401);
      const envelope = apiContracts.jobs.weeklyPlan.output.parse(await response.json());
      expect(envelope.error?.code).toBe("invalid_cron_secret");
      expect(JSON.stringify(envelope)).not.toContain(process.env["CRON_SECRET"]);
    } finally {
      process.env["APP_ENV"] = "demo";
    }
  });

  it("returns bounded validation failures for malformed path, query, and body input", async () => {
    const malformedPath = await getClient(
      new Request("http://local/api/v1/clients/not-a-uuid"),
      routeContext("clientId", "not-a-uuid"),
    );
    expect(malformedPath.status).toBe(400);
    const malformedEnvelope = apiContracts.clients.detail.output.parse(await malformedPath.json());
    expect(malformedEnvelope.error?.code).toBe("validation_failed");

    const extraQuery = await listClients(
      new Request("http://local/api/v1/clients?limit=10&coachId=spoofed"),
    );
    expect(extraQuery.status).toBe(400);

    const invalidBody = await createCheckIn(
      jsonRequest(
        "/api/v1/check-ins",
        "POST",
        {
          body: "Synthetic invalid readiness.",
          clientId: clientHealthy,
          readiness: 6,
          respondedAt: "not-an-instant",
          spoofedCoachId: "00000000-0000-4000-8000-000000000999",
        },
        "invalid-check-in-001",
      ),
    );
    expect(invalidBody.status).toBe(400);
    const invalidEnvelope = apiContracts.checkIns.create.output.parse(await invalidBody.json());
    expect(invalidEnvelope.error?.code).toBe("validation_failed");
    expect(JSON.stringify(invalidEnvelope).length).toBeLessThan(10_000);

    const missingIdempotency = await createCheckIn(
      new Request("http://local/api/v1/check-ins", {
        body: JSON.stringify({
          body: "Synthetic missing key.",
          clientId: clientHealthy,
          readiness: 5,
          respondedAt: "2026-08-03T08:00:00.000Z",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(missingIdempotency.status).toBe(400);

    const oversized = await createCheckIn(
      new Request("http://local/api/v1/check-ins", {
        body: JSON.stringify({ body: "synthetic", clientId: clientHealthy, readiness: 5 }),
        headers: {
          "content-length": "1000001",
          "content-type": "application/json",
          "idempotency-key": "oversized-check-in-001",
        },
        method: "POST",
      }),
    );
    expect(oversized.status).toBe(413);
    const oversizedEnvelope = apiContracts.checkIns.create.output.parse(await oversized.json());
    expect(oversizedEnvelope.error).toMatchObject({
      code: "validation_failed",
      message: "Request body exceeds the configured limit.",
    });
  });

  it("returns 404 for well-formed unknown resources", async () => {
    const unknownClient = "00000000-0000-4000-8000-999999999999";
    const response = await getClient(
      new Request(`http://local/api/v1/clients/${unknownClient}`),
      routeContext("clientId", unknownClient),
    );
    expect(response.status).toBe(404);
    const envelope = apiContracts.clients.detail.output.parse(await response.json());
    expect(envelope.error?.code).toBe("client_not_found");
  });

  it("keeps all list routes bounded and deterministic", async () => {
    const responses = await Promise.all([
      listClients(new Request("http://local/api/v1/clients?limit=1")),
      listProgrammes(new Request("http://local/api/v1/programmes?limit=1")),
      listSessions(new Request(`http://local/api/v1/sessions?clientId=${clientHealthy}&limit=1`)),
      listAdjustments(new Request("http://local/api/v1/adjustments?limit=1")),
    ]);
    const firstClientsResponse = responses[0];
    const firstClientPage = apiContracts.clients.list.output.parse(
      await firstClientsResponse.clone().json(),
    );
    const genericListEnvelope = apiResponseSchema(z.array(z.unknown()));
    const decoded = [];
    for (const response of responses) {
      expect(response.status).toBe(200);
      const body = genericListEnvelope.parse(await response.json());
      expect(body.error).toBeNull();
      if (body.error !== null) throw new Error(body.error.message);
      expect(body.data.length).toBeLessThanOrEqual(1);
      expect(body.meta.total).toBeGreaterThanOrEqual(body.data.length);
      decoded.push(body);
    }

    expect(decoded[0]?.meta).toMatchObject({ cursor: "v1:1", hasMore: true, total: 7 });
    const secondPage = apiContracts.clients.list.output.parse(
      await (
        await listClients(new Request("http://local/api/v1/clients?limit=1&cursor=v1%3A1"))
      ).json(),
    );
    expect(secondPage.error).toBeNull();
    if (firstClientPage.error !== null || secondPage.error !== null) {
      throw new Error("Client pagination failed");
    }
    expect(secondPage.data[0]?.id).not.toBe(firstClientPage.data[0]?.id);

    expect(clientConstrained).not.toBe(clientSparse);
  });
});
