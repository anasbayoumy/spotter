import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMutationResponse,
  assertProgrammeGenerationResponse,
  assertReadResponse,
  assertWeeklyResponse,
  responseFailureDiagnostic,
} from "./contracts.mjs";

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const result = (data, status = 200) => ({
  body: { data, error: null, meta: { requestId: "request-1" } },
  durationMs: 1,
  requestId: "request-1",
  status,
});
const programme = (clientId = id(101), weekStart = "2026-08-03", programmeId = id(801)) => ({
  approvedAt: null,
  approvedBy: null,
  clientId,
  createdAt: "2026-08-02T00:00:00.000Z",
  generatedBy: id(901),
  id: programmeId,
  mesocycle: 1,
  payload: {
    days: [{ dayIndex: 1, exercises: [{ id: id(301) }], scheduledDate: weekStart }],
    summary: "Synthetic plan",
  },
  reviewBand: "clear",
  status: "queued",
  supersededBy: null,
  validFrom: null,
  version: 1,
  week: 1,
});

test("validates client/read ownership and rejects successful-but-wrong business data", () => {
  const clients = Array.from({ length: 50 }, (_, index) => id(101 + index));
  const body = clients.map((clientId) => ({
    dataClassification: "synthetic",
    id: clientId,
    status: "active",
  }));
  assert.equal(assertReadResponse(result(body), "/api/v1/clients?status=active", clients), body);
  assert.throws(
    () =>
      assertReadResponse(
        result([{ ...body[0], status: "paused" }]),
        "/api/v1/clients?status=active",
        clients,
      ),
    /not active/u,
  );
  const duplicate = [...body.slice(0, 49), body[0]];
  assert.throws(
    () => assertReadResponse(result(duplicate), "/api/v1/clients?status=active", clients),
    /50 unique client identities/u,
  );
});

test("requires exactly fifty queued rows with one unique intended client each", () => {
  const clients = Array.from({ length: 50 }, (_, index) => id(101 + index));
  const queue = clients.map((clientId, index) =>
    programme(clientId, "2026-08-03", id(801 + index)),
  );
  assert.equal(
    assertReadResponse(result(queue), "/api/v1/programmes?status=queued&limit=100", clients),
    queue,
  );
  assert.throws(
    () =>
      assertReadResponse(
        result([...queue, programme(id(101), "2026-08-03", id(999))]),
        "/api/v1/programmes?status=queued&limit=100",
        clients,
      ),
    /51 rows instead of 50/u,
  );
  assert.throws(
    () =>
      assertReadResponse(
        result([...queue.slice(0, 49), { ...queue[49], clientId: id(101) }]),
        "/api/v1/programmes?status=queued&limit=100",
        clients,
      ),
    /50 unique client identities/u,
  );
  assert.throws(
    () =>
      assertReadResponse(
        result([{ ...queue[0], status: "draft" }, ...queue.slice(1)]),
        "/api/v1/programmes?status=queued&limit=100",
        clients,
      ),
    /is not queued/u,
  );
});

test("summarizes oversized response failures with the reason and duplicate ownership first", () => {
  const duplicate = Array.from({ length: 52 }, (_, index) =>
    programme(id(101 + (index % 50)), "2026-08-03", id(801 + index)),
  );
  const diagnostic = responseFailureDiagnostic({
    ...result(duplicate),
    error: "queue contains 52 rows instead of 50",
  });
  assert.equal(diagnostic.error, "queue contains 52 rows instead of 50");
  assert.equal(diagnostic.body.dataCount, 52);
  assert.equal(diagnostic.body.uniqueClientCount, 50);
  assert.deepEqual(diagnostic.body.duplicateClientIds, [
    { count: 2, id: id(101) },
    { count: 2, id: id(102) },
  ]);
  assert.ok(JSON.stringify(diagnostic).indexOf("queue contains") < 100);
});

test("binds recorded generation to the requested canonical week and client", () => {
  const review = {
    citations: [],
    gates: [],
    judges: [],
    model: "spotter-recorded-generator-v1",
    programme: programme(),
    promptVersion: "v1",
    traceId: id(701),
  };
  assert.equal(
    assertProgrammeGenerationResponse(result(review, 201), {
      clientId: id(101),
      weekStart: "2026-08-03",
    }),
    review,
  );
  assert.throws(
    () =>
      assertProgrammeGenerationResponse(result(review, 201), {
        clientId: id(101),
        weekStart: "2026-08-10",
      }),
    /canonical week/u,
  );
});

test("checks weekly and mutation business outcomes instead of status alone", () => {
  const weekly = {
    failed: 0,
    processed: 50,
    runKey: "weekly-plan:2026-08-03",
    status: "completed",
    succeeded: 50,
  };
  assert.equal(assertWeeklyResponse(result(weekly), "2026-08-03"), weekly);
  assert.throws(
    () => assertWeeklyResponse(result({ ...weekly, succeeded: 49 }), "2026-08-03"),
    /50\/50\/0/u,
  );
  const mutation = { body: "marker", clientId: id(101) };
  assert.equal(
    assertMutationResponse(result(mutation, 201), {
      body: mutation,
      kind: "check-in",
    }),
    mutation,
  );
  assert.throws(
    () =>
      assertMutationResponse(result({ ...mutation, clientId: id(102) }, 201), {
        body: mutation,
        kind: "check-in",
      }),
    /client differs/u,
  );
});

test("rejects malformed envelopes and mismatched request IDs", () => {
  const malformed = result([]);
  malformed.body.extra = true;
  assert.throws(
    () => assertReadResponse(malformed, "/api/v1/clients?status=active", []),
    /unexpected keys/u,
  );
  const mismatch = result([]);
  mismatch.requestId = "request-2";
  assert.throws(
    () => assertReadResponse(mismatch, "/api/v1/clients?status=active", []),
    /request IDs differ/u,
  );
});
