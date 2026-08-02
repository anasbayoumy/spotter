const checks = [
  {
    id: "crash-unhandled-rejection",
    pattern: /unhandled(?:\s+promise)?\s*rejection/iu,
  },
  { id: "crash-panic", pattern: /\bpanic\b/iu },
  { id: "crash-fatal", pattern: /\bfatal\b/iu },
  {
    id: "secret-private-key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
  { id: "secret-provider-credential", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/u },
  {
    id: "secret-authorization",
    pattern: /\bauthorization\b\s*[=:]\s*(?!["']?\[REDACTED\])["']?bearer\s+[^\s,"'}]+/iu,
  },
  {
    id: "database-connection-string",
    pattern: /postgres(?:ql)?:\/\/[^\s,"'}]+/iu,
  },
  {
    id: "database-raw-error",
    pattern:
      /(?:\bSQLSTATE\b|\bE(?:CONNREFUSED|CONNRESET|HOSTUNREACH|PIPE|TIMEDOUT)\b|\bgetaddrinfo\s+E(?:AI_AGAIN|NOTFOUND)\b|connection (?:terminated|closed) unexpectedly|remaining connection slots|too many clients|syntax error at or near|duplicate key value violates|(?:relation|column) ["'][^"']+["'] does not exist|violates (?:foreign key|unique|check|not-null) constraint)/iu,
  },
  {
    id: "provider-raw-response",
    pattern:
      /["']?provider(?:Response|Body)["']?\s*[=:]\s*(?!["']?\[REDACTED\])|\bprovider\b[^\r\n]{0,40}\b(?:raw body|raw response)\b/iu,
  },
  {
    id: "pii-email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  },
  {
    id: "pii-phone",
    pattern:
      /\+[1-9]\d{9,14}\b|["'](?:phone|mobile|telephone)["']\s*:\s*(?!["']?\[REDACTED\])["'][^"'\r\n]+/iu,
  },
  {
    id: "sensitive-free-text",
    pattern:
      /["'](?:checkInText|notes|prompt|responseBody)["']\s*:\s*(?!["']?\[REDACTED\]|null\b)["'][^"'\r\n]+/iu,
  },
  {
    id: "unexpected-warning-or-error",
    pattern: /["']level["']\s*:\s*(?:40|50|60)\b|(?:^|\s)(?:WARN(?:ING)?|ERROR)(?=\s|:|$)/iu,
  },
];

function expectedDependencyWarning(line, requestIds) {
  const start = line.indexOf("{");
  if (start < 0) return false;
  try {
    const record = JSON.parse(line.slice(start));
    return (
      record.level === 40 &&
      record.code === "dependency_unavailable" &&
      record.msg === "backend operation rejected" &&
      requestIds.has(record.requestId)
    );
  } catch {
    return false;
  }
}

const expectedPostgresProtocolMessages = [
  /initdb: warning: enabling "trust" authentication for local connections$/u,
  /ERROR:\s+new row for relation "programmes" violates check constraint "programmes_published_approval_ck"$/u,
  /ERROR:\s+context_traces is append-only$/u,
  /FATAL:\s+terminating connection due to administrator command$/u,
];

function expectedPostgresProtocolNoise(line) {
  if (!/^test-postgres-\d+\s+\|\s+/u.test(line)) return false;
  return expectedPostgresProtocolMessages.some((pattern) => pattern.test(line));
}

function expectedPostgresControlledRestart(lines, index) {
  const line = lines[index];
  const service = /^(test-postgres-\d+\s+\|\s+)/u.exec(line)?.[1];
  if (service === undefined || !/FATAL:\s+the database system is shutting down$/u.test(line)) {
    return false;
  }
  const belongsToService = (candidate) => candidate.startsWith(service);
  const before = lines.slice(Math.max(0, index - 10), index);
  const after = lines.slice(index + 1, index + 12);
  const completedInitialBootstrap = after.some(
    (candidate) =>
      belongsToService(candidate) &&
      /PostgreSQL init process complete; ready for start up\.$/u.test(candidate),
  );
  const completedPersistentRestart =
    after.some(
      (candidate) =>
        belongsToService(candidate) &&
        /PostgreSQL Database directory appears to contain a database; Skipping initialization$/u.test(
          candidate,
        ),
    ) &&
    after.some(
      (candidate) =>
        belongsToService(candidate) &&
        /LOG:\s+database system is ready to accept connections$/u.test(candidate),
    );
  return (
    before.some(
      (candidate) =>
        belongsToService(candidate) && /LOG:\s+received fast shutdown request$/u.test(candidate),
    ) &&
    after.some(
      (candidate) =>
        belongsToService(candidate) && /LOG:\s+database system is shut down$/u.test(candidate),
    ) &&
    (completedInitialBootstrap || completedPersistentRestart)
  );
}

export function scanRuntimeLogs(text, options = {}) {
  const findings = [];
  const expectedWarningRequestIds = new Set(options.expectedWarningRequestIds ?? []);
  const lines = String(text).split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    for (const check of checks) {
      if (check.pattern.test(line)) {
        if (
          ["crash-fatal", "database-raw-error", "unexpected-warning-or-error"].includes(check.id) &&
          (expectedPostgresProtocolNoise(line) || expectedPostgresControlledRestart(lines, index))
        ) {
          continue;
        }
        if (
          check.id === "unexpected-warning-or-error" &&
          expectedDependencyWarning(line, expectedWarningRequestIds)
        ) {
          continue;
        }
        findings.push({ id: check.id, line: index + 1 });
      }
    }
  }
  return findings;
}
