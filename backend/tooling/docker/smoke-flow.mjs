import { performance } from "node:perf_hooks";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertOverridePersistence(evidence, expected) {
  assert(evidence.approvalKind === "override", "Blocked publication lost override evidence.");
  assert(evidence.auditAction === "overrode_block", "Blocked override audit action is missing.");
  assert(
    evidence.reason === expected.reason,
    "Blocked override audit reason changed or is missing.",
  );
  assert(
    evidence.requestId === expected.requestId,
    "Blocked override audit request ID changed or is missing.",
  );
}

export class RecordedHttpFlow {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/u, "");
    this.transcript = [];
  }

  async request(label, specification) {
    const startedAt = new Date();
    const started = performance.now();
    const response = await fetch(`${this.baseUrl}${specification.path}`, {
      body: specification.body === undefined ? undefined : JSON.stringify(specification.body),
      headers: {
        ...(specification.body === undefined ? {} : { "content-type": "application/json" }),
        ...specification.headers,
      },
      method: specification.method ?? "GET",
      signal: AbortSignal.timeout(specification.timeoutMs ?? 30_000),
    });
    const rawBody = await response.text();
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = rawBody;
    }
    const entry = {
      durationMs: performance.now() - started,
      finishedAt: new Date().toISOString(),
      label,
      method: specification.method ?? "GET",
      path: specification.path,
      requestId: response.headers.get("x-request-id"),
      response: body,
      startedAt: startedAt.toISOString(),
      status: response.status,
    };
    this.transcript.push(entry);
    if (!response.ok) {
      throw new Error(
        `${label} failed with HTTP ${String(response.status)}: ${rawBody.slice(0, 500)}`,
      );
    }
    if (specification.envelope !== false) {
      assert(body?.error === null, `${label} returned a non-null API error.`);
      assert(body?.meta?.requestId === entry.requestId, `${label} lost request-ID correlation.`);
      return body.data;
    }
    return body;
  }
}

function actualFromPlanned(planned) {
  return planned.map((exercise) => ({
    exerciseId: exercise.id,
    sets: Array.from({ length: Math.min(exercise.sets, 2) }, (_, index) => ({
      completed: true,
      loadKg: 20,
      reps: typeof exercise.reps === "number" ? exercise.reps : exercise.reps.min,
      rpe: exercise.rpe,
      setIndex: index + 1,
    })),
  }));
}

export async function runRequiredSmokeFlow(options) {
  const http = new RecordedHttpFlow(options.baseUrl);
  const c002 = "00000000-0000-4000-8000-000000000102";
  const c005 = "00000000-0000-4000-8000-000000000105";
  const blockedProgrammeId = "00000000-0000-4000-8000-000000000602";
  const overrideReason = "Synthetic QA override with explicit coach rationale.";
  const overrideRequestId = "docker-smoke-programme-override-v1";

  const clients = await http.request("list-synthetic-clients", {
    path: "/api/v1/clients?status=active&limit=25",
  });
  assert(
    clients.length === 7,
    `Clean demo list returned ${String(clients.length)} clients, expected 7.`,
  );
  assert(
    clients.every((client) => client.dataClassification === "synthetic"),
    "Client list leaked non-synthetic data.",
  );
  const detail = await http.request("fetch-client-detail", {
    path: `/api/v1/clients/${c005}`,
  });
  assert(detail.client.id === c005, "Client detail returned the wrong identity.");

  const generated = await http.request("generate-recorded-programme", {
    body: { clientId: c005, targetWeekStart: "2026-08-03" },
    headers: {
      "idempotency-key": "docker-smoke-programme-generate-v1",
      "x-request-id": "docker-smoke-programme-generate-v1",
    },
    method: "POST",
    path: "/api/v1/programmes/generate",
  });
  assert(generated.programme.status === "queued", "Recorded generation did not remain queued.");
  const ordering = await options.query(
    `SELECT jsonb_build_object(
      'traceCreatedAt', trace.created_at,
      'runCreatedAt', run.created_at,
      'tracePrecedesRun', trace.created_at <= run.created_at
    )
    FROM context_traces trace
    JOIN agent_runs run ON run.trace_id = trace.id
    WHERE trace.id = '${generated.traceId}';`,
    "smoke-trace-before-run",
  );
  const orderingEvidence = JSON.parse(ordering.stdout.trim());
  assert(
    orderingEvidence.tracePrecedesRun === true,
    "Context trace did not precede its agent run.",
  );

  const beforeApproval = await http.request("queued-draft-hidden-from-today", {
    path: `/api/v1/clients/${c005}/today`,
  });
  assert(beforeApproval.programme === null, "Queued draft leaked into client Today.");

  const blockedReview = await http.request("fetch-blocked-review", {
    path: `/api/v1/programmes/${blockedProgrammeId}`,
  });
  assert(blockedReview.programme.reviewBand === "blocked", "Blocked fixture changed review band.");
  const published = await http.request("reasoned-block-override", {
    body: { expectedVersion: 1, reason: overrideReason },
    headers: {
      "idempotency-key": overrideRequestId,
      "x-request-id": overrideRequestId,
    },
    method: "POST",
    path: `/api/v1/programmes/${blockedProgrammeId}/override`,
  });
  assert(published.status === "published", "Override did not publish the blocked fixture.");
  const persistedOverride = await options.query(
    `SELECT jsonb_build_object(
      'approvalKind', programme.approval_kind,
      'auditAction', action.action,
      'reason', action.reason,
      'requestId', action.request_id
    )
    FROM programmes programme
    JOIN LATERAL (
      SELECT coach_action.action, coach_action.reason, coach_action.request_id
      FROM coach_actions coach_action
      WHERE coach_action.programme_id = programme.id
      ORDER BY coach_action.created_at DESC, coach_action.id DESC
      LIMIT 1
    ) action ON true
    WHERE programme.id = '${blockedProgrammeId}';`,
    "smoke-override-persistence",
  );
  const overrideEvidence = JSON.parse(persistedOverride.stdout.trim());
  assertOverridePersistence(overrideEvidence, {
    reason: overrideReason,
    requestId: overrideRequestId,
  });

  const visible = await http.request("published-programme-visible-today", {
    path: `/api/v1/clients/${c002}/today`,
  });
  assert(visible.programme?.id === published.id, "Today did not expose the approved programme.");
  assert(
    visible.session !== null || visible.nextSession !== null,
    "Publication did not materialize a client-visible session.",
  );
  const current = await options.query(
    `SELECT jsonb_build_object(
      'currentProgrammes', count(DISTINCT programme.id),
      'sessions', count(session.id)
    )
    FROM programmes programme
    LEFT JOIN sessions session ON session.programme_id = programme.id
    WHERE programme.client_id = '${c002}'
      AND programme.status = 'published'
      AND programme.superseded_by IS NULL;`,
    "smoke-current-programme-count",
  );
  const currentEvidence = JSON.parse(current.stdout.trim());
  assert(currentEvidence.currentProgrammes === 1, "Client has more than one current programme.");
  assert(currentEvidence.sessions === 1, "Publication did not create exactly one logical session.");

  const session = visible.session ?? visible.nextSession;
  const logged = await http.request("idempotent-session-log", {
    body: {
      actual: actualFromPlanned(session.planned),
      clientId: c002,
      expectedVersion: session.version,
      notes: "Synthetic Docker smoke session.",
    },
    headers: {
      "idempotency-key": "docker-smoke-session-log-v1",
      "x-request-id": "docker-smoke-session-log-v1",
    },
    method: "POST",
    path: `/api/v1/sessions/${session.id}/log`,
  });
  const completed = await http.request("idempotent-session-complete", {
    body: {
      clientId: c002,
      expectedVersion: logged.version,
      performedAt: "2026-08-02T08:30:00.000Z",
      rpe: 9,
    },
    headers: {
      "idempotency-key": "docker-smoke-session-complete-v1",
      "x-request-id": "docker-smoke-session-complete-v1",
    },
    method: "POST",
    path: `/api/v1/sessions/${session.id}/complete`,
  });
  assert(completed.status === "completed", "Session did not complete.");
  const checkIn = await http.request("idempotent-check-in", {
    body: {
      body: "Synthetic low-readiness check-in for deterministic QA.",
      clientId: c002,
      readiness: 1,
      respondedAt: "2026-08-02T09:00:00.000Z",
    },
    headers: {
      "idempotency-key": "docker-smoke-check-in-v1",
      "x-request-id": "docker-smoke-check-in-v1",
    },
    method: "POST",
    path: "/api/v1/check-ins",
  });
  assert(checkIn.clientId === c002, "Check-in was attributed to the wrong client.");

  const adjustment = await http.request("generate-recorded-adjustment", {
    body: { clientId: c002 },
    headers: {
      "idempotency-key": "docker-smoke-adjustment-generate-v1",
      "x-request-id": "docker-smoke-adjustment-generate-v1",
    },
    method: "POST",
    path: "/api/v1/adjustments/generate",
  });
  assert(adjustment.status === "queued", "Adjustment bypassed coach review.");
  const afterAdjustment = await http.request("queued-adjustment-hidden-from-today", {
    path: `/api/v1/clients/${c002}/today`,
  });
  assert(
    afterAdjustment.programme?.id === published.id,
    "Queued adjustment changed client-visible programme.",
  );

  const accountabilitySpecification = {
    body: { clientId: c002, effectiveAt: "2026-08-02T10:00:00.000Z" },
    headers: {
      "idempotency-key": "docker-smoke-accountability-v1",
      "x-request-id": "docker-smoke-accountability-v1",
    },
    method: "POST",
    path: "/api/v1/accountability/run",
  };
  const accountabilityFirst = await http.request(
    "accountability-first",
    accountabilitySpecification,
  );
  const accountabilityRetry = await http.request(
    "accountability-stable-retry",
    accountabilitySpecification,
  );
  assert(
    JSON.stringify(accountabilityFirst) === JSON.stringify(accountabilityRetry),
    "Accountability retry changed logical score/state/message results.",
  );

  const [queuePage, reviewPage, tracePage, trace] = await Promise.all([
    http.request("navigate-queue", { envelope: false, path: "/queue" }),
    http.request("navigate-programme-review", {
      envelope: false,
      path: `/programmes/${generated.programme.id}`,
    }),
    http.request("navigate-trace", { envelope: false, path: `/traces/${generated.traceId}` }),
    http.request("fetch-selected-rendered-trace", {
      path: `/api/v1/traces/${generated.traceId}`,
    }),
  ]);
  assert(
    typeof queuePage === "string" || queuePage === null,
    "Queue navigation did not return a page.",
  );
  assert(
    typeof reviewPage === "string" || reviewPage === null,
    "Review navigation did not return a page.",
  );
  assert(
    typeof tracePage === "string" || tracePage === null,
    "Trace navigation did not return a page.",
  );
  assert(trace.id === generated.traceId, "Trace navigation selected the wrong trace.");
  assert(trace.rendered.length > 0, "Trace rendered context is empty.");
  assert(
    Array.isArray(trace.sections) && trace.sections.length > 0,
    "Trace selected context is empty.",
  );

  return {
    fixtures: {
      adjustmentId: adjustment.id,
      checkInId: checkIn.id,
      clientId: c002,
      generatedProgrammeId: generated.programme.id,
      publishedProgrammeId: published.id,
      sessionId: session.id,
      traceId: generated.traceId,
    },
    ordering: orderingEvidence,
    replaySpecifications: {
      accountability: accountabilitySpecification,
    },
    transcript: http.transcript,
  };
}
