import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDrainProof,
  runLiveDatabaseFaultProof,
  runLiveSecurityHttpProof,
} from "./live-project-proof.mjs";

function hardenedHeaders(requestId) {
  return {
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
    "permissions-policy": "camera=(), geolocation=(), microphone=()",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-request-id": requestId,
  };
}

function envelope(requestId, status, code, data = null) {
  return Response.json(
    {
      data,
      error: code === undefined ? null : { code, message: "Safe synthetic response." },
      meta: { requestId },
    },
    { headers: hardenedHeaders(requestId), status },
  );
}

test("accepts a correlated mutation that completes across the SIGTERM boundary", () => {
  const evidence = {
    outcome: {
      body: { data: { id: "synthetic" }, error: null, meta: { requestId: "drain-v1" } },
      connectedAt: 100,
      finishedAt: 300,
      requestId: "drain-v1",
      status: 201,
    },
    postStopRejected: true,
    postStopRejectedAt: 250,
    requestId: "drain-v1",
    stopStartedAt: 200,
  };
  assert.equal(assertDrainProof(evidence), evidence);
});

test("rejects work that did not drain or a server that still accepts requests", () => {
  const base = {
    outcome: {
      body: { data: null, error: null, meta: { requestId: "drain-v1" } },
      connectedAt: 100,
      finishedAt: 300,
      requestId: "drain-v1",
      status: 201,
    },
    postStopRejected: true,
    postStopRejectedAt: 250,
    requestId: "drain-v1",
    stopStartedAt: 200,
  };
  assert.throws(
    () => assertDrainProof({ ...base, outcome: { ...base.outcome, finishedAt: 150 } }),
    /overlap/u,
  );
  assert.throws(() => assertDrainProof({ ...base, postStopRejected: false }), /continued/u);
  assert.throws(
    () => assertDrainProof({ ...base, outcome: { ...base.outcome, status: 503 } }),
    /did not drain/u,
  );
});

test("executes the real-project security request matrix with correlated envelopes", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const requestId = init.headers["x-request-id"];
    requests.push({ init, url: url.toString() });
    if (url.pathname === "/api/v1/clients" && init.headers.origin === undefined) {
      return envelope(requestId, 200, undefined, [
        { dataClassification: "synthetic", id: "synthetic-client" },
      ]);
    }
    if (url.pathname === "/api/v1/clients") {
      return envelope(requestId, 403, "validation_failed");
    }
    if (url.pathname === "/api/v1/jobs/weekly-plan") {
      return envelope(requestId, 401, "invalid_cron_secret");
    }
    return envelope(requestId, 400, "validation_failed");
  };
  try {
    const proof = await runLiveSecurityHttpProof({ baseUrl: "http://127.0.0.1:3000" });
    assert.equal(proof.length, 6);
    assert.equal(requests.length, 6);
    assert.equal(requests.filter((request) => request.url.includes("cronSecret=")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proves live database failure and recovery while always restoring PostgreSQL", async () => {
  const originalFetch = globalThis.fetch;
  let databaseUp = true;
  const events = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const requestId = init.headers["x-request-id"];
    if (url.pathname === "/health/ready") {
      return Response.json(databaseUp ? { status: "ready" } : { status: "unavailable" }, {
        status: databaseUp ? 200 : 503,
      });
    }
    return envelope(
      requestId,
      databaseUp ? 200 : 503,
      databaseUp ? undefined : "dependency_unavailable",
      databaseUp ? [] : null,
    );
  };
  try {
    const proof = await runLiveDatabaseFaultProof({
      baseUrl: "http://127.0.0.1:3000",
      async startDatabase() {
        events.push("start");
        databaseUp = true;
      },
      async stopDatabase() {
        events.push("stop");
        databaseUp = false;
      },
      async waitForDatabase() {
        events.push("healthy");
      },
    });
    assert.deepEqual(events, ["stop", "start", "healthy"]);
    assert.equal(proof.recovered.status, 200);
    assert.ok(proof.transcript.some((entry) => entry.status === 503));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retains the database-fault transcript when dependency restoration fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const requestId = init.headers["x-request-id"];
    if (url.pathname === "/health/ready") {
      return Response.json({ status: "unavailable" }, { status: 503 });
    }
    return envelope(requestId, 503, "dependency_unavailable");
  };
  try {
    await assert.rejects(
      runLiveDatabaseFaultProof({
        baseUrl: "http://127.0.0.1:3000",
        async startDatabase() {
          throw new Error("database start failed");
        },
        async stopDatabase() {},
        async waitForDatabase() {},
      }),
      (error) => {
        assert.equal(error.message, "database start failed");
        assert.ok(error.evidence.transcript.some((entry) => entry.status === 503));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
