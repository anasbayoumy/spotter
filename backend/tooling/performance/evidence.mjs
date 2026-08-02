import { createHash } from "node:crypto";

import { medianRun } from "./statistics.mjs";

export const baselineMetricNames = Object.freeze([
  "criticalDatabaseP95Ms",
  "mutationApiP95Ms",
  "queueApiP95Ms",
  "readApiP95Ms",
  "singlePlanP95Ms",
  "weeklyBatchDurationMs",
]);

const expectedCorpus = Object.freeze({
  bands: Object.freeze({ attention: 17, blocked: 16, clear: 17 }),
  activeSyntheticClients: 50,
  clients: 50,
  constraints: 50,
  evaluations: 50,
  historicalProgrammes: 550,
  minimumProgrammesPerClient: 13,
  minimumSessionsPerClient: 36,
  notes: 100,
  programmes: 650,
  publishedProgrammes: 50,
  queuedClients: 50,
  queuedProgrammes: 50,
  runs: 50,
  sessions: 1_800,
  sessionClients: 50,
  totalClients: 50,
  totalProgrammes: 650,
  totalQueuedClients: 50,
  totalQueuedProgrammes: 50,
  totalSessions: 1_800,
  traces: 50,
});

function sameJson(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key], right[key]))
  );
}

export function assertStandardCorpus(cardinalities) {
  const problems = [];
  for (const [key, expected] of Object.entries(expectedCorpus)) {
    if (key === "bands") continue;
    if (cardinalities[key] !== expected) {
      problems.push(`${key}=${String(cardinalities[key])}, expected ${String(expected)}`);
    }
  }
  if (cardinalities.coaches !== 1) {
    problems.push(`coaches=${String(cardinalities.coaches)}, expected 1`);
  }
  if (cardinalities.nonSyntheticClients !== 0) {
    problems.push(`nonSyntheticClients=${String(cardinalities.nonSyntheticClients)}, expected 0`);
  }
  if (!sameJson(cardinalities.bands, expectedCorpus.bands)) {
    problems.push(
      `bands=${JSON.stringify(cardinalities.bands)}, expected ${JSON.stringify(expectedCorpus.bands)}`,
    );
  }
  const expectedIds = Array.from(
    { length: 50 },
    (_, index) => `00000000-0000-4000-8000-${String(101 + index).padStart(12, "0")}`,
  );
  if (!sameJson(cardinalities.activeSyntheticClientIds, expectedIds)) {
    problems.push("global active synthetic client set is not exactly the intended 50 identities");
  }
  if (problems.length > 0) {
    throw new Error(`Standard performance corpus is invalid: ${problems.join("; ")}`);
  }
  return cardinalities;
}

export function selectLighthouseDecidingRun(runs) {
  return medianRun(runs, (run) => run.performanceScore);
}

function linearSlope(values) {
  const middle = (values.length - 1) / 2;
  let numerator = 0;
  let denominator = 0;
  for (const [index, value] of values.entries()) {
    const distance = index - middle;
    numerator += distance * value;
    denominator += distance * distance;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

export function analyzeResourceSeries(values, limits) {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Resource evidence requires at least two finite, non-negative samples.");
  }
  if (
    !Number.isFinite(limits.absoluteCeiling) ||
    !Number.isFinite(limits.growthCeiling) ||
    limits.absoluteCeiling <= 0 ||
    limits.growthCeiling < 0
  ) {
    throw new Error("Resource evidence requires finite positive allocation-derived ceilings.");
  }
  const initial = values[0];
  const finalGrowth = values.at(-1) - initial;
  const peak = Math.max(...values);
  const peakGrowth = peak - initial;
  const slopePerSample = linearSlope(values);
  const trendGrowth = Math.max(0, slopePerSample * (values.length - 1));
  return {
    absoluteCeiling: limits.absoluteCeiling,
    bounded:
      peak <= limits.absoluteCeiling &&
      finalGrowth <= limits.growthCeiling &&
      peakGrowth <= limits.growthCeiling &&
      trendGrowth <= limits.growthCeiling,
    finalGrowth,
    growthCeiling: limits.growthCeiling,
    initial,
    peak,
    peakGrowth,
    slopePerSample,
    trendGrowth,
    values,
  };
}

export function resourceCeilings(allocation) {
  const memoryBytes = allocation?.webMemoryBytes;
  if (!Number.isFinite(memoryBytes) || memoryBytes <= 0) {
    throw new Error("Resource analysis requires the web container memory allocation.");
  }
  return {
    activeLibuvHandles: { absoluteCeiling: 256, growthCeiling: 32 },
    fileDescriptors: { absoluteCeiling: 512, growthCeiling: 64 },
    heap: {
      absoluteCeiling: Math.floor(memoryBytes * 0.65),
      growthCeiling: Math.floor(memoryBytes * 0.1),
    },
    rss: {
      absoluteCeiling: Math.floor(memoryBytes * 0.85),
      growthCeiling: Math.floor(memoryBytes * 0.15),
    },
  };
}

export function analyzeClusterProcessTopology(snapshots) {
  const failures = [];
  const expectedWorkerCount = snapshots[0]?.expectedWorkerCount;
  let stableIdentity;
  for (const [snapshotIndex, snapshot] of snapshots.entries()) {
    const prefix = `snapshot ${String(snapshotIndex + 1)}`;
    if (
      !Number.isSafeInteger(snapshot.expectedWorkerCount) ||
      snapshot.expectedWorkerCount < 1 ||
      snapshot.expectedWorkerCount > 2 ||
      snapshot.expectedWorkerCount !== expectedWorkerCount
    ) {
      failures.push(`${prefix} has an invalid or changing expected worker count`);
      continue;
    }
    if (
      snapshot.workerCount !== snapshot.expectedWorkerCount ||
      snapshot.processCount !== snapshot.expectedWorkerCount + 1 ||
      !Array.isArray(snapshot.processes) ||
      snapshot.processes.length !== snapshot.processCount
    ) {
      failures.push(`${prefix} does not contain exactly one primary and every expected worker`);
      continue;
    }
    const primaries = snapshot.processes.filter((process) => process.role === "primary");
    const workers = snapshot.processes
      .filter((process) => process.role === "worker")
      .sort((left, right) => left.slot - right.slot);
    if (
      primaries.length !== 1 ||
      primaries[0].pid !== 1 ||
      workers.length !== snapshot.expectedWorkerCount ||
      primaries[0].slot !== null ||
      !/(?:^|\s)(?:\/app\/)?docker\/web-cluster\.mjs(?:\s|$)/u.test(primaries[0].command) ||
      workers.some(
        (worker, index) =>
          worker.slot !== index + 1 ||
          (!/(?:^|\s)(?:\/app\/)?docker\/spotter-worker\.mjs(?:\s|$)/u.test(worker.command) &&
            !/^next-server \(v\d+\.\d+\.\d+(?:-[^)]+)?\)$/u.test(worker.command)),
      )
    ) {
      failures.push(`${prefix} process roles, slots, or commands are invalid`);
      continue;
    }
    const pids = snapshot.processes.map((process) => process.pid);
    const files = snapshot.processes.map((process) => process.reportFile);
    if (
      pids.some((pid) => !Number.isSafeInteger(pid) || pid < 1) ||
      new Set(pids).size !== pids.length ||
      new Set(files).size !== files.length ||
      snapshot.processes.some((process, index) => process.reportSequence !== index + 1)
    ) {
      failures.push(`${prefix} process IDs or sequential report identities are invalid`);
      continue;
    }
    for (const field of [
      "activeLibuvHandles",
      "fileDescriptorCount",
      "heapTotalBytes",
      "heapUsedBytes",
      "rssBytes",
    ]) {
      const aggregate = snapshot.processes.reduce((total, process) => total + process[field], 0);
      if (!Number.isFinite(aggregate) || aggregate !== snapshot[field]) {
        failures.push(`${prefix} ${field} is not the exact all-process sum`);
      }
    }
    const identity = snapshot.processes
      .map((process) => `${process.role}:${String(process.slot)}:${String(process.pid)}`)
      .join("|");
    stableIdentity ??= identity;
    if (identity !== stableIdentity)
      failures.push(`${prefix} process identity changed during soak`);
  }
  return {
    expectedWorkerCount,
    failures,
    healthy: failures.length === 0,
    stableIdentity: stableIdentity ?? null,
  };
}

export function analyzeResourceRun(snapshots, allocation) {
  const ceilings = resourceCeilings(allocation);
  const processTopology = analyzeClusterProcessTopology(snapshots);
  const stateHealthy = snapshots.every(
    (snapshot) => snapshot.state.OOMKilled === false && snapshot.state.Status === "running",
  );
  const heap = analyzeResourceSeries(
    snapshots.map((snapshot) => snapshot.heapUsedBytes),
    ceilings.heap,
  );
  const rss = analyzeResourceSeries(
    snapshots.map((snapshot) => snapshot.rssBytes),
    ceilings.rss,
  );
  const fileDescriptors = analyzeResourceSeries(
    snapshots.map((snapshot) => snapshot.fileDescriptorCount),
    ceilings.fileDescriptors,
  );
  const activeLibuvHandles = analyzeResourceSeries(
    snapshots.map((snapshot) => snapshot.activeLibuvHandles),
    ceilings.activeLibuvHandles,
  );
  return {
    activeLibuvHandles,
    bounded:
      stateHealthy &&
      processTopology.healthy &&
      heap.bounded &&
      rss.bounded &&
      fileDescriptors.bounded &&
      activeLibuvHandles.bounded,
    fileDescriptors,
    heap,
    processTopology,
    rss,
    stateHealthy,
  };
}

export async function sampleOperationContinuously(operation, sample, options = {}) {
  const intervalMs = options.intervalMs ?? 1_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 10_000) {
    throw new Error("Resource sampling interval must be an integer from 1 through 10000 ms.");
  }
  const snapshots = [await sample("before")];
  const outcome = Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ kind: "fulfilled", value }),
      (error) => ({ error, kind: "rejected" }),
    );
  let sequence = 0;
  let settled;
  while (settled === undefined) {
    settled = await Promise.race([
      outcome,
      new Promise((resolve) => setTimeout(() => resolve(undefined), intervalMs)),
    ]);
    if (settled === undefined) {
      sequence += 1;
      try {
        snapshots.push(await sample(`during-${String(sequence)}`));
      } catch (samplingError) {
        settled = await outcome;
        if (settled.kind === "rejected") {
          throw new AggregateError(
            [samplingError, settled.error],
            "Resource sampling and measured operation both failed.",
          );
        }
        throw samplingError;
      }
    }
  }
  try {
    snapshots.push(await sample("after"));
  } catch (samplingError) {
    if (settled.kind === "rejected") {
      throw new AggregateError(
        [samplingError, settled.error],
        "Final resource sampling and measured operation both failed.",
      );
    }
    throw samplingError;
  }
  if (settled.kind === "rejected") throw settled.error;
  return { result: settled.value, snapshots };
}

export function assertWeeklyRunCorrect(run) {
  const correctResponse =
    run.result?.processed === 50 &&
    run.result?.succeeded === 50 &&
    run.result?.failed === 0 &&
    run.result?.status === "completed" &&
    run.result?.runKey === `weekly-plan:${run.weekStart}` &&
    run.stableRetry;
  const correctDatabase =
    run.database?.jobRuns === 1 &&
    run.database?.completedJobRuns === 1 &&
    run.database?.jobAttempt === 1 &&
    run.database?.programmes === 50 &&
    run.database?.programmesWithEvaluations === 50 &&
    run.database?.recordedSuccessfulRuns === 50 &&
    run.database?.traces === 50 &&
    run.database?.weekCorrect === 50 &&
    run.database?.completedClientIdempotencyRecords === 50;
  return correctResponse && correctDatabase;
}

function metricsFromGates(gates) {
  const byId = new Map(gates.map((entry) => [entry.id, entry]));
  return {
    criticalDatabaseP95Ms: byId.get("NFR-PERF-006")?.actual.p95Ms,
    mutationApiP95Ms: byId.get("NFR-PERF-002")?.actual.p95Ms,
    queueApiP95Ms: byId.get("NFR-PERF-005")?.actual.p95Ms,
    readApiP95Ms: byId.get("NFR-PERF-001")?.actual.p95Ms,
    singlePlanP95Ms: byId.get("NFR-PERF-003")?.actual.p95Ms,
    weeklyBatchDurationMs: byId.get("NFR-PERF-004")?.actual.durationMs,
  };
}

function validMetrics(metrics) {
  return (
    metrics !== null &&
    typeof metrics === "object" &&
    Object.keys(metrics).sort().join("\n") === [...baselineMetricNames].sort().join("\n") &&
    baselineMetricNames.every(
      (metric) => Number.isFinite(metrics[metric]) && Number(metrics[metric]) > 0,
    )
  );
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function compatibleVersion(value, parts, label) {
  const match = /^(?:v)?(\d+)\.(\d+)(?:\.(\d+))?/u.exec(String(value));
  if (match === null) throw new Error(`Cannot fingerprint ${label} version: ${String(value)}`);
  return match.slice(1, parts + 1).join(".");
}

export function compatibleEnvironment(environment) {
  const dockerServer = environment?.docker?.Server;
  const allocation = environment?.allocation;
  const topology = environment?.webProcessTopology;
  if (
    !Number.isFinite(allocation?.cpuCount) ||
    !Number.isFinite(allocation?.dockerMemoryBytes) ||
    !Number.isFinite(allocation?.webCpuQuota) ||
    !Number.isFinite(allocation?.webMemoryBytes) ||
    typeof dockerServer?.Arch !== "string" ||
    typeof dockerServer?.Os !== "string" ||
    topology?.clustered !== true ||
    !Number.isSafeInteger(topology?.configuredWorkerCount) ||
    topology.configuredWorkerCount < 1 ||
    topology.configuredWorkerCount > 2 ||
    topology?.observedWorkerCount !== topology.configuredWorkerCount ||
    topology?.primaryCount !== 1 ||
    topology?.processCount !== topology.configuredWorkerCount + 1 ||
    !Array.isArray(topology?.workerSlots) ||
    topology.workerSlots.length !== topology.configuredWorkerCount ||
    topology.workerSlots.some((slot, index) => slot !== index + 1)
  ) {
    throw new Error(
      "Performance environment is missing allocation, Docker identity, or exact web process topology.",
    );
  }
  return canonicalValue({
    allocation: {
      cpuCount: allocation.cpuCount,
      dockerMemoryBytes: allocation.dockerMemoryBytes,
      webCpuQuota: allocation.webCpuQuota,
      webMemoryBytes: allocation.webMemoryBytes,
    },
    composeMajorMinor: compatibleVersion(environment.compose, 2, "Compose"),
    corpus: environment.corpus,
    docker: {
      architecture: dockerServer.Arch,
      os: dockerServer.Os,
      serverMajorMinor: compatibleVersion(dockerServer.Version, 2, "Docker server"),
    },
    nodeMajor: compatibleVersion(environment.node, 1, "Node"),
    pnpmMajor: compatibleVersion(environment.pnpm, 1, "pnpm"),
    rateLimitProfile: environment.rateLimitProfile,
    schemaVersion: 1,
    webProcessTopology: topology,
  });
}

export function compatibleEnvironmentEvidence(environment) {
  const value = compatibleEnvironment(environment);
  return { sha256: sha256(canonicalJson(value)), value };
}

function normalizedSourceState(source, label) {
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(source?.contentHash ?? "") ||
    typeof source?.dirty !== "boolean" ||
    !Number.isSafeInteger(source?.fileCount) ||
    source.fileCount < 1 ||
    !/^[a-f0-9]{40}$/u.test(source?.git ?? "")
  ) {
    throw new Error(`${label} source state is malformed.`);
  }
  return canonicalValue({
    contentHash: source.contentHash,
    dirty: source.dirty,
    fileCount: source.fileCount,
    git: source.git,
  });
}

export function assertExactSourceState(before, after) {
  const normalizedBefore = normalizedSourceState(before, "Before-run");
  const normalizedAfter = normalizedSourceState(after, "After-run");
  if (!sameJson(normalizedBefore, normalizedAfter)) {
    throw new Error("Performance source state changed during the measured run.");
  }
  return canonicalValue({ after: normalizedAfter, before: normalizedBefore, unchanged: true });
}

const measurementPathPattern =
  /^DOCS\/release\/evidence\/performance-baseline\/measurement-[a-f0-9]{16}\.json$/u;

export function validateAcceptedBaseline(baseline, options = {}) {
  const genericReason =
    "No intact reviewed measured release baseline is installed. Promote a passing candidate before release.";
  try {
    if (
      baseline?.schemaVersion !== 3 ||
      baseline?.status !== "accepted-measured" ||
      baseline?.profile !== "release" ||
      baseline?.maximumRegressionFraction !== 0.1 ||
      !measurementPathPattern.test(baseline?.measurementRecord?.path ?? "") ||
      !/^sha256:[a-f0-9]{64}$/u.test(baseline?.measurementRecord?.sha256 ?? "") ||
      !(options.recordBytes instanceof Uint8Array || Buffer.isBuffer(options.recordBytes))
    ) {
      return { reason: genericReason, valid: false };
    }
    const bytes = Buffer.from(options.recordBytes);
    if (sha256(bytes) !== baseline.measurementRecord.sha256) {
      return { reason: "Accepted performance measurement record hash mismatch.", valid: false };
    }
    const record = JSON.parse(bytes.toString("utf8"));
    if (canonicalJson(record) !== bytes.toString("utf8")) {
      return { reason: "Accepted performance measurement record is not canonical.", valid: false };
    }
    const approval = record.approval;
    const measurement = record.measurement;
    const environment = record.environment;
    const structurallyValid =
      record.schemaVersion === 1 &&
      record.status === "accepted-measured" &&
      record.profile === "release" &&
      record.maximumRegressionFraction === baseline.maximumRegressionFraction &&
      validMetrics(record.metrics) &&
      typeof approval?.approvedBy === "string" &&
      approval.approvedBy.trim().length > 0 &&
      typeof approval?.reason === "string" &&
      approval.reason.trim().length > 0 &&
      new Date(approval?.acceptedAt).toISOString() === approval?.acceptedAt &&
      typeof measurement?.sourceReport === "string" &&
      measurement.sourceReport.startsWith("artifacts/verification/") &&
      /^sha256:[a-f0-9]{64}$/u.test(measurement?.sourceReportSha256 ?? "") &&
      measurement?.execution?.mode === "fresh-owned-release" &&
      measurement.execution?.releaseEligible === true &&
      measurement.execution?.ownsCompose === true &&
      measurement.execution?.attached === false &&
      measurement?.sourceState?.unchanged === true &&
      measurement.sourceState.before?.dirty === false &&
      sameJson(
        normalizedSourceState(measurement.sourceState.before, "Measured before-run"),
        normalizedSourceState(measurement.sourceState.after, "Measured after-run"),
      ) &&
      /^sha256:[a-f0-9]{64}$/u.test(environment?.sha256 ?? "") &&
      environment.sha256 === sha256(canonicalJson(environment.value));
    if (!structurallyValid) return { reason: genericReason, valid: false };
    if (options.currentEnvironment !== undefined) {
      const current = compatibleEnvironmentEvidence(options.currentEnvironment);
      if (current.sha256 !== environment.sha256 || !sameJson(current.value, environment.value)) {
        return {
          acceptedEnvironmentSha256: environment.sha256,
          currentEnvironmentSha256: current.sha256,
          reason: "Current performance environment is incompatible with the accepted baseline.",
          valid: false,
        };
      }
    }
    return { reason: null, record, valid: true };
  } catch {
    return { reason: genericReason, valid: false };
  }
}

export function baselineComparisons(gates, baseline, options = {}) {
  const validation = validateAcceptedBaseline(baseline, options);
  if (!validation.valid) return { comparisons: [], ...validation };
  const actual = metricsFromGates(gates);
  const comparisons = baselineMetricNames.map((metric) => {
    const accepted = validation.record.metrics[metric];
    const measured = actual[metric];
    const limit = accepted * (1 + validation.record.maximumRegressionFraction);
    return {
      accepted,
      actual: measured,
      limit,
      metric,
      passed: Number.isFinite(measured) && measured <= limit,
    };
  });
  return { comparisons, reason: null, valid: true };
}

export function createBaselineCandidate(gates, environment, sourceBefore, options) {
  const required = Array.from(
    { length: 9 },
    (_, index) => `NFR-PERF-${String(index + 1).padStart(3, "0")}`,
  );
  const byId = new Map(gates.map((entry) => [entry.id, entry]));
  const source = assertExactSourceState(sourceBefore, options?.sourceAfter);
  const execution = options?.execution;
  const eligible =
    execution?.releaseEligible === true &&
    execution.profile === "release" &&
    execution.mode === "fresh-owned-release" &&
    execution.ownsCompose === true &&
    execution.attached === false &&
    source.before.dirty === false &&
    required.every((id) => byId.get(id)?.passed === true);
  const environmentFingerprint = compatibleEnvironmentEvidence(environment);
  return {
    eligible,
    environment: environmentFingerprint.value,
    environmentSha256: environmentFingerprint.sha256,
    execution: canonicalValue(execution),
    metrics: metricsFromGates(gates),
    profile: execution?.profile,
    schemaVersion: 1,
    source,
  };
}

export function createAcceptedMeasurementRecord(candidate, approval, sourceReport) {
  if (
    candidate?.eligible !== true ||
    candidate?.profile !== "release" ||
    candidate?.execution?.mode !== "fresh-owned-release" ||
    candidate.execution?.releaseEligible !== true ||
    candidate.source?.unchanged !== true ||
    candidate.source.before?.dirty !== false ||
    !sameJson(candidate.source.before, candidate.source.after) ||
    !validMetrics(candidate.metrics) ||
    candidate.environmentSha256 !== sha256(canonicalJson(candidate.environment))
  ) {
    throw new Error("Only an eligible normalized release candidate can become a baseline.");
  }
  const acceptedAt = new Date(approval.acceptedAt).toISOString();
  if (
    acceptedAt !== approval.acceptedAt ||
    typeof approval.approvedBy !== "string" ||
    approval.approvedBy.trim().length === 0 ||
    typeof approval.reason !== "string" ||
    approval.reason.trim().length === 0 ||
    !sourceReport.path.startsWith("artifacts/verification/") ||
    !/^sha256:[a-f0-9]{64}$/u.test(sourceReport.sha256)
  ) {
    throw new Error("Baseline approval and source report provenance are invalid.");
  }
  return canonicalValue({
    approval: {
      acceptedAt,
      approvedBy: approval.approvedBy.trim(),
      reason: approval.reason.trim(),
    },
    environment: {
      sha256: candidate.environmentSha256,
      value: candidate.environment,
    },
    maximumRegressionFraction: 0.1,
    measurement: {
      execution: candidate.execution,
      sourceReport: sourceReport.path,
      sourceReportSha256: sourceReport.sha256,
      sourceState: candidate.source,
    },
    metrics: candidate.metrics,
    profile: "release",
    schemaVersion: 1,
    status: "accepted-measured",
  });
}

export function createAcceptedBaselineIndex(record, recordPath) {
  const bytes = Buffer.from(canonicalJson(record));
  if (!measurementPathPattern.test(recordPath)) {
    throw new Error("Baseline record must use the canonical immutable evidence path.");
  }
  return canonicalValue({
    maximumRegressionFraction: 0.1,
    measurementRecord: { path: recordPath, sha256: sha256(bytes) },
    profile: "release",
    schemaVersion: 3,
    status: "accepted-measured",
  });
}

export function acceptedMeasurementRecordPath(record) {
  const digest = sha256(Buffer.from(canonicalJson(record))).slice("sha256:".length, 16 + 7);
  return `DOCS/release/evidence/performance-baseline/measurement-${digest}.json`;
}

export function finalPerformanceVerdict(profile, gates, errors) {
  if (errors.length > 0 || !gates.every((entry) => entry.passed)) return "fail";
  return profile === "release" ? "pass" : "focused-pass-not-release-evidence";
}
