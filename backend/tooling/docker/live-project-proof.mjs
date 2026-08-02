import http from "node:http";

import { waitFor } from "./lib.mjs";
import { assertSafeHttpProbe } from "./protocol-assertions.mjs";

function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function recordHttpProbe(baseUrl, label, specification = {}) {
  const requestId = specification.requestId ?? `docker-${label}`;
  const serializedBody =
    specification.body === undefined
      ? undefined
      : typeof specification.body === "string"
        ? specification.body
        : JSON.stringify(specification.body);
  const startedAt = new Date();
  const response = await fetch(`${baseUrl.replace(/\/$/u, "")}${specification.path ?? "/"}`, {
    body: serializedBody,
    headers: {
      ...(serializedBody === undefined ? {} : { "content-type": "application/json" }),
      "x-request-id": requestId,
      ...specification.headers,
    },
    method: specification.method ?? "GET",
    signal: AbortSignal.timeout(specification.timeoutMs ?? 15_000),
  });
  const text = await response.text();
  return {
    body: parseBody(text),
    finishedAt: new Date().toISOString(),
    headers: {
      cacheControl: response.headers.get("cache-control"),
      contentSecurityPolicy: response.headers.get("content-security-policy"),
      permissionsPolicy: response.headers.get("permissions-policy"),
      referrerPolicy: response.headers.get("referrer-policy"),
      strictTransportSecurity: response.headers.get("strict-transport-security"),
      xContentTypeOptions: response.headers.get("x-content-type-options"),
      xFrameOptions: response.headers.get("x-frame-options"),
    },
    label,
    requestId: response.headers.get("x-request-id"),
    startedAt: startedAt.toISOString(),
    status: response.status,
  };
}

function assertSecurityHeaders(entry) {
  const headers = entry.headers;
  const contentSecurityPolicy = headers.contentSecurityPolicy ?? "";
  if (
    headers.cacheControl !== "no-store" ||
    !contentSecurityPolicy.includes("default-src 'self'") ||
    !contentSecurityPolicy.includes("base-uri 'self'") ||
    !contentSecurityPolicy.includes("frame-ancestors 'none'") ||
    !contentSecurityPolicy.includes("object-src 'none'") ||
    contentSecurityPolicy.includes("unsafe-eval") ||
    !headers.permissionsPolicy?.includes("camera=()") ||
    headers.referrerPolicy !== "no-referrer" ||
    !headers.strictTransportSecurity?.includes("max-age=31536000") ||
    headers.xContentTypeOptions !== "nosniff" ||
    headers.xFrameOptions !== "DENY"
  ) {
    throw new Error(`${entry.label} omitted required HTTP hardening headers.`);
  }
}

export async function runLiveSecurityHttpProof(options) {
  const probes = [];
  const execute = async (label, specification, expectation) => {
    const entry = await recordHttpProbe(options.baseUrl, label, specification);
    probes.push(entry);
    try {
      assertSafeHttpProbe(entry, expectation);
      assertSecurityHeaders(entry);
    } catch (error) {
      error.evidence = { probes };
      throw error;
    }
    return entry;
  };
  const list = await execute(
    "live-security-synthetic-list",
    { path: "/api/v1/clients?status=active&limit=1", requestId: "docker-live-security-list-v1" },
    { status: 200 },
  );
  if (
    !Array.isArray(list.body?.data) ||
    list.body.data.length !== 1 ||
    list.body.data[0]?.dataClassification !== "synthetic"
  ) {
    const error = new Error("Live no-auth production probe returned non-synthetic data.");
    error.evidence = { probes };
    throw error;
  }
  await execute(
    "live-security-cross-origin",
    {
      headers: { origin: "https://attacker.invalid" },
      path: "/api/v1/clients?status=active&limit=1",
      requestId: "docker-live-security-origin-v1",
    },
    { code: "validation_failed", status: 403 },
  );
  const jobBody = { runKey: "docker-security-weekly-v1", targetWeekStart: "2026-12-07" };
  await execute(
    "live-security-missing-cron-secret",
    {
      body: jobBody,
      headers: { "idempotency-key": "docker-live-security-missing-v1" },
      method: "POST",
      path: "/api/v1/jobs/weekly-plan",
      requestId: "docker-live-security-missing-v1",
    },
    { code: "invalid_cron_secret", status: 401 },
  );
  const wrongSecret = "docker-intentionally-wrong-cron-secret";
  await execute(
    "live-security-wrong-cron-secret",
    {
      body: jobBody,
      headers: {
        authorization: `Bearer ${wrongSecret}`,
        "idempotency-key": "docker-live-security-wrong-v1",
      },
      method: "POST",
      path: "/api/v1/jobs/weekly-plan",
      requestId: "docker-live-security-wrong-v1",
    },
    { code: "invalid_cron_secret", secrets: [wrongSecret], status: 401 },
  );
  await execute(
    "live-security-query-cron-secret",
    {
      body: jobBody,
      headers: { "idempotency-key": "docker-live-security-query-v1" },
      method: "POST",
      path: "/api/v1/jobs/weekly-plan?cronSecret=not-accepted",
      requestId: "docker-live-security-query-v1",
    },
    { code: "invalid_cron_secret", secrets: ["not-accepted"], status: 401 },
  );
  await execute(
    "live-security-dangerous-json-key",
    {
      body: '{"__proto__":{"polluted":true}}',
      headers: { "idempotency-key": "docker-live-security-json-v1" },
      method: "POST",
      path: "/api/v1/check-ins",
      requestId: "docker-live-security-json-v1",
    },
    { code: "validation_failed", status: 400 },
  );
  return probes;
}

export async function runLiveDatabaseFaultProof(options) {
  const transcript = [];
  let faultError;
  let recovered;
  let restorationError;
  let stopped = false;
  try {
    await options.stopDatabase();
    stopped = true;
    await waitFor(
      "live readiness failure after PostgreSQL stop",
      async () => {
        try {
          const entry = await recordHttpProbe(options.baseUrl, "live-db-fault-readiness", {
            path: "/health/ready",
            requestId: "docker-live-db-fault-readiness-v1",
            timeoutMs: 3_000,
          });
          transcript.push(entry);
          return entry.status === 503;
        } catch (error) {
          transcript.push({
            error: error instanceof Error ? error.message : String(error),
            label: "live-db-fault-readiness",
            status: 0,
          });
          return false;
        }
      },
      { timeoutMs: 60_000 },
    );
    const dependent = await recordHttpProbe(options.baseUrl, "live-db-fault-dependent-api", {
      path: "/api/v1/clients?status=active&limit=1",
      requestId: "docker-live-db-fault-v1",
      timeoutMs: 15_000,
    });
    transcript.push(dependent);
    assertSafeHttpProbe(dependent, {
      code: "dependency_unavailable",
      status: 503,
    });
  } catch (error) {
    faultError = error;
  } finally {
    if (stopped) {
      try {
        await options.startDatabase();
        await options.waitForDatabase();
      } catch (error) {
        restorationError = error;
      }
    }
  }
  if (restorationError === undefined && (faultError === undefined || stopped)) {
    try {
      recovered = await waitFor(
        "live readiness recovery after PostgreSQL start",
        async () => {
          try {
            const entry = await recordHttpProbe(options.baseUrl, "live-db-fault-recovery", {
              path: "/health/ready",
              requestId: "docker-live-db-recovery-v1",
              timeoutMs: 3_000,
            });
            transcript.push(entry);
            return entry.status === 200 ? entry : false;
          } catch (error) {
            transcript.push({
              error: error instanceof Error ? error.message : String(error),
              label: "live-db-fault-recovery",
              status: 0,
            });
            return false;
          }
        },
        { timeoutMs: 60_000 },
      );
    } catch (error) {
      faultError ??= error;
    }
  }
  faultError ??= restorationError;
  const evidence = {
    recovered,
    restorationFailure:
      restorationError instanceof Error
        ? { message: restorationError.message, name: restorationError.name }
        : restorationError === undefined
          ? null
          : { message: String(restorationError), name: "NonErrorThrown" },
    transcript,
  };
  if (faultError !== undefined) {
    faultError.evidence = evidence;
    throw faultError;
  }
  return evidence;
}

export function startDeferredJsonRequest(baseUrl, specification) {
  const url = new URL(specification.path, baseUrl);
  const body = JSON.stringify(specification.body);
  const split = Math.max(1, Math.floor(body.length / 2));
  let connectedAt;
  let finished = false;
  let resolveConnected;
  let rejectConnected;
  const connected = new Promise((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });
  let resolveOutcome;
  let rejectOutcome;
  const outcome = new Promise((resolve, reject) => {
    resolveOutcome = resolve;
    rejectOutcome = reject;
  });
  const request = http.request(
    url,
    {
      agent: false,
      headers: {
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json",
        "idempotency-key": specification.idempotencyKey,
        "x-request-id": specification.requestId,
      },
      method: specification.method ?? "POST",
    },
    (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.once("end", () => {
        finished = true;
        resolveOutcome({
          body: parseBody(Buffer.concat(chunks).toString("utf8")),
          connectedAt,
          finishedAt: Date.now(),
          requestId: response.headers["x-request-id"] ?? null,
          status: response.statusCode ?? 0,
        });
      });
    },
  );
  request.setTimeout(specification.timeoutMs ?? 30_000, () => {
    request.destroy(new Error("Deferred drain request timed out."));
  });
  request.once("socket", (socket) => {
    const markConnected = () => {
      connectedAt = Date.now();
      resolveConnected(connectedAt);
    };
    if (socket.connecting) socket.once("connect", markConnected);
    else markConnected();
  });
  request.once("error", (error) => {
    if (connectedAt === undefined) rejectConnected(error);
    if (!finished) rejectOutcome(error);
  });
  request.write(body.slice(0, split));
  return {
    connected,
    finish() {
      request.end(body.slice(split));
    },
    outcome,
  };
}

export function assertDrainProof(evidence) {
  if (
    evidence.outcome.status !== 201 ||
    evidence.outcome.requestId !== evidence.requestId ||
    evidence.outcome.body?.error !== null ||
    evidence.outcome.body?.meta?.requestId !== evidence.requestId
  ) {
    throw new Error("SIGTERM did not drain the accepted mutation successfully.");
  }
  if (
    !Number.isFinite(evidence.outcome.connectedAt) ||
    evidence.outcome.connectedAt > evidence.stopStartedAt ||
    !Number.isFinite(evidence.postStopRejectedAt) ||
    evidence.postStopRejectedAt < evidence.stopStartedAt ||
    evidence.outcome.finishedAt < evidence.postStopRejectedAt
  ) {
    throw new Error("Drain proof did not overlap the bounded SIGTERM window.");
  }
  if (evidence.postStopRejected !== true) {
    throw new Error("Stopped web service continued accepting new HTTP work.");
  }
  return evidence;
}
