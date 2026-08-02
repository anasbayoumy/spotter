function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stable(value) {
  return JSON.stringify(value);
}

export function assertComposeRuntimeHealth(services, expectedServices) {
  const expected = [...expectedServices].sort();
  const actual = services.map((service) => service.Service).sort();
  assert(
    stable(actual) === stable(expected),
    `Compose runtime services changed: ${stable({ actual, expected })}`,
  );
  for (const service of services) {
    assert(
      service.State === "running" && service.Health === "healthy",
      `Compose service is not running and healthy: ${stable({
        health: service.Health,
        service: service.Service,
        state: service.State,
      })}`,
    );
  }
  return { actual, expected };
}

export function assertRestartPersistence(options) {
  assert(
    stable(options.before) === stable(options.after),
    "Committed database state changed across web/PostgreSQL restarts.",
  );
  assert(
    stable(options.expectedReplay) === stable(options.actualReplay),
    "Post-restart idempotency replay changed the original logical response.",
  );
  assert(
    options.idempotencyRecords === 1,
    `Post-restart idempotency record count changed: ${String(options.idempotencyRecords)}.`,
  );
  return { idempotencyRecords: options.idempotencyRecords, stateStable: true };
}

export function separatePerformanceGateEvidence() {
  return {
    authority: "separate mandatory root test:performance gate",
    command: "corepack pnpm run test:performance",
    executedByDocker: false,
  };
}

export function assertEmptyDatabase(evidence) {
  assert(evidence.publicTables === 0, "Authoritative PostgreSQL did not start empty.");
  return evidence;
}

export function assertRunningBuiltImage(inspect, expectedImageId) {
  assert(
    typeof expectedImageId === "string" && expectedImageId.startsWith("sha256:"),
    "Freshly built web image ID is missing.",
  );
  assert(
    inspect?.Image === expectedImageId,
    `Running web container image differs from the fresh build: ${stable({
      built: expectedImageId,
      running: inspect?.Image,
    })}`,
  );
  return expectedImageId;
}

export function assertWebContainerHardening(inspect, identity, expectedImageId) {
  assertRunningBuiltImage(inspect, expectedImageId);
  const mounts = Array.isArray(inspect?.Mounts) ? inspect.Mounts : [];
  const writableMounts = mounts
    .filter((mount) => mount.RW !== false)
    .map((mount) => ({ destination: mount.Destination, type: mount.Type }));
  const writableTmpfs = Object.keys(inspect?.HostConfig?.Tmpfs ?? {}).sort();
  const evidence = {
    capAdd: inspect?.HostConfig?.CapAdd ?? [],
    capDrop: inspect?.HostConfig?.CapDrop ?? [],
    dockerSocketMounted: mounts.some(
      (mount) =>
        mount.Source === "/var/run/docker.sock" || mount.Destination === "/var/run/docker.sock",
    ),
    gid: identity.gid,
    privileged: inspect?.HostConfig?.Privileged,
    readOnlyRootFilesystem: inspect?.HostConfig?.ReadonlyRootfs,
    securityOptions: inspect?.HostConfig?.SecurityOpt ?? [],
    uid: identity.uid,
    user: inspect?.Config?.User,
    writableMounts,
    writableTmpfs,
  };
  assert(Number.isInteger(identity.uid) && identity.uid > 0, "Web container UID is not non-root.");
  assert(Number.isInteger(identity.gid) && identity.gid > 0, "Web container GID is not non-root.");
  assert(evidence.privileged === false, "Web container is privileged.");
  assert(!evidence.dockerSocketMounted, "Web container mounts the Docker socket.");
  assert(evidence.readOnlyRootFilesystem === true, "Web root filesystem is writable.");
  assert(evidence.capAdd.length === 0, "Web container adds Linux capabilities.");
  assert(evidence.capDrop.includes("ALL"), "Web container does not drop all capabilities.");
  assert(
    evidence.securityOptions.includes("no-new-privileges:true"),
    "Web container allows privilege escalation.",
  );
  assert(evidence.writableMounts.length === 0, "Web container has an unexpected writable mount.");
  assert(
    stable(evidence.writableTmpfs) === stable(["/tmp"]),
    "Web container writable tmpfs paths differ from /tmp only.",
  );
  return evidence;
}

export function assertSpdxSbom(document) {
  assert(
    typeof document?.spdxVersion === "string" && /^SPDX-2\.[0-9]+$/u.test(document.spdxVersion),
    "Image SBOM is not a supported SPDX JSON document.",
  );
  assert(typeof document.SPDXID === "string", "Image SBOM has no SPDX document ID.");
  assert(Array.isArray(document.packages) && document.packages.length > 0, "Image SBOM is empty.");
  return { packages: document.packages.length, spdxVersion: document.spdxVersion };
}

export function dockerScoutSbomArguments(imageId, outputFile) {
  assert(
    typeof imageId === "string" && /^sha256:[a-f0-9]{64}$/u.test(imageId),
    "Docker Scout SBOM requires an exact immutable image ID.",
  );
  assert(
    typeof outputFile === "string" && outputFile.length > 0,
    "Docker Scout SBOM output path is missing.",
  );
  return ["scout", "sbom", `local://${imageId}`, "--format", "spdx", "--output", outputFile];
}

export function parseDockerScoutVersion(output) {
  const text = String(output);
  const version = text.match(
    /^version:\s+(v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\s+\((go\d+\.\d+(?:\.\d+)?)\s+-\s+([a-z0-9]+\/[a-z0-9]+)\)$/imu,
  );
  const commit = text.match(/^git commit:\s+([a-f0-9]{7,64})$/imu);
  assert(version !== null && commit !== null, "Docker Scout version output is malformed.");
  return {
    commit: commit[1],
    go: version[2],
    platform: version[3],
    version: version[1],
  };
}

function assertPinnedScannerImage(scannerImage) {
  assert(
    typeof scannerImage === "string" && /@sha256:[a-f0-9]{64}$/u.test(scannerImage),
    "Image scanner is not pinned by immutable digest.",
  );
}

export function trivyVersionArguments(scannerImage) {
  assertPinnedScannerImage(scannerImage);
  return [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    scannerImage,
    "--version",
  ];
}

export function trivyImageScanArguments(options) {
  assertPinnedScannerImage(options.scannerImage);
  assert(
    typeof options.scanDirectory === "string" && options.scanDirectory.startsWith("/"),
    "Trivy scan directory must be absolute.",
  );
  assert(/^\d+:\d+$/u.test(options.user), "Trivy runtime user must be a numeric UID:GID.");
  return [
    "run",
    "--rm",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    options.user,
    "--mount",
    `type=bind,src=${options.scanDirectory},dst=/scan`,
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=512m",
    options.scannerImage,
    "--cache-dir",
    "/scan/cache",
    "image",
    "--input",
    "/scan/web-image.tar",
    "--scanners",
    "vuln",
    "--severity",
    "CRITICAL,HIGH",
    "--format",
    "sarif",
    "--output",
    "/scan/web-image.cves.sarif.json",
    "--exit-code",
    "2",
  ];
}

export function assertTrivySarif(document) {
  assert(Array.isArray(document?.runs) && document.runs.length > 0, "Trivy SARIF omitted runs.");
  let findings = 0;
  for (const run of document.runs) {
    assert(
      typeof run?.tool?.driver?.name === "string" && /trivy/iu.test(run.tool.driver.name),
      "SARIF run is not attributable to Trivy.",
    );
    assert(Array.isArray(run.results), "Trivy SARIF run omitted its results array.");
    findings += run.results.length;
  }
  return { findings, runs: document.runs.length };
}

const unsafeHttpText =
  /(?:postgres(?:ql)?:\/\/|\bSQLSTATE\b|\bE(?:CONNREFUSED|CONNRESET|HOSTUNREACH|PIPE|TIMEDOUT)\b|\bgetaddrinfo\s+E(?:AI_AGAIN|NOTFOUND)\b|connection (?:terminated|closed) unexpectedly|remaining connection slots|too many clients|provider\s+(?:body|response)|Bearer\s+[^\s"']+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\/Users\/|\/home\/|\/app\/[^\s"']+|\bstack\b\s*:)/iu;

export function assertSafeHttpProbe(entry, expectation) {
  assert(
    entry.status === expectation.status,
    `${entry.label} returned HTTP ${String(entry.status)}.`,
  );
  assert(
    typeof entry.requestId === "string" && entry.requestId.length > 0,
    `${entry.label} omitted its response request ID.`,
  );
  assert(
    entry.body?.meta?.requestId === entry.requestId,
    `${entry.label} lost request-ID correlation.`,
  );
  if (expectation.code !== undefined) {
    assert(
      entry.body?.error?.code === expectation.code,
      `${entry.label} returned the wrong error code.`,
    );
    assert(entry.body?.data === null, `${entry.label} returned data for an error response.`);
  }
  const serialized = stable(entry.body);
  assert(!unsafeHttpText.test(serialized), `${entry.label} exposed an internal dependency detail.`);
  for (const secret of expectation.secrets ?? []) {
    assert(!serialized.includes(secret), `${entry.label} exposed a configured probe secret.`);
  }
  return entry;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function junitDocument(options) {
  const failure =
    options.failure === undefined
      ? ""
      : `<failure message="${xmlEscape(options.failure)}">${xmlEscape(options.failure)}</failure>`;
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="${xmlEscape(options.suite)}" tests="1" failures="${options.failure === undefined ? "0" : "1"}"><testcase classname="${xmlEscape(options.suite)}" name="${xmlEscape(options.test)}">${failure}</testcase></testsuite>\n`;
}
