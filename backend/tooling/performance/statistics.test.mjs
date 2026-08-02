import assert from "node:assert/strict";
import test from "node:test";

import {
  HttpLoadRunner,
  medianRun,
  percentile,
  summarize,
  summarizeByPath,
} from "./statistics.mjs";

test("uses nearest-rank percentiles and retains raw distribution bounds", () => {
  assert.equal(percentile([50, 10, 30, 20, 40], 0.5), 30);
  assert.equal(percentile([1, 2, 3, 4, 100], 0.95), 100);
  assert.deepEqual(summarize([4, 1, 3, 2]), {
    maximumMs: 4,
    meanMs: 2.5,
    minimumMs: 1,
    p50Ms: 2,
    p90Ms: 4,
    p95Ms: 4,
    p99Ms: 4,
    samples: 4,
  });
});

test("selects the median of exactly three release runs", () => {
  const runs = [{ p95Ms: 80 }, { p95Ms: 20 }, { p95Ms: 50 }];
  assert.deepEqual(
    medianRun(runs, (run) => run.p95Ms),
    { p95Ms: 50 },
  );
  assert.throws(() => medianRun(runs.slice(0, 2), (run) => run.p95Ms), /exactly three runs/u);
});

test("retains per-route latency and correctness distributions", () => {
  assert.deepEqual(
    summarizeByPath([
      { durationMs: 30, error: undefined, path: "/b", status: 200 },
      { durationMs: 10, error: undefined, path: "/a", status: 200 },
      {
        durationMs: 20,
        error: "invalid",
        path: "/a",
        status: 200,
        validationError: true,
      },
    ]),
    {
      "/a": {
        errorCount: 1,
        errorRate: 0.5,
        maximumMs: 20,
        meanMs: 15,
        minimumMs: 10,
        p50Ms: 10,
        p90Ms: 20,
        p95Ms: 20,
        p99Ms: 20,
        samples: 2,
        statusCounts: { 200: 2 },
        validationErrorCount: 1,
      },
      "/b": {
        errorCount: 0,
        errorRate: 0,
        maximumMs: 30,
        meanMs: 30,
        minimumMs: 30,
        p50Ms: 30,
        p90Ms: 30,
        p95Ms: 30,
        p99Ms: 30,
        samples: 1,
        statusCounts: { 200: 1 },
        validationErrorCount: 0,
      },
    },
  );
});

test("measures a finite concurrent request batch while retaining ordered results", async () => {
  const runner = new HttpLoadRunner("http://performance.invalid");
  runner.request = async (specification) => ({
    body: { path: specification.path },
    durationMs: Number(specification.path.slice(1)),
    error: undefined,
    requestId: null,
    status: 200,
  });
  const measured = await runner.batch({
    name: "finite-batch",
    specifications: [{ path: "/3" }, { path: "/1" }, { path: "/2" }],
    virtualUsers: 2,
  });
  assert.equal(measured.errorCount, 0);
  assert.equal(measured.p95Ms, 3);
  assert.deepEqual(
    measured.results.map((result) => result.body.path),
    ["/3", "/1", "/2"],
  );
  await assert.rejects(
    runner.batch({ name: "empty", specifications: [], virtualUsers: 1 }),
    /cannot be empty/u,
  );
});

test("counts business-validation failures as measured request errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: { clientId: "wrong" }, error: null, meta: {} }), {
      headers: { "content-type": "application/json", "x-request-id": "request-1" },
      status: 200,
    });
  try {
    const runner = new HttpLoadRunner("http://performance.invalid");
    const batch = await runner.batch({
      name: "validated",
      specifications: [
        {
          path: "/api/v1/clients/expected",
          validate: (result) => {
            if (result.body.data.clientId !== "expected") throw new Error("wrong client");
          },
        },
      ],
      virtualUsers: 1,
    });
    assert.equal(batch.errorCount, 1);
    assert.equal(batch.validationErrorCount, 1);
    assert.match(batch.errors[0].error, /wrong client/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
