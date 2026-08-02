const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function assert(condition, message) {
  if (!condition) throw new Error(`Performance response contract failed: ${message}`);
}

function object(value, label) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} is not an object`,
  );
  return value;
}

function exactKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  assert(unexpected.length === 0, `${label} has unexpected keys: ${unexpected.join(",")}`);
}

function uuid(value, label) {
  assert(typeof value === "string" && uuidPattern.test(value), `${label} is not a UUID`);
}

function successfulData(result, expectedStatuses = [200]) {
  assert(
    expectedStatuses.includes(result.status),
    `status ${String(result.status)} is not expected`,
  );
  assert(result.error === undefined, `transport error ${String(result.error)}`);
  const envelope = object(result.body, "envelope");
  exactKeys(envelope, ["data", "error", "meta"], "envelope");
  assert(envelope.error === null, "envelope error is not null");
  assert(envelope.data !== null && envelope.data !== undefined, "envelope data is absent");
  const meta = object(envelope.meta, "envelope.meta");
  assert(typeof meta.requestId === "string" && meta.requestId.length > 0, "requestId is absent");
  assert(result.requestId === meta.requestId, "header and envelope request IDs differ");
  return envelope.data;
}

function programme(value, label) {
  const entry = object(value, label);
  uuid(entry.id, `${label}.id`);
  uuid(entry.clientId, `${label}.clientId`);
  uuid(entry.generatedBy, `${label}.generatedBy`);
  assert(
    ["draft", "queued", "published", "rejected", "superseded"].includes(entry.status),
    `${label}.status is invalid`,
  );
  assert(Number.isSafeInteger(entry.version) && entry.version > 0, `${label}.version is invalid`);
  const payload = object(entry.payload, `${label}.payload`);
  assert(
    typeof payload.summary === "string" && payload.summary.trim().length > 0,
    `${label}.summary is empty`,
  );
  assert(Array.isArray(payload.days) && payload.days.length > 0, `${label}.days is empty`);
  for (const [index, dayValue] of payload.days.entries()) {
    const day = object(dayValue, `${label}.days[${String(index)}]`);
    assert(/^\d{4}-\d{2}-\d{2}$/u.test(day.scheduledDate), `${label}.scheduledDate is invalid`);
    assert(Array.isArray(day.exercises) && day.exercises.length > 0, `${label}.exercises is empty`);
  }
  return entry;
}

function expectedClientIdFromRoute(route) {
  const match = /^\/api\/v1\/clients\/([0-9a-f-]+)(?:\/today)?$/iu.exec(route);
  return match?.[1];
}

function assertExactClientIdentities(ids, intendedClientIds, label) {
  const intended = new Set(intendedClientIds);
  const actual = new Set(ids);
  assert(
    intendedClientIds.length === 50 && intended.size === 50,
    "intended client ownership is not exactly 50 unique identities",
  );
  assert(ids.length === 50, `${label} contains ${String(ids.length)} rows instead of 50`);
  assert(actual.size === 50, `${label} does not contain 50 unique client identities`);
  assert(
    [...actual].every((id) => intended.has(id)),
    `${label} contains an unintended identity`,
  );
  assert(
    [...intended].every((id) => actual.has(id)),
    `${label} omits an intended identity`,
  );
}

export function responseFailureDiagnostic(result) {
  const data = result?.body?.data;
  let body = result?.body;
  if (Array.isArray(data)) {
    const clientIds = data
      .map((entry) => entry?.clientId)
      .filter((value) => typeof value === "string");
    const counts = new Map();
    for (const id of clientIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    body = {
      dataCount: data.length,
      duplicateClientIds: [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([id, count]) => ({ count, id })),
      firstIds: data
        .slice(0, 5)
        .map((entry) => entry?.id)
        .filter((value) => typeof value === "string"),
      statuses: [...new Set(data.map((entry) => entry?.status).filter(Boolean))],
      uniqueClientCount: new Set(clientIds).size,
    };
  }
  return {
    error: result?.error ?? "unknown response failure",
    requestId: result?.requestId,
    status: result?.status,
    body,
  };
}

export function assertReadResponse(result, route, intendedClientIds) {
  const data = successfulData(result);
  if (route.startsWith("/api/v1/clients?")) {
    assert(Array.isArray(data), "client list is not an array");
    const ids = data.map((entryValue, index) => {
      const entry = object(entryValue, `clients[${String(index)}]`);
      uuid(entry.id, `clients[${String(index)}].id`);
      assert(entry.status === "active", "client is not active");
      assert(entry.dataClassification === "synthetic", "client is not synthetic");
      return entry.id;
    });
    assertExactClientIdentities(ids, intendedClientIds, "client list");
    return data;
  }
  if (route.startsWith("/api/v1/programmes?")) {
    assert(Array.isArray(data), "queue is not an array");
    const clientIds = data.map((entry, index) => {
      const queued = programme(entry, `programmes[${String(index)}]`);
      assert(queued.status === "queued", `programmes[${String(index)}] is not queued`);
      return queued.clientId;
    });
    assertExactClientIdentities(clientIds, intendedClientIds, "queue");
    return data;
  }
  const clientId = expectedClientIdFromRoute(route);
  if (clientId !== undefined && route.endsWith("/today")) {
    const today = object(data, "today");
    assert(today.clientId === clientId, "today response belongs to a different client");
    assert(
      typeof today.timezone === "string" && today.timezone.length > 0,
      "today timezone is absent",
    );
    return data;
  }
  if (clientId !== undefined) {
    const detail = object(data, "client detail");
    assert(
      object(detail.client, "client detail.client").id === clientId,
      "detail belongs to a different client",
    );
    assert(Array.isArray(detail.sessions), "client sessions are absent");
    return data;
  }
  const programmeMatch = /^\/api\/v1\/programmes\/([0-9a-f-]+)$/iu.exec(route);
  if (programmeMatch !== null) {
    const review = object(data, "programme review");
    assert(
      programme(review.programme, "programme review.programme").id === programmeMatch[1],
      "review programme ID differs",
    );
    return data;
  }
  const traceMatch = /^\/api\/v1\/traces\/([0-9a-f-]+)$/iu.exec(route);
  if (traceMatch !== null) {
    const trace = object(data, "trace");
    assert(trace.id === traceMatch[1], "trace ID differs");
    assert(typeof trace.rendered === "string", "trace rendered context is absent");
    assert(
      Number.isSafeInteger(trace.tokenCount) && Number.isSafeInteger(trace.budget),
      "trace budget is invalid",
    );
    assert(trace.tokenCount <= trace.budget, "trace exceeds its budget");
    return data;
  }
  throw new Error(`Performance response contract failed: no validator for ${route}`);
}

export function assertProgrammeGenerationResponse(result, expected) {
  const review = object(successfulData(result, [200, 201]), "programme review");
  const generated = programme(review.programme, "programme review.programme");
  assert(generated.clientId === expected.clientId, "generated programme belongs to another client");
  assert(generated.status === "queued", "generated programme is not queued for coach review");
  assert(
    generated.payload.days[0].scheduledDate === expected.weekStart,
    "recorded output does not own the requested canonical week",
  );
  assert(
    typeof review.model === "string" && review.model.toLowerCase().includes("recorded"),
    "generation is not recorded-mode evidence",
  );
  uuid(review.traceId, "programme review.traceId");
  assert(
    Array.isArray(review.gates) && Array.isArray(review.judges),
    "evaluation evidence is absent",
  );
  return review;
}

export function assertWeeklyResponse(result, weekStart) {
  const summary = object(successfulData(result), "weekly summary");
  assert(
    summary.runKey === `weekly-plan:${weekStart}`,
    "weekly run key differs from requested week",
  );
  assert(summary.status === "completed", "weekly job did not complete");
  assert(
    summary.processed === 50 && summary.succeeded === 50 && summary.failed === 0,
    "weekly outcome is not exactly 50/50/0",
  );
  return summary;
}

export function assertMutationResponse(result, specification) {
  const data = successfulData(result, [200, 201]);
  if (specification.kind === "check-in") {
    assert(data.clientId === specification.body.clientId, "check-in client differs");
    assert(data.body === specification.body.body, "check-in body differs");
  } else if (specification.kind === "session-log") {
    assert(data.id === specification.expectedId, "logged session ID differs");
    assert(
      data.version === 2 && Array.isArray(data.actual),
      "session log did not persist actual work",
    );
  } else if (specification.kind === "programme-review") {
    assert(data.id === specification.expectedId, "rejected programme ID differs");
    assert(data.status === "rejected", "programme was not rejected");
  } else {
    throw new Error(
      `Performance response contract failed: unknown mutation ${String(specification.kind)}`,
    );
  }
  return data;
}
