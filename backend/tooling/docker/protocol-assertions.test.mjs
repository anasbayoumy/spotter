import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertComposeRuntimeHealth,
  assertEmptyDatabase,
  assertRestartPersistence,
  assertRunningBuiltImage,
  assertSafeHttpProbe,
  assertSpdxSbom,
  assertTrivySarif,
  assertWebContainerHardening,
  dockerScoutSbomArguments,
  junitDocument,
  parseDockerScoutVersion,
  separatePerformanceGateEvidence,
  trivyImageScanArguments,
  trivyVersionArguments,
} from "./protocol-assertions.mjs";

test("links performance to the separate mandatory root gate without embedding it in Docker", async () => {
  assert.deepEqual(separatePerformanceGateEvidence(), {
    authority: "separate mandatory root test:performance gate",
    command: "corepack pnpm run test:performance",
    executedByDocker: false,
  });
  const dockerVerifier = await readFile(new URL("./verify.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(dockerVerifier, /backend\/tooling\/performance\/run\.mjs/u);
  assert.match(dockerVerifier, /separatePerformanceGateEvidence\(\)/u);
});

test("requires the exact running and healthy Compose runtime topology", () => {
  const healthy = [
    { Health: "healthy", Service: "web", State: "running" },
    { Health: "healthy", Service: "test-postgres", State: "running" },
  ];
  assert.doesNotThrow(() => assertComposeRuntimeHealth(healthy, ["test-postgres", "web"]));
  for (const changed of [
    healthy.slice(0, 1),
    healthy.map((entry) => (entry.Service === "web" ? { ...entry, State: "restarting" } : entry)),
    healthy.map((entry) => (entry.Service === "web" ? { ...entry, Health: "" } : entry)),
  ]) {
    assert.throws(
      () => assertComposeRuntimeHealth(changed, ["test-postgres", "web"]),
      /runtime services|running and healthy/u,
    );
  }
});

test("requires exhaustive restart state and the original idempotent response", () => {
  const snapshot = { coach_actions: { count: 1, hash: "a" }, programmes: { count: 2, hash: "b" } };
  assert.doesNotThrow(() =>
    assertRestartPersistence({
      actualReplay: { score: 2, tier: 1 },
      after: snapshot,
      before: snapshot,
      expectedReplay: { score: 2, tier: 1 },
      idempotencyRecords: 1,
    }),
  );
  assert.throws(
    () =>
      assertRestartPersistence({
        actualReplay: { score: 3 },
        after: { ...snapshot, coach_actions: { count: 0, hash: "x" } },
        before: snapshot,
        expectedReplay: { score: 2 },
        idempotencyRecords: 2,
      }),
    /database state/u,
  );
});

test("requires an empty database and the exact freshly built runtime image", () => {
  assert.deepEqual(assertEmptyDatabase({ publicTables: 0 }), { publicTables: 0 });
  assert.throws(() => assertEmptyDatabase({ publicTables: 1 }), /start empty/u);
  assert.equal(assertRunningBuiltImage({ Image: "sha256:fresh" }, "sha256:fresh"), "sha256:fresh");
  assert.throws(
    () => assertRunningBuiltImage({ Image: "sha256:stale" }, "sha256:fresh"),
    /differs from the fresh build/u,
  );
});

test("requires non-root identity and rejects every writable web mount", () => {
  const inspect = {
    Config: { User: "nonroot" },
    HostConfig: {
      CapAdd: null,
      CapDrop: ["ALL"],
      Privileged: false,
      ReadonlyRootfs: true,
      SecurityOpt: ["no-new-privileges:true"],
      Tmpfs: { "/tmp": "rw,noexec" },
    },
    Image: "sha256:fresh",
    Mounts: [],
  };
  assert.doesNotThrow(() =>
    assertWebContainerHardening(inspect, { gid: 65_532, uid: 65_532 }, "sha256:fresh"),
  );
  assert.throws(
    () =>
      assertWebContainerHardening(
        { ...inspect, Mounts: [{ Destination: "/data", RW: true, Type: "bind" }] },
        { gid: 65_532, uid: 65_532 },
        "sha256:fresh",
      ),
    /writable mount/u,
  );
  assert.throws(
    () => assertWebContainerHardening(inspect, { gid: 0, uid: 65_532 }, "sha256:fresh"),
    /GID/u,
  );
});

test("rejects empty or unattributed SBOM and SARIF evidence", () => {
  assert.deepEqual(
    assertSpdxSbom({
      packages: [{ name: "app" }],
      SPDXID: "SPDXRef-DOCUMENT",
      spdxVersion: "SPDX-2.3",
    }),
    { packages: 1, spdxVersion: "SPDX-2.3" },
  );
  assert.throws(
    () => assertSpdxSbom({ packages: [], SPDXID: "SPDXRef-DOCUMENT", spdxVersion: "SPDX-2.3" }),
    /empty/u,
  );
  assert.deepEqual(
    assertTrivySarif({ runs: [{ results: [], tool: { driver: { name: "Trivy" } } }] }),
    { findings: 0, runs: 1 },
  );
  assert.throws(() => assertTrivySarif({ runs: [] }), /omitted runs/u);
  assert.throws(
    () => assertTrivySarif({ runs: [{ results: [], tool: { driver: { name: "other" } } }] }),
    /not attributable/u,
  );
});

test("generates SBOM only from an exact local immutable image", () => {
  const image = `sha256:${"a".repeat(64)}`;
  assert.deepEqual(dockerScoutSbomArguments(image, "/evidence/image.spdx.json"), [
    "scout",
    "sbom",
    `local://${image}`,
    "--format",
    "spdx",
    "--output",
    "/evidence/image.spdx.json",
  ]);
  for (const changed of ["web:latest", "sha256:short", `registry://${image}`]) {
    assert.throws(
      () => dockerScoutSbomArguments(changed, "/evidence/image.spdx.json"),
      /exact immutable image/u,
    );
  }
  assert.throws(() => dockerScoutSbomArguments(image, ""), /output path/u);
});

test("normalizes the Docker Scout banner to bounded version facts", () => {
  const banner = [
    "decorative Docker Scout banner",
    "version: v1.18.3 (go1.24.6 - darwin/arm64)",
    "git commit: aa68fc25c596bea659d54867443238fd30218d23",
  ].join("\n");
  assert.deepEqual(parseDockerScoutVersion(banner), {
    commit: "aa68fc25c596bea659d54867443238fd30218d23",
    go: "go1.24.6",
    platform: "darwin/arm64",
    version: "v1.18.3",
  });
  for (const malformed of [
    "version: v1.18.3",
    "version: v1.18.3 (go1.24.6 - darwin/arm64)\ngit commit: not-a-hash",
  ]) {
    assert.throws(() => parseDockerScoutVersion(malformed), /version output is malformed/u);
  }
});

test("runs the pinned Trivy CLI with version proof and valid 0-or-2 scan semantics", () => {
  const scanner = `aquasec/trivy:0.67.2@sha256:${"b".repeat(64)}`;
  assert.deepEqual(trivyVersionArguments(scanner), [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    scanner,
    "--version",
  ]);
  const scan = trivyImageScanArguments({
    scanDirectory: "/tmp/exact-scan",
    scannerImage: scanner,
    user: "501:20",
  });
  assert.equal(scan.includes("--skip-version-check"), false);
  assert.deepEqual(scan.slice(-4), [
    "--output",
    "/scan/web-image.cves.sarif.json",
    "--exit-code",
    "2",
  ]);
  assert.ok(scan.includes("sarif"));
  assert.ok(scan.includes("CRITICAL,HIGH"));
  for (const changed of [
    { scanDirectory: "relative", scannerImage: scanner, user: "501:20" },
    { scanDirectory: "/tmp/exact-scan", scannerImage: "aquasec/trivy:latest", user: "501:20" },
    { scanDirectory: "/tmp/exact-scan", scannerImage: scanner, user: "root" },
  ]) {
    assert.throws(
      () => trivyImageScanArguments(changed),
      /immutable digest|absolute|numeric UID:GID/u,
    );
  }
});

test("requires correlated sanitized live HTTP failure evidence", () => {
  const safe = {
    body: {
      data: null,
      error: { code: "dependency_unavailable", message: "Service unavailable." },
      meta: { requestId: "live-fault-001" },
    },
    label: "database-fault",
    requestId: "live-fault-001",
    status: 503,
  };
  assert.doesNotThrow(() =>
    assertSafeHttpProbe(safe, { code: "dependency_unavailable", status: 503 }),
  );
  assert.throws(
    () =>
      assertSafeHttpProbe(
        {
          ...safe,
          body: {
            ...safe.body,
            error: { code: "dependency_unavailable", message: "SQLSTATE 42P01" },
          },
        },
        { code: "dependency_unavailable", status: 503 },
      ),
    /internal dependency detail/u,
  );
  assert.throws(
    () =>
      assertSafeHttpProbe(
        {
          ...safe,
          body: {
            ...safe.body,
            error: { code: "dependency_unavailable", message: "connect ECONNREFUSED db:5432" },
          },
        },
        { code: "dependency_unavailable", status: 503 },
      ),
    /internal dependency detail/u,
  );
});

test("renders one-case pass and escaped failure JUnit documents", () => {
  assert.match(
    junitDocument({ suite: "docker.migration", test: "empty-to-current" }),
    /tests="1" failures="0"/u,
  );
  const failed = junitDocument({
    failure: 'unsafe <failure> & "detail"',
    suite: "docker.migration",
    test: "empty-to-current",
  });
  assert.match(failed, /failures="1"/u);
  assert.match(failed, /unsafe &lt;failure&gt; &amp; &quot;detail&quot;/u);
});
