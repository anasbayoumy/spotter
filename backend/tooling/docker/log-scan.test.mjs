import assert from "node:assert/strict";
import test from "node:test";

import { scanRuntimeLogs } from "./log-scan.mjs";

test("accepts ordinary structured application and PostgreSQL lifecycle logs", () => {
  const logs = [
    'web-1 | {"level":30,"event":"backend_ready","syntheticOnly":true}',
    "test-postgres-1 | LOG: database system is ready to accept connections",
    "web-1 | Ready in 120ms",
  ].join("\n");
  assert.deepEqual(scanRuntimeLogs(logs), []);
});

test("reports crashes, unexpected warnings, and raw dependency internals", () => {
  const findings = scanRuntimeLogs(
    [
      'web-1 | {"level":40,"msg":"backend operation rejected"}',
      'web-1 | {"level":50,"providerResponse":"raw upstream output"}',
      "web-1 | ERROR: SQLSTATE 23505 duplicate key value violates unique constraint",
      "web-1 | connect ECONNREFUSED 172.18.0.2:5432",
      "web-1 | Unhandled Promise Rejection",
    ].join("\n"),
  );
  assert.deepEqual(
    new Set(findings.map((finding) => finding.id)),
    new Set([
      "unexpected-warning-or-error",
      "provider-raw-response",
      "database-raw-error",
      "crash-unhandled-rejection",
    ]),
  );
});

test("reports contact identity, credentials, and unredacted free text without retaining values", () => {
  const sensitive = [
    "person@example.com",
    "+15551234567",
    "postgresql://user:password@private-db/spotter",
    "authorization=Bearer secret-value",
    '"notes":"private health detail"',
  ];
  const findings = scanRuntimeLogs(sensitive.join("\n"));
  assert.deepEqual(
    new Set(findings.map((finding) => finding.id)),
    new Set([
      "pii-email",
      "pii-phone",
      "database-connection-string",
      "secret-authorization",
      "sensitive-free-text",
    ]),
  );
  assert.equal(
    Object.values(findings).some((finding) =>
      sensitive.some((value) => JSON.stringify(finding).includes(value)),
    ),
    false,
  );
});

test("allows explicitly redacted structured fields", () => {
  assert.deepEqual(
    scanRuntimeLogs(
      '{"level":30,"authorization":"[REDACTED]","notes":"[REDACTED]","providerResponse":"[REDACTED]"}',
    ),
    [],
  );
});

test("allows only an exact correlated dependency warning from an induced fault", () => {
  const expected =
    'web-1 | 2026-08-02T00:00:00Z {"level":40,"code":"dependency_unavailable","requestId":"docker-live-db-fault-v1","msg":"backend operation rejected"}';
  assert.deepEqual(
    scanRuntimeLogs(expected, { expectedWarningRequestIds: ["docker-live-db-fault-v1"] }),
    [],
  );
  for (const changed of [
    expected.replace('"level":40', '"level":50'),
    expected.replace('"code":"dependency_unavailable"', '"code":"internal_error"'),
    expected.replace("docker-live-db-fault-v1", "uncorrelated-request"),
  ]) {
    assert.deepEqual(
      scanRuntimeLogs(changed, { expectedWarningRequestIds: ["docker-live-db-fault-v1"] }),
      [{ id: "unexpected-warning-or-error", line: 1 }],
    );
  }
});

test("allows only exact PostgreSQL noise induced by the Docker protocol", () => {
  const expected = [
    'test-postgres-1 | 2026-08-02T00:00:00Z initdb: warning: enabling "trust" authentication for local connections',
    'test-postgres-1 | 2026-08-02T00:00:01Z ERROR:  new row for relation "programmes" violates check constraint "programmes_published_approval_ck"',
    "test-postgres-1 | 2026-08-02T00:00:02Z ERROR:  context_traces is append-only",
    "test-postgres-1 | 2026-08-02T00:00:03Z FATAL:  terminating connection due to administrator command",
  ];
  assert.deepEqual(scanRuntimeLogs(expected.join("\n")), []);

  const altered = [
    expected[0].replace("test-postgres-1", "web-1"),
    expected[1].replace("programmes_published_approval_ck", "unexpected_constraint"),
    expected[2].replace("context_traces", "messages"),
    expected[3].replace("administrator command", "unexpected corruption"),
  ];
  assert.deepEqual(scanRuntimeLogs(altered.join("\n")), [
    { id: "unexpected-warning-or-error", line: 1 },
    { id: "database-raw-error", line: 2 },
    { id: "unexpected-warning-or-error", line: 2 },
    { id: "unexpected-warning-or-error", line: 3 },
    { id: "crash-fatal", line: 4 },
  ]);
});
