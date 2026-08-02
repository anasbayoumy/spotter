import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptedMeasurementRecordPath,
  analyzeResourceRun,
  assertExactSourceState,
  assertStandardCorpus,
  assertWeeklyRunCorrect,
  baselineComparisons,
  canonicalJson,
  createAcceptedBaselineIndex,
  createAcceptedMeasurementRecord,
  createBaselineCandidate,
  finalPerformanceVerdict,
  sampleOperationContinuously,
  selectLighthouseDecidingRun,
  validateAcceptedBaseline,
} from "./evidence.mjs";

const validCorpus = {
  activeSyntheticClientIds: Array.from(
    { length: 50 },
    (_, index) => `00000000-0000-4000-8000-${String(101 + index).padStart(12, "0")}`,
  ),
  activeSyntheticClients: 50,
  bands: { attention: 17, blocked: 16, clear: 17 },
  clients: 50,
  coaches: 1,
  constraints: 50,
  evaluations: 50,
  historicalProgrammes: 550,
  minimumProgrammesPerClient: 13,
  minimumSessionsPerClient: 36,
  nonSyntheticClients: 0,
  notes: 100,
  programmes: 650,
  publishedProgrammes: 50,
  queuedClients: 50,
  queuedProgrammes: 50,
  runs: 50,
  sessionClients: 50,
  sessions: 1_800,
  totalClients: 50,
  totalProgrammes: 650,
  totalQueuedClients: 50,
  totalQueuedProgrammes: 50,
  totalSessions: 1_800,
  traces: 50,
};

test("requires the complete prefix-scoped standard corpus", () => {
  assert.equal(assertStandardCorpus(validCorpus), validCorpus);
  assert.equal(
    assertStandardCorpus({ ...validCorpus, bands: { clear: 17, attention: 17, blocked: 16 } })
      .clients,
    50,
  );
  assert.throws(
    () => assertStandardCorpus({ ...validCorpus, traces: 49 }),
    /traces=49, expected 50/u,
  );
  assert.throws(
    () => assertStandardCorpus({ ...validCorpus, minimumSessionsPerClient: 35 }),
    /minimumSessionsPerClient=35/u,
  );
  assert.throws(
    () => assertStandardCorpus({ ...validCorpus, totalQueuedProgrammes: 52 }),
    /totalQueuedProgrammes=52/u,
  );
});

test("selects one real Lighthouse run and retains all of its metrics", () => {
  const runs = [
    { accessibilityScore: 100, cls: 0.2, iteration: 1, lcpMs: 1_000, performanceScore: 99 },
    { accessibilityScore: 96, cls: 0.05, iteration: 2, lcpMs: 2_000, performanceScore: 92 },
    { accessibilityScore: 80, cls: 0.01, iteration: 3, lcpMs: 500, performanceScore: 70 },
  ];
  assert.equal(selectLighthouseDecidingRun(runs), runs[1]);
});

function snapshot(heap, rss, fileDescriptors, activeLibuvHandles) {
  const processes = [
    {
      activeLibuvHandles,
      command: "/nodejs/bin/node /app/docker/web-cluster.mjs",
      fileDescriptorCount: fileDescriptors,
      heapTotalBytes: heap,
      heapUsedBytes: heap,
      pid: 1,
      reportFile: "/tmp/spotter-process-report-primary-pid-1.json",
      reportSequence: 1,
      role: "primary",
      rssBytes: rss,
      slot: null,
    },
    {
      activeLibuvHandles: 0,
      command: "next-server (v16.2.12)",
      fileDescriptorCount: 0,
      heapTotalBytes: 0,
      heapUsedBytes: 0,
      pid: 11,
      reportFile: "/tmp/spotter-process-report-worker-1-pid-11.json",
      reportSequence: 2,
      role: "worker",
      rssBytes: 0,
      slot: 1,
    },
    {
      activeLibuvHandles: 0,
      command: "next-server (v16.2.12)",
      fileDescriptorCount: 0,
      heapTotalBytes: 0,
      heapUsedBytes: 0,
      pid: 12,
      reportFile: "/tmp/spotter-process-report-worker-2-pid-12.json",
      reportSequence: 3,
      role: "worker",
      rssBytes: 0,
      slot: 2,
    },
  ];
  return {
    activeLibuvHandles,
    expectedWorkerCount: 2,
    fileDescriptorCount: fileDescriptors,
    heapTotalBytes: heap,
    heapUsedBytes: heap,
    processCount: 3,
    processes,
    rssBytes: rss,
    state: { OOMKilled: false, Status: "running" },
    workerCount: 2,
  };
}

test("resource bounds reject large final growth even after a non-monotonic dip", () => {
  const mebibyte = 1024 * 1024;
  const evidence = analyzeResourceRun(
    [
      snapshot(100 * mebibyte, 200 * mebibyte, 20, 8),
      snapshot(99 * mebibyte, 199 * mebibyte, 19, 7),
      snapshot(110 * mebibyte, 220 * mebibyte, 22, 9),
      snapshot(125 * mebibyte, 240 * mebibyte, 25, 10),
      snapshot(140 * mebibyte, 270 * mebibyte, 35, 20),
      snapshot(150 * mebibyte, 280 * mebibyte, 100, 50),
    ],
    { webMemoryBytes: 256 * mebibyte },
  );
  assert.equal(evidence.bounded, false);
  assert.equal(evidence.heap.bounded, false);
  assert.equal(evidence.rss.bounded, false);
  assert.equal(evidence.fileDescriptors.bounded, false);
  assert.equal(evidence.activeLibuvHandles.bounded, false);
});

test("resource bounds reject transient peaks and absolute allocation exhaustion", () => {
  const mebibyte = 1024 * 1024;
  const evidence = analyzeResourceRun(
    [
      snapshot(40 * mebibyte, 80 * mebibyte, 20, 8),
      snapshot(190 * mebibyte, 240 * mebibyte, 600, 300),
      snapshot(42 * mebibyte, 82 * mebibyte, 21, 9),
    ],
    { webMemoryBytes: 256 * mebibyte },
  );
  assert.equal(evidence.bounded, false);
  assert.equal(evidence.heap.peak, 190 * mebibyte);
  assert.equal(evidence.fileDescriptors.bounded, false);
});

test("resource bounds require exact stable all-process cluster evidence", () => {
  const first = snapshot(40, 80, 20, 8);
  const missingWorker = {
    ...snapshot(42, 82, 21, 9),
    processCount: 2,
    processes: snapshot(42, 82, 21, 9).processes.slice(0, 2),
    workerCount: 1,
  };
  const missing = analyzeResourceRun([first, missingWorker], { webMemoryBytes: 1024 });
  assert.equal(missing.bounded, false);
  assert.equal(missing.processTopology.healthy, false);

  const changed = snapshot(42, 82, 21, 9);
  changed.processes[2].pid = 99;
  changed.processes[2].reportFile = "/tmp/spotter-process-report-worker-2-pid-99.json";
  const restarted = analyzeResourceRun([first, changed], { webMemoryBytes: 1024 });
  assert.equal(restarted.bounded, false);
  assert.match(restarted.processTopology.failures.join(" "), /identity changed/u);
});

test("continuous sampling retains a transient in-operation peak", async () => {
  let value = 1;
  const sampled = await sampleOperationContinuously(
    async () => {
      value = 100;
      await new Promise((resolve) => setTimeout(resolve, 8));
      value = 2;
      return "done";
    },
    (label) => Promise.resolve({ label, value }),
    { intervalMs: 2 },
  );
  assert.equal(sampled.result, "done");
  assert.equal(sampled.snapshots[0].value, 1);
  assert.equal(sampled.snapshots.at(-1).value, 2);
  assert.equal(
    sampled.snapshots.some((entry) => entry.value === 100),
    true,
  );
});

test("weekly correctness requires response, retry, job, programme, and idempotency evidence", () => {
  const run = {
    database: {
      completedClientIdempotencyRecords: 50,
      completedJobRuns: 1,
      jobAttempt: 1,
      jobRuns: 1,
      programmes: 50,
      programmesWithEvaluations: 50,
      recordedSuccessfulRuns: 50,
      traces: 50,
      weekCorrect: 50,
    },
    result: {
      failed: 0,
      processed: 50,
      runKey: "weekly-plan:2030-01-07",
      status: "completed",
      succeeded: 50,
    },
    stableRetry: true,
    weekStart: "2030-01-07",
  };
  assert.equal(assertWeeklyRunCorrect(run), true);
  assert.equal(
    assertWeeklyRunCorrect({ ...run, database: { ...run.database, programmes: 49 } }),
    false,
  );
});

const gates = [
  { actual: { p95Ms: 80 }, id: "NFR-PERF-001", passed: true },
  { actual: { p95Ms: 90 }, id: "NFR-PERF-002", passed: true },
  { actual: { p95Ms: 1_000 }, id: "NFR-PERF-003", passed: true },
  { actual: { durationMs: 20_000 }, id: "NFR-PERF-004", passed: true },
  { actual: { p95Ms: 100 }, id: "NFR-PERF-005", passed: true },
  { actual: { p95Ms: 20 }, id: "NFR-PERF-006", passed: true },
  { actual: {}, id: "NFR-PERF-007", passed: true },
  { actual: {}, id: "NFR-PERF-008", passed: true },
  { actual: {}, id: "NFR-PERF-009", passed: true },
];

const validEnvironment = {
  allocation: {
    cpuCount: 8,
    dockerMemoryBytes: 8 * 1024 ** 3,
    webCpuQuota: 2_000_000_000,
    webMemoryBytes: 1024 ** 3,
  },
  compose: "2.39.1",
  corpus: validCorpus,
  docker: { Server: { Arch: "arm64", Os: "linux", Version: "29.1.3" } },
  node: "v24.4.0",
  pnpm: "10.17.1",
  rateLimitProfile: {
    name: "load_test",
    noRequestHeaderBypass: true,
    qaIdentityBound: true,
  },
  webProcessTopology: {
    clustered: true,
    configuredWorkerCount: 2,
    observedWorkerCount: 2,
    primaryCount: 1,
    processCount: 3,
    workerSlots: [1, 2],
  },
};
const cleanSource = {
  contentHash: `sha256:${"d".repeat(64)}`,
  dirty: false,
  fileCount: 10,
  git: "e".repeat(40),
};
const releaseExecution = {
  attached: false,
  mode: "fresh-owned-release",
  ownsCompose: true,
  profile: "release",
  releaseEligible: true,
};

function baselineCandidate(environment = validEnvironment, source = cleanSource, options = {}) {
  return createBaselineCandidate(gates, environment, source, {
    execution: releaseExecution,
    sourceAfter: source,
    ...options,
  });
}

function acceptedBundle(environment = validEnvironment) {
  const candidate = baselineCandidate(environment);
  const record = createAcceptedMeasurementRecord(
    candidate,
    {
      acceptedAt: "2026-08-02T00:00:00.000Z",
      approvedBy: "release-owner",
      reason: "Reviewed first release measurement.",
    },
    {
      path: "artifacts/verification/release/performance-report.json",
      sha256: `sha256:${"a".repeat(64)}`,
    },
  );
  const recordPath = acceptedMeasurementRecordPath(record);
  const recordBytes = Buffer.from(canonicalJson(record));
  return {
    baseline: createAcceptedBaselineIndex(record, recordPath),
    candidate,
    record,
    recordBytes,
  };
}

test("rejects placeholders and compares only an intact canonical measured record", () => {
  assert.equal(validateAcceptedBaseline({ status: "accepted-v1-release-ceilings" }).valid, false);
  const bundle = acceptedBundle();
  assert.equal(
    validateAcceptedBaseline(bundle.baseline, {
      currentEnvironment: validEnvironment,
      recordBytes: bundle.recordBytes,
    }).valid,
    true,
  );
  assert.equal(
    baselineComparisons(gates, bundle.baseline, {
      currentEnvironment: validEnvironment,
      recordBytes: bundle.recordBytes,
    }).comparisons.every((entry) => entry.passed),
    true,
  );
});

test("rejects measurement-byte tampering and incompatible environment allocation", () => {
  const bundle = acceptedBundle();
  const tampered = Buffer.from(bundle.recordBytes);
  tampered[tampered.length - 2] = tampered[tampered.length - 2] === 32 ? 33 : 32;
  assert.match(
    validateAcceptedBaseline(bundle.baseline, { recordBytes: tampered }).reason,
    /hash mismatch/u,
  );
  const incompatible = {
    ...validEnvironment,
    allocation: { ...validEnvironment.allocation, webMemoryBytes: 512 * 1024 ** 2 },
  };
  assert.match(
    validateAcceptedBaseline(bundle.baseline, {
      currentEnvironment: incompatible,
      recordBytes: bundle.recordBytes,
    }).reason,
    /incompatible/u,
  );
  const wrongTopology = {
    ...validEnvironment,
    webProcessTopology: {
      ...validEnvironment.webProcessTopology,
      observedWorkerCount: 1,
      processCount: 2,
      workerSlots: [1],
    },
  };
  assert.equal(
    validateAcceptedBaseline(bundle.baseline, {
      currentEnvironment: wrongTopology,
      recordBytes: bundle.recordBytes,
    }).valid,
    false,
  );
});

test("creates an eligible candidate only from passing NFR-PERF-001 through 009", () => {
  const candidate = baselineCandidate();
  assert.equal(candidate.eligible, true);
  assert.equal(candidate.source.unchanged, true);
  assert.equal(candidate.metrics.readApiP95Ms, 80);
  assert.match(candidate.environmentSha256, /^sha256:[a-f0-9]{64}$/u);
});

test("requires exact clean before/after source and fresh-owned release execution", () => {
  const dirty = {
    contentHash: `sha256:${"d".repeat(64)}`,
    dirty: true,
    fileCount: 10,
    git: "e".repeat(40),
  };
  assert.equal(baselineCandidate(validEnvironment, dirty).eligible, false);

  const changed = { ...cleanSource, contentHash: `sha256:${"c".repeat(64)}` };
  assert.throws(
    () => baselineCandidate(validEnvironment, cleanSource, { sourceAfter: changed }),
    /changed during the measured run/u,
  );
  assert.throws(
    () => assertExactSourceState(cleanSource, { ...cleanSource, git: "f".repeat(40) }),
    /changed during the measured run/u,
  );

  const attachedSmoke = createBaselineCandidate(gates, validEnvironment, cleanSource, {
    execution: {
      attached: true,
      mode: "attached-smoke-non-release",
      ownsCompose: false,
      profile: "smoke",
      releaseEligible: false,
    },
    sourceAfter: cleanSource,
  });
  assert.equal(attachedSmoke.eligible, false);
  assert.equal(attachedSmoke.profile, "smoke");
});

test("cleanup errors force the final verdict to fail", () => {
  assert.equal(finalPerformanceVerdict("release", gates, []), "pass");
  assert.equal(finalPerformanceVerdict("smoke", gates, []), "focused-pass-not-release-evidence");
  assert.equal(finalPerformanceVerdict("release", gates, [{ message: "teardown" }]), "fail");
});
