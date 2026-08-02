import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { chromium } from "@playwright/test";

import {
  ComposeProject,
  EvidenceCommandRunner,
  assertQaProject,
  createQaIdentity,
  resolveEvidenceDirectory,
  serializeError,
  waitFor,
  writeJson,
} from "../docker/lib.mjs";
import { sourceState } from "../verification/evidence-common.mjs";
import {
  analyzeResourceRun,
  assertExactSourceState,
  assertStandardCorpus,
  assertWeeklyRunCorrect,
  baselineComparisons,
  createBaselineCandidate,
  finalPerformanceVerdict,
  sampleOperationContinuously,
  selectLighthouseDecidingRun,
} from "./evidence.mjs";
import { assertCleanReleaseSource, resolvePerformanceExecution } from "./execution-policy.mjs";
import {
  assertMutationResponse,
  assertProgrammeGenerationResponse,
  assertReadResponse,
  assertWeeklyResponse,
  responseFailureDiagnostic,
} from "./contracts.mjs";
import {
  assertExactActiveSyntheticClientSet,
  assertMutationContractFixture,
  createMutationContractFixture,
  intendedPerformanceClientIds,
  performanceClientId,
  recordedWeekStart,
} from "./fixtures.mjs";
import { runLighthouseMatrix, startExpoWebServer } from "./lighthouse.mjs";
import {
  CleanupOwnershipLease,
  assertExactClientStateRestored,
  assertExistingClientStatePreserved,
  assertZeroOwnedRows,
  performanceOwnership,
} from "./ownership.mjs";
import { HttpLoadRunner, medianRun, summarize } from "./statistics.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const execution = resolvePerformanceExecution(process.env);
const profile = execution.profile;
const attachedProject = execution.attached ? process.env.SPOTTER_PERF_COMPOSE_PROJECT : undefined;
const generatedIdentity = createQaIdentity("performance");
const project =
  attachedProject === undefined ? generatedIdentity.project : assertQaProject(attachedProject);
const identity =
  attachedProject === undefined
    ? generatedIdentity
    : { project, runId: project.slice("spotter-qa-".length) };
const ownership = performanceOwnership(identity.runId);
const reportDirectory = await resolveEvidenceDirectory(
  root,
  process.env.SPOTTER_PERF_REPORT_DIR,
  path.join(root, "artifacts", "verification", `${identity.runId}-performance`),
);
const commandDirectory = path.join(reportDirectory, "commands");
const postgresAdminPassword =
  process.env.POSTGRES_ADMIN_PASSWORD ?? `qa-admin-${randomBytes(18).toString("hex")}`;
const postgresAppPassword =
  process.env.POSTGRES_APP_PASSWORD ?? `qa-app-${randomBytes(18).toString("hex")}`;
const cronSecret = process.env.CRON_SECRET ?? `qa-cron-${randomBytes(18).toString("hex")}`;
const dockerEnvironment = {
  ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
  AI_MODE: "recorded",
  APP_ENV: "production",
  CRON_SECRET: cronSecret,
  DATABASE_MODE: "postgres",
  DATABASE_URL: `postgresql://spotter_app:${postgresAppPassword}@test-postgres:5432/spotter`,
  DATA_POLICY: "synthetic_only",
  LOG_LEVEL: "info",
  POSTGRES_ADMIN_PASSWORD: postgresAdminPassword,
  POSTGRES_APP_PASSWORD: postgresAppPassword,
  POSTGRES_PORT: "0",
  POSTGRES_TEST_PORT: "0",
  SPOTTER_QA_PROJECT: project,
  SPOTTER_QA_RUN_ID: identity.runId,
  SPOTTER_RATE_LIMIT_PROFILE: "load_test",
  WEB_PORT: "0",
};
const runner = new EvidenceCommandRunner(commandDirectory, {
  environment: dockerEnvironment,
  secrets: [postgresAdminPassword, postgresAppPassword, cronSecret],
});
const compose = new ComposeProject(project, runner, dockerEnvironment);
const baseline = JSON.parse(
  await readFile(path.join(root, "backend", "tooling", "performance", "baseline.json"), "utf8"),
);
const baselineRecordBytes = await (async () => {
  const declaredPath = baseline?.measurementRecord?.path;
  if (declaredPath === null || declaredPath === undefined) return undefined;
  if (typeof declaredPath !== "string") throw new Error("Baseline measurement path is invalid.");
  const canonicalRoot = await realpath(
    path.join(root, "DOCS", "release", "evidence", "performance-baseline"),
  );
  const resolved = await realpath(path.resolve(root, declaredPath));
  const relative = path.relative(canonicalRoot, resolved);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Baseline measurement resolves outside canonical tracked evidence.");
  }
  return readFile(resolved);
})();
const corpusSql = await readFile(
  path.join(root, "backend", "tooling", "performance", "fixtures", "standard-corpus.sql"),
  "utf8",
);
const sourceBefore = await sourceState();
assertCleanReleaseSource(execution, sourceBefore);
const readDurationMs = profile === "release" ? 300_000 : 8_000;
const singlePlanCount = profile === "release" ? 50 : 10;
const failures = [];
const ownsCompose = execution.ownsCompose;
let expoDirectory;
let expoServer;
let clientStateBeforeCorpus;
const runOwnershipLease = new CleanupOwnershipLease("pre-run performance keys");
const standardCorpusLease = new CleanupOwnershipLease("pre-run standard performance corpus");
const weeklyOwnershipLease = new CleanupOwnershipLease("pre-run weekly performance keys");
const acquiredMutationFixtures = new Map();

function runScopedKey(label) {
  return `perf-${identity.runId}-${label}`;
}

function deterministicUuid(label) {
  const digest = createHash("sha256").update(`${identity.runId}:${label}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function clientId(clientNumber) {
  return performanceClientId(clientNumber);
}

function corpusId(prefix, value) {
  return `${prefix}-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function gate(id, passed, actual, budget, detail) {
  const result = { actual, budget, detail, id, passed };
  if (!passed) failures.push(result);
  return result;
}

async function psql(sql, options = {}) {
  return compose.run(
    [
      "exec",
      "--no-TTY",
      ...(options.admin === true
        ? ["--env", `PGPASSWORD=${postgresAdminPassword}`]
        : ["--env", `PGPASSWORD=${postgresAppPassword}`]),
      "test-postgres",
      "psql",
      "--set=ON_ERROR_STOP=1",
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--username",
      options.admin === true ? "postgres" : "spotter_app",
      "--dbname",
      options.database ?? "spotter",
      "--file=-",
    ],
    { input: sql, label: options.label ?? "performance-sql" },
  );
}

async function canonicalClientState(label) {
  const ids = sqlUuidList(intendedPerformanceClientIds);
  const result = await psql(
    `SELECT jsonb_build_object(
      'clients', coalesce((
        SELECT jsonb_object_agg(id::text,to_jsonb(snapshot) ORDER BY id::text)
        FROM (SELECT * FROM clients WHERE id IN (${ids})) snapshot
      ), '{}'::jsonb),
      'messageGuards', coalesce((
        SELECT jsonb_object_agg(client_id::text,to_jsonb(snapshot) ORDER BY client_id::text)
        FROM (SELECT * FROM message_guards WHERE client_id IN (${ids})) snapshot
      ), '{}'::jsonb)
    );\n`,
    { label },
  );
  return JSON.parse(result.stdout.trim());
}

async function standardOwnershipCounts(label) {
  const result = await psql(
    `SELECT jsonb_build_object(
      'accountabilityStates',(SELECT count(*) FROM accountability_states WHERE latest_score_id::text LIKE '5b000000-0000-4000-8000-%'),
      'agentRuns',(SELECT count(*) FROM agent_runs WHERE id::text LIKE '52000000-0000-4000-8000-%'),
      'appEvents',(SELECT count(*) FROM app_events WHERE id::text LIKE '5a000000-0000-4000-8000-%'),
      'checkIns',(SELECT count(*) FROM check_ins WHERE id::text LIKE '59000000-0000-4000-8000-%'),
      'constraints',(SELECT count(*) FROM client_constraints WHERE id::text LIKE '57000000-0000-4000-8000-%'),
      'evaluations',(SELECT count(*) FROM eval_results WHERE id::text LIKE '53000000-0000-4000-8000-%'),
      'messages',(SELECT count(*) FROM messages WHERE engagement_score_id::text LIKE '5b000000-0000-4000-8000-%'),
      'notes',(SELECT count(*) FROM client_notes WHERE id::text LIKE '56000000-0000-4000-8000-%'),
      'programmes',(SELECT count(*) FROM programmes WHERE id::text LIKE '54000000-0000-4000-8000-%'),
      'scores',(SELECT count(*) FROM engagement_scores WHERE id::text LIKE '5b000000-0000-4000-8000-%'),
      'sessions',(SELECT count(*) FROM sessions WHERE id::text LIKE '55000000-0000-4000-8000-%'),
      'traces',(SELECT count(*) FROM context_traces WHERE id::text LIKE '51000000-0000-4000-8000-%')
    );\n`,
    { label },
  );
  return JSON.parse(result.stdout.trim());
}

function allMutationFixtureDescriptors() {
  return [1, 2, 3].map(createMutationFixtureDescriptor);
}

async function runOwnershipCounts(label) {
  const mutationFixtures = allMutationFixtureDescriptors();
  const mutationProgrammeIds = sqlUuidList(
    mutationFixtures.flatMap((fixture) => fixture.programmes.map((programme) => programme.id)),
  );
  const mutationSessionIds = sqlUuidList(
    mutationFixtures.flatMap((fixture) => fixture.sessions.map((session) => session.id)),
  );
  const result = await psql(
    `SELECT jsonb_build_object(
      'agentRuns',(SELECT count(*) FROM agent_runs WHERE attempt_key LIKE ${sqlText(`${ownership.runProgrammeAttemptPrefix}%`)}),
      'checkIns',(SELECT count(*) FROM check_ins WHERE body LIKE ${sqlText(`${ownership.runKeyPrefix}%`)}),
      'idempotencyRecords',(SELECT count(*) FROM idempotency_records WHERE key LIKE ${sqlText(`${ownership.runKeyPrefix}%`)}),
      'jobRuns',(SELECT count(*) FROM job_runs WHERE stable_key LIKE ${sqlText(`${ownership.runKeyPrefix}%`)}),
      'mutationCoachActions',(SELECT count(*) FROM coach_actions WHERE programme_id IN (${mutationProgrammeIds})),
      'mutationProgrammes',(SELECT count(*) FROM programmes WHERE id IN (${mutationProgrammeIds})),
      'mutationSessions',(SELECT count(*) FROM sessions WHERE id IN (${mutationSessionIds})),
      'sessions',(SELECT count(*) FROM sessions WHERE session_key LIKE ${sqlText(`${ownership.runKeyPrefix}%`)})
    );\n`,
    { label },
  );
  return JSON.parse(result.stdout.trim());
}

async function weeklyOwnershipCounts(label) {
  const result = await psql(
    `SELECT jsonb_build_object(
      'agentRuns',(SELECT count(*) FROM agent_runs WHERE attempt_key LIKE ${sqlText(`${ownership.weeklyProgrammeAttemptPrefix}%`)}),
      'idempotencyRecords',(SELECT count(*) FROM idempotency_records WHERE key LIKE ${sqlText(`${ownership.weeklyClientKeyPrefix}%`)}),
      'jobRuns',(SELECT count(*) FROM job_runs WHERE stable_key=${sqlText(ownership.weeklyStableKey)})
    );\n`,
    { label },
  );
  return JSON.parse(result.stdout.trim());
}

async function cleanupGeneratedOwnership(options = {}) {
  const includeRun = options.includeRun !== false;
  const includeWeekly = options.includeWeekly !== false;
  const attemptPredicates = [
    ...(includeRun
      ? [`attempt_key LIKE ${sqlText(`${ownership.runProgrammeAttemptPrefix}%`)}`]
      : []),
    ...(includeWeekly
      ? [`attempt_key LIKE ${sqlText(`${ownership.weeklyProgrammeAttemptPrefix}%`)}`]
      : []),
  ];
  const idempotencyPredicates = [
    ...(includeRun ? [`key LIKE ${sqlText(`${ownership.runKeyPrefix}%`)}`] : []),
    ...(includeWeekly ? [`key LIKE ${sqlText(`${ownership.weeklyClientKeyPrefix}%`)}`] : []),
  ];
  const jobPredicates = [
    ...(includeRun ? [`stable_key LIKE ${sqlText(`${ownership.runKeyPrefix}%`)}`] : []),
    ...(includeWeekly ? [`stable_key=${sqlText(ownership.weeklyStableKey)}`] : []),
  ];
  if (attemptPredicates.length === 0) throw new Error("Cleanup requires exact ownership scope.");
  await psql(
    `BEGIN;
    ALTER TABLE coach_actions DISABLE TRIGGER coach_actions_append_only;
    ALTER TABLE check_ins DISABLE TRIGGER check_ins_append_only;
    ALTER TABLE eval_results DISABLE TRIGGER eval_results_append_only;
    ALTER TABLE agent_runs DISABLE TRIGGER agent_runs_append_only;
    ALTER TABLE context_traces DISABLE TRIGGER context_traces_append_only;
    CREATE TEMP TABLE performance_cleanup_agent_runs ON COMMIT DROP AS
      SELECT id FROM agent_runs WHERE ${attemptPredicates.join(" OR ")};
    CREATE TEMP TABLE performance_cleanup_programmes ON COMMIT DROP AS
      SELECT id,generated_by FROM programmes
      WHERE generated_by IN (SELECT id FROM performance_cleanup_agent_runs);
    CREATE TEMP TABLE performance_cleanup_traces ON COMMIT DROP AS
      SELECT DISTINCT trace_id AS id FROM agent_runs
      WHERE id IN (SELECT id FROM performance_cleanup_agent_runs);
    DELETE FROM coach_actions
      WHERE programme_id IN (SELECT id FROM performance_cleanup_programmes)
         OR adjustment_id IN (
           SELECT id FROM adjustments
           WHERE generated_by IN (SELECT id FROM performance_cleanup_agent_runs)
              OR base_programme_id IN (SELECT id FROM performance_cleanup_programmes)
              OR applied_programme_id IN (SELECT id FROM performance_cleanup_programmes)
         );
    DELETE FROM adjustments
      WHERE generated_by IN (SELECT id FROM performance_cleanup_agent_runs)
         OR base_programme_id IN (SELECT id FROM performance_cleanup_programmes)
         OR applied_programme_id IN (SELECT id FROM performance_cleanup_programmes);
    ${includeRun ? `DELETE FROM check_ins WHERE body LIKE ${sqlText(`${ownership.runKeyPrefix}%`)};` : ""}
    DELETE FROM sessions
      WHERE programme_id IN (SELECT id FROM performance_cleanup_programmes)
         ${includeRun ? `OR session_key LIKE ${sqlText(`${ownership.runKeyPrefix}%`)}` : ""};
    DELETE FROM programmes WHERE id IN (SELECT id FROM performance_cleanup_programmes);
    DELETE FROM eval_results WHERE agent_run_id IN (SELECT id FROM performance_cleanup_agent_runs);
    DELETE FROM agent_runs WHERE id IN (SELECT id FROM performance_cleanup_agent_runs);
    DELETE FROM context_traces WHERE id IN (SELECT id FROM performance_cleanup_traces);
    DELETE FROM idempotency_records WHERE ${idempotencyPredicates.join(" OR ")};
    DELETE FROM job_runs WHERE ${jobPredicates.join(" OR ")};
    ALTER TABLE coach_actions ENABLE TRIGGER coach_actions_append_only;
    ALTER TABLE check_ins ENABLE TRIGGER check_ins_append_only;
    ALTER TABLE eval_results ENABLE TRIGGER eval_results_append_only;
    ALTER TABLE agent_runs ENABLE TRIGGER agent_runs_append_only;
    ALTER TABLE context_traces ENABLE TRIGGER context_traces_append_only;
    COMMIT;\n`,
    { admin: true, label: options.label ?? "performance-run-database-cleanup" },
  );
}

async function cleanupRunDatabase() {
  for (const [iteration, fixture] of [...acquiredMutationFixtures]) {
    await cleanupMutationFixture(fixture, `final-mutation-cleanup-${String(fixture.iteration)}`);
    acquiredMutationFixtures.delete(iteration);
  }
  await cleanupGeneratedOwnership({
    includeWeekly: false,
    label: "performance-run-database-cleanup",
  });
  assertZeroOwnedRows(await runOwnershipCounts("performance-run-residue"), "performance run");
}

async function cleanupWeeklyOwnership(label) {
  await cleanupGeneratedOwnership({ includeRun: false, label });
  assertZeroOwnedRows(await weeklyOwnershipCounts(`${label}-residue`), "weekly run");
}

async function cleanupStandardCorpus() {
  if (clientStateBeforeCorpus === undefined) {
    throw new Error("Cannot clean the standard corpus without its pre-run client snapshot.");
  }
  const existingClientIds = new Set(Object.keys(clientStateBeforeCorpus.clients));
  const existingGuardIds = new Set(Object.keys(clientStateBeforeCorpus.messageGuards));
  const insertedClientIds = intendedPerformanceClientIds.filter((id) => !existingClientIds.has(id));
  const insertedGuardIds = intendedPerformanceClientIds.filter((id) => !existingGuardIds.has(id));
  const insertedClients = sqlUuidList(insertedClientIds);
  const insertedGuards = sqlUuidList(insertedGuardIds);
  await psql(
    `BEGIN;
    ALTER TABLE coach_actions DISABLE TRIGGER coach_actions_append_only;
    ALTER TABLE check_ins DISABLE TRIGGER check_ins_append_only;
    ALTER TABLE eval_results DISABLE TRIGGER eval_results_append_only;
    ALTER TABLE agent_runs DISABLE TRIGGER agent_runs_append_only;
    ALTER TABLE context_traces DISABLE TRIGGER context_traces_append_only;
    ALTER TABLE engagement_scores DISABLE TRIGGER engagement_scores_append_only;
    ALTER TABLE app_events DISABLE TRIGGER app_events_append_only;
    DELETE FROM coach_actions
      WHERE programme_id::text LIKE '54000000-0000-4000-8000-%'
         OR adjustment_id IN (
           SELECT id FROM adjustments
           WHERE base_programme_id::text LIKE '54000000-0000-4000-8000-%'
              OR applied_programme_id::text LIKE '54000000-0000-4000-8000-%'
         );
    DELETE FROM adjustments
      WHERE base_programme_id::text LIKE '54000000-0000-4000-8000-%'
         OR applied_programme_id::text LIKE '54000000-0000-4000-8000-%';
    DELETE FROM sessions WHERE id::text LIKE '55000000-0000-4000-8000-%';
    DELETE FROM programmes WHERE id::text LIKE '54000000-0000-4000-8000-%';
    DELETE FROM eval_results
      WHERE id::text LIKE '53000000-0000-4000-8000-%'
         OR agent_run_id::text LIKE '52000000-0000-4000-8000-%';
    DELETE FROM agent_runs WHERE id::text LIKE '52000000-0000-4000-8000-%';
    DELETE FROM context_traces WHERE id::text LIKE '51000000-0000-4000-8000-%';
    DELETE FROM client_notes WHERE id::text LIKE '56000000-0000-4000-8000-%';
    DELETE FROM client_constraints WHERE id::text LIKE '57000000-0000-4000-8000-%';
    DELETE FROM check_ins WHERE id::text LIKE '59000000-0000-4000-8000-%';
    DELETE FROM app_events WHERE id::text LIKE '5a000000-0000-4000-8000-%';
    DELETE FROM accountability_states
      WHERE latest_score_id::text LIKE '5b000000-0000-4000-8000-%';
    DELETE FROM messages WHERE engagement_score_id::text LIKE '5b000000-0000-4000-8000-%';
    DELETE FROM engagement_scores WHERE id::text LIKE '5b000000-0000-4000-8000-%';
    ${insertedGuardIds.length > 0 ? `DELETE FROM message_guards WHERE client_id IN (${insertedGuards});` : ""}
    ${insertedClientIds.length > 0 ? `DELETE FROM clients WHERE id IN (${insertedClients});` : ""}
    ALTER TABLE coach_actions ENABLE TRIGGER coach_actions_append_only;
    ALTER TABLE check_ins ENABLE TRIGGER check_ins_append_only;
    ALTER TABLE eval_results ENABLE TRIGGER eval_results_append_only;
    ALTER TABLE agent_runs ENABLE TRIGGER agent_runs_append_only;
    ALTER TABLE context_traces ENABLE TRIGGER context_traces_append_only;
    ALTER TABLE engagement_scores ENABLE TRIGGER engagement_scores_append_only;
    ALTER TABLE app_events ENABLE TRIGGER app_events_append_only;
    COMMIT;\n`,
    { admin: true, label: "standard-corpus-cleanup" },
  );
  assertZeroOwnedRows(
    await standardOwnershipCounts("standard-corpus-residue"),
    "standard performance corpus",
  );
  assertExactClientStateRestored(
    clientStateBeforeCorpus,
    await canonicalClientState("canonical-client-state-after-cleanup"),
  );
}

async function prepareEnvironment() {
  if (ownsCompose) {
    await compose.run(["config", "--quiet"], { label: "compose-config" });
    await compose.run(["build", "--pull", "--no-cache", "migrate", "seed", "web"], {
      environment: { BUILDKIT_PROGRESS: "plain" },
      label: "production-build",
      stream: true,
    });
    await compose.run(["up", "--detach", "--wait", "--wait-timeout", "120", "test-postgres"], {
      label: "start-postgres",
    });
    await compose.run(["run", "--no-deps", "--rm", "migrate"], { label: "migrate" });
  }
}

async function startWebEnvironment() {
  if (ownsCompose) {
    await compose.run(["up", "--detach", "--no-deps", "--wait", "--wait-timeout", "180", "web"], {
      label: "start-web",
    });
  }
  const webPort =
    process.env.SPOTTER_PERF_WEB_PORT === undefined
      ? await compose.mappedPort("web", 3000)
      : Number(process.env.SPOTTER_PERF_WEB_PORT);
  if (!Number.isSafeInteger(webPort) || webPort < 1 || webPort > 65535) {
    throw new Error("SPOTTER_PERF_WEB_PORT is not a valid mapped port.");
  }
  const baseUrl = process.env.SPOTTER_PERF_BASE_URL ?? `http://127.0.0.1:${String(webPort)}`;
  await waitFor(
    "production web readiness",
    async () => {
      const response = await fetch(`${baseUrl}/health/ready`, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok;
    },
    { timeoutMs: 120_000 },
  );
  return baseUrl;
}

async function seedCorpus() {
  clientStateBeforeCorpus = await canonicalClientState("canonical-client-state-before-corpus");
  standardCorpusLease.acquire(await standardOwnershipCounts("standard-corpus-preflight"));
  runOwnershipLease.acquire(await runOwnershipCounts("performance-run-ownership-preflight"));
  weeklyOwnershipLease.acquire(
    await weeklyOwnershipCounts("performance-weekly-ownership-preflight"),
  );
  await psql(corpusSql, { label: "seed-standard-performance-corpus" });
  assertExistingClientStatePreserved(
    clientStateBeforeCorpus,
    await canonicalClientState("canonical-client-state-after-corpus"),
  );
  const result = await psql(
    `SELECT jsonb_build_object(
      'coaches', (SELECT count(*) FROM coaches WHERE id='00000000-0000-4000-8000-000000000001'),
      'clients', (SELECT count(*) FROM clients WHERE id IN (SELECT ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text,12,'0'))::uuid FROM generate_series(1,50) corpus(client_number)) AND status='active' AND data_classification='synthetic'),
      'totalClients', (SELECT count(*) FROM clients),
      'activeSyntheticClients', (SELECT count(*) FROM clients WHERE status='active' AND data_classification='synthetic'),
      'activeSyntheticClientIds', (SELECT jsonb_agg(id::text ORDER BY id::text) FROM clients WHERE status='active' AND data_classification='synthetic'),
      'nonSyntheticClients', (SELECT count(*) FROM clients WHERE data_classification<>'synthetic'),
      'programmes', (SELECT count(*) FROM programmes WHERE id::text LIKE '54000000-0000-4000-8000-%'),
      'totalProgrammes', (SELECT count(*) FROM programmes),
      'historicalProgrammes', (SELECT count(*) FROM programmes WHERE id::text LIKE '54000000-0000-4000-8000-%' AND status='superseded'),
      'publishedProgrammes', (SELECT count(*) FROM programmes WHERE id::text LIKE '54000000-0000-4000-8000-%' AND status='published'),
      'queuedProgrammes', (SELECT count(*) FROM programmes WHERE id::text LIKE '54000000-0000-4000-8000-%' AND status='queued'),
      'totalQueuedProgrammes', (SELECT count(*) FROM programmes WHERE status='queued'),
      'totalQueuedClients', (SELECT count(DISTINCT client_id) FROM programmes WHERE status='queued'),
      'minimumProgrammesPerClient', (SELECT min(total) FROM (SELECT client_id,count(*) total FROM programmes WHERE id::text LIKE '54000000-0000-4000-8000-%' GROUP BY client_id) x),
      'sessions', (SELECT count(*) FROM sessions WHERE id::text LIKE '55000000-0000-4000-8000-%'),
      'totalSessions', (SELECT count(*) FROM sessions),
      'sessionClients', (SELECT count(DISTINCT client_id) FROM sessions WHERE id::text LIKE '55000000-0000-4000-8000-%'),
      'minimumSessionsPerClient', (SELECT min(total) FROM (SELECT client_id,count(*) total FROM sessions WHERE id::text LIKE '55000000-0000-4000-8000-%' GROUP BY client_id) x),
      'queuedClients', (SELECT count(DISTINCT client_id) FROM programmes WHERE id::text LIKE '54000000-0000-4000-8000-%' AND status='queued'),
      'bands', (SELECT jsonb_object_agg(review_band,total) FROM (SELECT review_band::text review_band,count(*) total FROM programmes WHERE id::text LIKE '54000000-0000-4000-8000-%' AND status='queued' GROUP BY review_band) x),
      'notes', (SELECT count(*) FROM client_notes WHERE id::text LIKE '56000000-0000-4000-8000-%'),
      'constraints', (SELECT count(*) FROM client_constraints WHERE id::text LIKE '57000000-0000-4000-8000-%'),
      'traces', (SELECT count(*) FROM context_traces WHERE id::text LIKE '51000000-0000-4000-8000-%'),
      'runs', (SELECT count(*) FROM agent_runs WHERE id::text LIKE '52000000-0000-4000-8000-%'),
      'evaluations', (SELECT count(*) FROM eval_results WHERE id::text LIKE '53000000-0000-4000-8000-%')
    );\n`,
    { label: "performance-corpus-cardinalities" },
  );
  const cardinalities = assertStandardCorpus(JSON.parse(result.stdout.trim()));
  await writeJson(path.join(reportDirectory, "seed-cardinalities.json"), cardinalities);
  return cardinalities;
}

async function environmentEvidence(baseUrl, cardinalities) {
  const [dockerVersion, dockerInfo, composeVersion, nodeVersion, pnpmVersion, webId] =
    await Promise.all([
      runner.run("docker", ["version", "--format", "{{json .}}"], { label: "docker-version" }),
      runner.run("docker", ["info", "--format", "{{json .}}"], { label: "docker-info" }),
      runner.run("docker", ["compose", "version", "--short"], { label: "compose-version" }),
      runner.run(process.execPath, ["--version"], { label: "node-version" }),
      runner.run("corepack", ["pnpm", "--version"], { label: "pnpm-version" }),
      compose.serviceContainer("web"),
    ]);
  const inspect = await runner.run("docker", ["inspect", webId], { label: "web-resource-inspect" });
  const web = JSON.parse(inspect.stdout)[0];
  const topology = await processSnapshot("environment-topology");
  const configuredWorkerCount = Number(
    web.Config.Env.find((entry) => entry.startsWith("SPOTTER_WEB_WORKERS="))?.split("=")[1],
  );
  if (
    configuredWorkerCount !== topology.expectedWorkerCount ||
    topology.workerCount !== topology.expectedWorkerCount ||
    topology.processCount !== topology.expectedWorkerCount + 1
  ) {
    throw new Error("Web cluster topology does not match its configured worker count.");
  }
  const evidence = {
    allocation: {
      cpuCount: JSON.parse(dockerInfo.stdout).NCPU,
      dockerMemoryBytes: JSON.parse(dockerInfo.stdout).MemTotal,
      webCpuQuota: web.HostConfig.NanoCpus,
      webMemoryBytes: web.HostConfig.Memory,
    },
    baseUrl,
    compose: composeVersion.stdout.trim(),
    corpus: cardinalities,
    docker: JSON.parse(dockerVersion.stdout),
    execution,
    node: nodeVersion.stdout.trim(),
    pnpm: pnpmVersion.stdout.trim(),
    profile,
    project,
    qaIdentity: { project, runId: identity.runId },
    rateLimitProfile: {
      name: "load_test",
      noRequestHeaderBypass: true,
      qaIdentityBound: true,
      syntheticOnlyNoAuth: true,
    },
    schemaVersion: 1,
    webProcessTopology: {
      clustered: true,
      configuredWorkerCount,
      observedWorkerCount: topology.workerCount,
      primaryCount: topology.primary === undefined ? 0 : 1,
      processCount: topology.processCount,
      workerSlots: topology.workers.map((worker) => worker.slot),
    },
  };
  await writeJson(path.join(reportDirectory, "environment.json"), evidence);
  return evidence;
}

async function warmup(http) {
  const paths = [
    "/api/v1/clients?status=active&limit=50",
    `/api/v1/clients/${clientId(1)}`,
    `/api/v1/clients/${clientId(1)}/today`,
    "/api/v1/programmes?status=queued&limit=100",
    `/api/v1/traces/${corpusId("51000000", 1)}`,
  ];
  for (const route of paths) {
    const result = await http.request({
      path: route,
      validate: (response) => assertReadResponse(response, route, intendedPerformanceClientIds),
    });
    if (result.error !== undefined) {
      const diagnostic = JSON.stringify(responseFailureDiagnostic(result)).slice(0, 2_000);
      throw new Error(`Warm-up failed for ${route}: ${diagnostic}`);
    }
  }
}

async function readApiGate(http) {
  const paths = [
    "/api/v1/programmes?status=queued&limit=100",
    "/api/v1/clients?status=active&limit=50",
    `/api/v1/clients/${clientId(1)}`,
    `/api/v1/clients/${clientId(1)}/today`,
    `/api/v1/traces/${corpusId("51000000", 1)}`,
  ];
  const runs = [];
  for (let iteration = 1; iteration <= 3; iteration += 1) {
    runs.push(
      await http.load({
        durationMs: readDurationMs,
        name: `mixed-read-apis-run-${String(iteration)}`,
        scenario: ({ sequence, virtualUser }) => ({
          headers: {
            "x-request-id": `perf-read-${String(iteration)}-${String(virtualUser)}-${String(sequence)}`,
          },
          path: paths[(sequence + virtualUser) % paths.length],
          validate: (response) =>
            assertReadResponse(
              response,
              paths[(sequence + virtualUser) % paths.length],
              intendedPerformanceClientIds,
            ),
        }),
        virtualUsers: 25,
      }),
    );
  }
  const deciding = medianRun(runs, (run) => run.p95Ms);
  await writeJson(path.join(reportDirectory, "nfr-perf-001-read-apis.json"), {
    decidingRun: deciding.scenario,
    runs,
  });
  return gate(
    "NFR-PERF-001",
    runs.every((run) => run.validationErrorCount === 0 && run.errorRate < 0.01) &&
      deciding.p95Ms <= 250 &&
      deciding.p99Ms <= 750,
    {
      everyRunCorrect: runs.every((run) => run.validationErrorCount === 0),
      errorRate: deciding.errorRate,
      p95Ms: deciding.p95Ms,
      p99Ms: deciding.p99Ms,
    },
    { errorRate: "<0.01", p95Ms: 250, p99Ms: 750 },
    "25 virtual users; five minutes per release run; median of three runs decides.",
  );
}

async function queueGate(http) {
  const queryEvidence = [];
  const runs = [];
  for (let iteration = 1; iteration <= 3; iteration += 1) {
    await psql(
      "CREATE EXTENSION IF NOT EXISTS pg_stat_statements; SELECT pg_stat_statements_reset();\n",
      {
        admin: true,
        label: `queue-query-reset-${String(iteration)}`,
      },
    );
    const latencies = [];
    for (let request = 0; request < 100; request += 1) {
      const result = await http.request({
        headers: { "x-request-id": `perf-queue-${String(iteration)}-${String(request)}` },
        path: "/api/v1/programmes?status=queued&limit=100",
        validate: (response) =>
          assertReadResponse(
            response,
            "/api/v1/programmes?status=queued&limit=100",
            intendedPerformanceClientIds,
          ),
      });
      if (result.error !== undefined)
        throw new Error(`Queue performance request failed: ${result.error}`);
      const clients = new Set(result.body?.data?.map((programme) => programme.clientId) ?? []);
      if (clients.size !== 50) {
        throw new Error(
          `Queue corpus returned ${String(clients.size)} distinct clients, expected 50.`,
        );
      }
      latencies.push(result.durationMs);
    }
    const statements = await psql(
      `SELECT coalesce(jsonb_agg(jsonb_build_object(
        'calls', calls,
        'meanExecutionMs', mean_exec_time,
        'query', left(regexp_replace(query, '\\s+', ' ', 'g'), 500),
        'rows', rows
      ) ORDER BY calls DESC), '[]'::jsonb)
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND userid = (SELECT oid FROM pg_roles WHERE rolname = 'spotter_app');\n`,
      { admin: true, label: `queue-query-count-${String(iteration)}` },
    );
    const parsedStatements = JSON.parse(statements.stdout.trim());
    const calls = parsedStatements.reduce((sum, statement) => sum + Number(statement.calls), 0);
    queryEvidence.push({ calls, iteration, statements: parsedStatements });
    runs.push({ iteration, ...summarize(latencies) });
  }
  const deciding = medianRun(runs, (run) => run.p95Ms);
  const decidingQueries = queryEvidence.find((entry) => entry.iteration === deciding.iteration);
  await writeJson(path.join(reportDirectory, "nfr-perf-005-queue.json"), {
    decidingRun: deciding.iteration,
    queryEvidence,
    runs,
  });
  return gate(
    "NFR-PERF-005",
    deciding.p95Ms <= 500 &&
      queryEvidence.every((entry) => entry.calls <= 1_000) &&
      runs.every((run) => run.samples === 100),
    {
      everyRunQueryBounded: queryEvidence.every((entry) => entry.calls <= 1_000),
      p95Ms: deciding.p95Ms,
      statementsPerRequest: (decidingQueries?.calls ?? 0) / 100,
    },
    { p95Ms: 500, statementsPerRequest: 10 },
    "Full 50-client queue; 100 requests per run; pg_stat_statements proves bounded query count.",
  );
}

function actualForSession() {
  return assertMutationContractFixture(createMutationContractFixture()).actual;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlUuidList(values) {
  return values.map((value) => `${sqlText(value)}::uuid`).join(",");
}

function createMutationFixtureDescriptor(iteration) {
  const marker = runScopedKey(`mutation-${String(iteration)}`);
  const weekStart = recordedWeekStart;
  const contract = assertMutationContractFixture(createMutationContractFixture(weekStart));
  const sessions = [];
  const programmes = [];
  for (let index = 1; index <= 10; index += 1) {
    sessions.push({
      clientId: clientId(index),
      id: deterministicUuid(`mutation-session-${String(iteration)}-${String(index)}`),
      programmeId: corpusId("54000000", index * 100 + 12),
      sessionKey: `${marker}-session-${String(index)}`,
    });
    programmes.push({
      clientId: clientId(index),
      id: deterministicUuid(`mutation-programme-${String(iteration)}-${String(index)}`),
      version: 300 + iteration,
    });
  }
  return { contract, iteration, marker, programmes, sessions, weekStart };
}

async function prepareMutationFixture(fixture) {
  const sessionValues = fixture.sessions
    .map(
      (session) =>
        `(${sqlText(session.id)}::uuid,${sqlText(session.clientId)}::uuid,${sqlText(session.programmeId)}::uuid,${sqlText(session.sessionKey)},${sqlText(fixture.weekStart)}::date)`,
    )
    .join(",\n");
  const programmeValues = fixture.programmes
    .map(
      (programme, index) =>
        `(${sqlText(programme.id)}::uuid,${sqlText(programme.clientId)}::uuid,${String(programme.version)},${sqlText(fixture.weekStart)}::date,${sqlText(corpusId("52000000", index + 1))}::uuid)`,
    )
    .join(",\n");
  await psql(
    `BEGIN;
    INSERT INTO programmes (
      id,client_id,version,mesocycle,week,week_start,payload,status,review_band,generated_by,created_at
    )
    SELECT id,client_id,version,99,99,week_start,
      ${sqlText(JSON.stringify(fixture.contract.payload))}::jsonb,
      'queued'::programme_status,'clear'::review_band,generated_by,now()
    FROM (VALUES ${programmeValues}) AS fixture(id,client_id,version,week_start,generated_by);
    INSERT INTO sessions (
      id,client_id,programme_id,session_key,scheduled_for,status,planned,actual,notes,version,created_at
    )
    SELECT id,client_id,programme_id,session_key,scheduled_for,'scheduled'::session_status,
      ${sqlText(JSON.stringify(fixture.contract.planned))}::jsonb,NULL,NULL,1,now()
    FROM (VALUES ${sessionValues}) AS fixture(id,client_id,programme_id,session_key,scheduled_for);
    COMMIT;\n`,
    { label: `mutation-fixture-${String(fixture.iteration)}` },
  );
  return fixture;
}

function mutationSpecifications(fixture) {
  const specifications = [];
  for (let index = 1; index <= 10; index += 1) {
    const session = fixture.sessions[index - 1];
    const programme = fixture.programmes[index - 1];
    specifications.push({
      body: {
        body: fixture.marker,
        clientId: clientId(index),
        readiness: 4,
        respondedAt: `${fixture.weekStart}T08:00:00.000Z`,
      },
      headers: {
        "idempotency-key": `${fixture.marker}-checkin-${String(index).padStart(2, "0")}`,
      },
      kind: "check-in",
      method: "POST",
      path: "/api/v1/check-ins",
    });
    specifications.push({
      body: {
        actual: actualForSession(),
        clientId: clientId(index),
        expectedVersion: 1,
        notes: null,
      },
      headers: {
        "idempotency-key": `${fixture.marker}-session-${String(index).padStart(2, "0")}`,
      },
      kind: "session-log",
      expectedId: session.id,
      method: "POST",
      path: `/api/v1/sessions/${session.id}/log`,
    });
    specifications.push({
      body: { expectedVersion: programme.version, reason: "Disposable performance review." },
      headers: {
        "idempotency-key": `${fixture.marker}-review-${String(index).padStart(2, "0")}`,
      },
      kind: "programme-review",
      expectedId: programme.id,
      method: "POST",
      path: `/api/v1/programmes/${programme.id}/reject`,
    });
  }
  return specifications;
}

async function mutationDatabaseEvidence(fixture) {
  const sessionIds = sqlUuidList(fixture.sessions.map((entry) => entry.id));
  const programmeIds = sqlUuidList(fixture.programmes.map((entry) => entry.id));
  const result = await psql(
    `SELECT jsonb_build_object(
      'completedIdempotencyRecords',(SELECT count(*) FROM idempotency_records WHERE key LIKE ${sqlText(`${fixture.marker}-%`)} AND state='completed'),
      'checkIns',(SELECT count(*) FROM check_ins WHERE body=${sqlText(fixture.marker)}),
      'loggedSessions',(SELECT count(*) FROM sessions WHERE id IN (${sessionIds}) AND version=2 AND actual IS NOT NULL),
      'rejectedProgrammes',(SELECT count(*) FROM programmes WHERE id IN (${programmeIds}) AND status='rejected')
    );\n`,
    { label: `mutation-invariants-${String(fixture.iteration)}` },
  );
  return JSON.parse(result.stdout.trim());
}

async function mutationFixtureOwnershipCounts(fixture, label) {
  const sessionIds = sqlUuidList(fixture.sessions.map((entry) => entry.id));
  const programmeIds = sqlUuidList(fixture.programmes.map((entry) => entry.id));
  const result = await psql(
    `SELECT jsonb_build_object(
      'checkIns',(SELECT count(*) FROM check_ins WHERE body=${sqlText(fixture.marker)}),
      'coachActions',(SELECT count(*) FROM coach_actions WHERE programme_id IN (${programmeIds})),
      'idempotencyRecords',(SELECT count(*) FROM idempotency_records WHERE key LIKE ${sqlText(`${fixture.marker}-%`)}),
      'programmes',(SELECT count(*) FROM programmes WHERE id IN (${programmeIds})),
      'sessions',(SELECT count(*) FROM sessions WHERE id IN (${sessionIds}))
    );\n`,
    { label },
  );
  return JSON.parse(result.stdout.trim());
}

async function cleanupMutationFixture(fixture, label) {
  const sessionIds = sqlUuidList(fixture.sessions.map((entry) => entry.id));
  const programmeIds = sqlUuidList(fixture.programmes.map((entry) => entry.id));
  await psql(
    `BEGIN;
    ALTER TABLE coach_actions DISABLE TRIGGER coach_actions_append_only;
    ALTER TABLE check_ins DISABLE TRIGGER check_ins_append_only;
    DELETE FROM coach_actions WHERE programme_id IN (${programmeIds});
    DELETE FROM check_ins WHERE body=${sqlText(fixture.marker)};
    DELETE FROM sessions WHERE id IN (${sessionIds});
    DELETE FROM programmes WHERE id IN (${programmeIds});
    DELETE FROM idempotency_records WHERE key LIKE ${sqlText(`${fixture.marker}-%`)};
    ALTER TABLE coach_actions ENABLE TRIGGER coach_actions_append_only;
    ALTER TABLE check_ins ENABLE TRIGGER check_ins_append_only;
    COMMIT;\n`,
    {
      admin: true,
      label: label ?? `mutation-cleanup-${String(fixture.iteration)}`,
    },
  );
  assertZeroOwnedRows(
    await mutationFixtureOwnershipCounts(
      fixture,
      `mutation-cleanup-residue-${String(fixture.iteration)}`,
    ),
    "mutation fixture",
  );
}

async function mutationGate(http) {
  const runs = [];
  for (let iteration = 1; iteration <= 3; iteration += 1) {
    const fixture = createMutationFixtureDescriptor(iteration);
    const cleanupLease = new CleanupOwnershipLease(
      `mutation fixture ${String(iteration)} preflight`,
    );
    cleanupLease.acquire(
      await mutationFixtureOwnershipCounts(
        fixture,
        `mutation-fixture-${String(iteration)}-preflight`,
      ),
    );
    acquiredMutationFixtures.set(iteration, fixture);
    try {
      await prepareMutationFixture(fixture);
      const specifications = mutationSpecifications(fixture).map((specification, index) => ({
        ...specification,
        headers: {
          ...specification.headers,
          "x-request-id": `${fixture.marker}-initial-${String(index)}`,
        },
        validate: (response) => assertMutationResponse(response, specification),
      }));
      const initial = await http.batch({
        name: `initial-mutations-run-${String(iteration)}`,
        specifications,
        virtualUsers: 10,
      });
      const retries = await http.batch({
        name: `exact-mutation-retries-run-${String(iteration)}`,
        specifications: specifications.map((specification, index) => ({
          ...specification,
          headers: {
            ...specification.headers,
            "x-request-id": `${fixture.marker}-retry-${String(index)}`,
          },
        })),
        virtualUsers: 10,
      });
      const exactRetry = initial.results.every(
        (result, index) =>
          result.status === retries.results[index].status &&
          JSON.stringify(result.body?.data) === JSON.stringify(retries.results[index].body?.data),
      );
      const database = await mutationDatabaseEvidence(fixture);
      runs.push({ database, exactRetry, initial, iteration, retries });
    } finally {
      if (cleanupLease.acquired) {
        await cleanupMutationFixture(fixture);
        acquiredMutationFixtures.delete(iteration);
      }
    }
  }
  const deciding = medianRun(runs, (run) => Math.max(run.initial.p95Ms, run.retries.p95Ms));
  const invariantsPassed = runs.every(
    (run) =>
      run.exactRetry &&
      run.initial.errorCount === 0 &&
      run.retries.errorCount === 0 &&
      run.database.completedIdempotencyRecords === 30 &&
      run.database.checkIns === 10 &&
      run.database.loggedSessions === 10 &&
      run.database.rejectedProgrammes === 10,
  );
  const p95Ms = Math.max(deciding.initial.p95Ms, deciding.retries.p95Ms);
  const p99Ms = Math.max(deciding.initial.p99Ms, deciding.retries.p99Ms);
  const errorRate = Math.max(deciding.initial.errorRate, deciding.retries.errorRate);
  await writeJson(path.join(reportDirectory, "nfr-perf-002-mutations.json"), {
    decidingRun: deciding.iteration,
    runs,
  });
  return gate(
    "NFR-PERF-002",
    invariantsPassed && p95Ms <= 500 && p99Ms <= 1_000 && errorRate < 0.01,
    {
      errorRate,
      initial: deciding.initial,
      invariantsPassed,
      p95Ms,
      p99Ms,
      retries: deciding.retries,
    },
    { errorRate: "<0.01", p95Ms: 500, p99Ms: 1_000 },
    "Ten virtual users time 30 disposable initial writes and their exact retries separately; every run proves one side effect per idempotency key.",
  );
}

async function singlePlanDatabaseEvidence(programmeIds, iteration) {
  const ids = sqlUuidList(programmeIds);
  const keyPrefix = runScopedKey(`plan-${String(iteration)}-`);
  const result = await psql(
    `SELECT jsonb_build_object(
      'completedIdempotencyRecords',(SELECT count(*) FROM idempotency_records WHERE key LIKE ${sqlText(`${keyPrefix}%`)} AND state='completed'),
      'distinctClients',(SELECT count(DISTINCT client_id) FROM programmes WHERE id IN (${ids})),
      'programmes',(SELECT count(*) FROM programmes WHERE id IN (${ids})),
      'programmesWithEvaluations',(SELECT count(*) FROM programmes p WHERE p.id IN (${ids}) AND EXISTS (SELECT 1 FROM eval_results e WHERE e.agent_run_id=p.generated_by)),
      'recordedSuccessfulRuns',(SELECT count(*) FROM agent_runs r JOIN programmes p ON p.generated_by=r.id WHERE p.id IN (${ids}) AND r.status='succeeded' AND r.model='recorded/spotter-v1'),
      'traces',(SELECT count(DISTINCT r.trace_id) FROM agent_runs r JOIN programmes p ON p.generated_by=r.id WHERE p.id IN (${ids})),
      'weekCorrect',(SELECT count(*) FROM programmes WHERE id IN (${ids}) AND week_start=${sqlText(recordedWeekStart)}::date AND payload->'days'->0->>'scheduledDate'=${sqlText(recordedWeekStart)})
    );\n`,
    { label: `single-plan-invariants-${String(iteration)}` },
  );
  return JSON.parse(result.stdout.trim());
}

async function singlePlanGate(http) {
  const runs = [];
  for (let iteration = 1; iteration <= 3; iteration += 1) {
    const weekStart = recordedWeekStart;
    const latencies = [];
    const errors = [];
    const programmeIds = [];
    for (let index = 1; index <= singlePlanCount; index += 1) {
      const expected = { clientId: clientId(index), weekStart };
      const result = await http.request({
        body: { clientId: expected.clientId, targetWeekStart: weekStart },
        headers: {
          "idempotency-key": runScopedKey(
            `plan-${String(iteration)}-${String(index).padStart(2, "0")}`,
          ),
          "x-request-id": runScopedKey(
            `plan-${String(iteration)}-${String(index).padStart(2, "0")}`,
          ),
        },
        method: "POST",
        path: "/api/v1/programmes/generate",
        timeoutMs: 10_000,
        validate: (response) => assertProgrammeGenerationResponse(response, expected),
      });
      latencies.push(result.durationMs);
      if (result.error !== undefined) errors.push(result);
      else programmeIds.push(result.body.data.programme.id);
    }
    const database =
      programmeIds.length === singlePlanCount
        ? await singlePlanDatabaseEvidence(programmeIds, iteration)
        : null;
    const correct =
      errors.length === 0 &&
      database?.completedIdempotencyRecords === singlePlanCount &&
      database?.distinctClients === singlePlanCount &&
      database?.programmes === singlePlanCount &&
      database?.programmesWithEvaluations === singlePlanCount &&
      database?.recordedSuccessfulRuns === singlePlanCount &&
      database?.traces === singlePlanCount &&
      database?.weekCorrect === singlePlanCount;
    runs.push({
      correct,
      database,
      errorCount: errors.length,
      errors,
      iteration,
      weekStart,
      ...summarize(latencies),
    });
  }
  const deciding = medianRun(runs, (run) => run.p95Ms);
  await writeJson(path.join(reportDirectory, "nfr-perf-003-single-plan.json"), {
    clientCount: singlePlanCount,
    decidingRun: deciding.iteration,
    runs,
  });
  return gate(
    "NFR-PERF-003",
    runs.every((run) => run.correct) && deciding.p95Ms <= 2_000,
    {
      errors: deciding.errorCount,
      everyRunCorrect: runs.every((run) => run.correct),
      p95Ms: deciding.p95Ms,
    },
    { errors: 0, p95Ms: 2_000 },
    `${String(singlePlanCount)} sequential mixed synthetic clients request the canonical recorded week; every response and exact database effect is validated.`,
  );
}

async function invokeWeeklyBatch(http, weekStart, idempotencyKey) {
  const result = await http.request({
    body: { runKey: `weekly-plan:${weekStart}`, targetWeekStart: weekStart },
    headers: {
      authorization: `Bearer ${cronSecret}`,
      "idempotency-key": idempotencyKey,
      "x-request-id": idempotencyKey,
    },
    method: "POST",
    path: "/api/v1/jobs/weekly-plan",
    timeoutMs: 120_000,
    validate: (response) => assertWeeklyResponse(response, weekStart),
  });
  if (result.error !== undefined) throw new Error(`Weekly batch failed: ${result.error}`);
  return result;
}

async function weeklyBatchDatabaseEvidence(weekStart) {
  const stableKey = `weekly-plan:${weekStart}`;
  const result = await psql(
    `SELECT jsonb_build_object(
      'jobRuns',(SELECT count(*) FROM job_runs WHERE stable_key=${sqlText(stableKey)}),
      'completedJobRuns',(SELECT count(*) FROM job_runs WHERE stable_key=${sqlText(stableKey)} AND status='completed'),
      'jobAttempt',(SELECT attempt FROM job_runs WHERE stable_key=${sqlText(stableKey)}),
      'programmes',(SELECT count(*) FROM programmes p JOIN agent_runs r ON r.id=p.generated_by WHERE r.attempt_key LIKE ${sqlText(`programme:${stableKey}:%`)}),
      'recordedSuccessfulRuns',(SELECT count(*) FROM agent_runs WHERE attempt_key LIKE ${sqlText(`programme:${stableKey}:%`)} AND status='succeeded' AND model='recorded/spotter-v1'),
      'traces',(SELECT count(DISTINCT trace_id) FROM agent_runs WHERE attempt_key LIKE ${sqlText(`programme:${stableKey}:%`)}),
      'programmesWithEvaluations',(SELECT count(*) FROM programmes p WHERE p.generated_by IN (SELECT id FROM agent_runs WHERE attempt_key LIKE ${sqlText(`programme:${stableKey}:%`)}) AND EXISTS (SELECT 1 FROM eval_results e WHERE e.agent_run_id=p.generated_by)),
      'weekCorrect',(SELECT count(*) FROM programmes p JOIN agent_runs r ON r.id=p.generated_by WHERE r.attempt_key LIKE ${sqlText(`programme:${stableKey}:%`)} AND p.week_start=${sqlText(weekStart)}::date AND p.payload->'days'->0->>'scheduledDate'=${sqlText(weekStart)}),
      'completedClientIdempotencyRecords',(SELECT count(*) FROM idempotency_records WHERE key LIKE ${sqlText(`${stableKey}:%`)} AND state='completed')
    );\n`,
    { label: `weekly-invariants-${weekStart}` },
  );
  return JSON.parse(result.stdout.trim());
}

async function weeklyBatchGate(http) {
  const activeClients = await psql(
    `SELECT coalesce(jsonb_agg(id::text ORDER BY id::text),'[]'::jsonb)
     FROM clients WHERE status='active' AND data_classification='synthetic';\n`,
    { label: "weekly-global-active-synthetic-client-set" },
  );
  assertExactActiveSyntheticClientSet(JSON.parse(activeClients.stdout.trim()));
  const starts = [recordedWeekStart, recordedWeekStart, recordedWeekStart];
  const runs = [];
  for (const [index, weekStart] of starts.entries()) {
    const key = runScopedKey(`weekly-${String(index + 1)}`);
    try {
      const first = await invokeWeeklyBatch(http, weekStart, key);
      const retry = await invokeWeeklyBatch(http, weekStart, key);
      const database = await weeklyBatchDatabaseEvidence(weekStart);
      runs.push({
        database,
        durationMs: first.durationMs,
        iteration: index + 1,
        result: first.body?.data,
        retryDurationMs: retry.durationMs,
        retryResult: retry.body?.data,
        stableRetry: JSON.stringify(first.body?.data) === JSON.stringify(retry.body?.data),
        weekStart,
      });
    } finally {
      await cleanupWeeklyOwnership(`weekly-run-${String(index + 1)}-cleanup`);
    }
  }
  const deciding = medianRun(runs, (run) => run.durationMs);
  await writeJson(path.join(reportDirectory, "nfr-perf-004-weekly-batch.json"), {
    decidingRun: deciding.iteration,
    runs,
  });
  return gate(
    "NFR-PERF-004",
    deciding.durationMs <= 90_000 && runs.every(assertWeeklyRunCorrect),
    {
      durationMs: deciding.durationMs,
      everyRunCorrect: runs.every(assertWeeklyRunCorrect),
      result: deciding.result,
    },
    { durationMs: 90_000, failed: 0, processed: 50, succeeded: 50, stableRetry: true },
    "Every scheduled 50-client batch and retry proves one completed job, 50 programmes, and 50 completed client idempotency records; median duration decides timing.",
  );
}

async function databaseGate(http) {
  const statements = [
    "SELECT id FROM programmes WHERE status='queued' ORDER BY review_band,created_at,id LIMIT 100",
    "SELECT id,handle FROM clients WHERE status='active' AND data_classification='synthetic' ORDER BY handle,id",
    `SELECT id FROM programmes WHERE client_id='${clientId(1)}' AND status='published' AND superseded_by IS NULL ORDER BY valid_from DESC,created_at DESC,id DESC LIMIT 1`,
    `SELECT id,selected,rendered FROM context_traces WHERE id='${corpusId("51000000", 1)}' LIMIT 1`,
  ];
  const repositoryPaths = [
    "/api/v1/programmes?status=queued&limit=100",
    `/api/v1/clients/${clientId(1)}`,
    `/api/v1/programmes/${corpusId("54000000", 112)}`,
    `/api/v1/traces/${corpusId("51000000", 1)}`,
  ];
  const runs = [];
  for (let iteration = 1; iteration <= 3; iteration += 1) {
    const sql = Array.from({ length: 25 }, () => statements)
      .flat()
      .map((statement) => `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement};`)
      .join("\n");
    const result = await psql(sql, { label: `critical-query-explain-${String(iteration)}` });
    const timings = [...result.stdout.matchAll(/"Execution Time":\s*([0-9.]+)/gu)].map((match) =>
      Number(match[1]),
    );
    if (timings.length !== 100 || timings.some((value) => !Number.isFinite(value))) {
      throw new Error(
        `Expected 100 PostgreSQL execution timings, received ${String(timings.length)}.`,
      );
    }
    await writeFile(
      path.join(reportDirectory, `nfr-perf-006-explain-run-${String(iteration)}.json.txt`),
      result.stdout,
      "utf8",
    );
    const measuredRepositoryApi = await http.batch({
      name: `critical-repository-api-run-${String(iteration)}`,
      specifications: Array.from({ length: 25 }, () => repositoryPaths)
        .flat()
        .map((repositoryPath, index) => ({
          headers: {
            "x-request-id": runScopedKey(
              `repository-${String(iteration)}-${String(index).padStart(3, "0")}`,
            ),
          },
          path: repositoryPath,
          validate: (response) =>
            assertReadResponse(response, repositoryPath, intendedPerformanceClientIds),
        })),
      virtualUsers: 1,
    });
    const { results: _repositoryResponses, ...repositoryApi } = measuredRepositoryApi;
    void _repositoryResponses;
    runs.push({
      explain: { timingsMs: timings, ...summarize(timings) },
      iteration,
      p95Ms: Math.max(summarize(timings).p95Ms, repositoryApi.p95Ms),
      repositoryApi,
    });
  }
  const deciding = medianRun(runs, (run) => run.p95Ms);
  await writeJson(path.join(reportDirectory, "nfr-perf-006-database.json"), {
    decidingRun: deciding.iteration,
    runs,
  });
  return gate(
    "NFR-PERF-006",
    deciding.p95Ms <= 100 &&
      runs.every(
        (run) => run.repositoryApi.errorCount === 0 && run.repositoryApi.validationErrorCount === 0,
      ),
    {
      explainP95Ms: deciding.explain.p95Ms,
      p95Ms: deciding.p95Ms,
      repositoryApiErrors: deciding.repositoryApi.errorCount,
      repositoryApiP95Ms: deciding.repositoryApi.p95Ms,
      repositoryApiValidationErrors: deciding.repositoryApi.validationErrorCount,
    },
    { p95Ms: 100 },
    "Four critical queries retain 25 EXPLAIN ANALYZE repetitions and 25 sequential production API/repository calls each; median of three real runs decides.",
  );
}

async function processSnapshot(label) {
  const result = await compose.run(
    ["exec", "--no-TTY", "web", "/nodejs/bin/node", "docker/web-resource-snapshot.mjs"],
    { label: `resource-${label}` },
  );
  const container = await compose.serviceContainer("web");
  const inspect = await runner.run(
    "docker",
    ["inspect", "--format", "{{json .State}}", container],
    { label: `resource-state-${label}` },
  );
  return { label, ...JSON.parse(result.stdout), state: JSON.parse(inspect.stdout) };
}

async function soakGate(http, allocation) {
  const runs = [];
  for (let iteration = 1; iteration <= 3; iteration += 1) {
    const snapshots = [];
    const batches = [];
    for (let index = 0; index < 5; index += 1) {
      const weekStart = recordedWeekStart;
      const batchLabel = `run-${String(iteration)}-batch-${String(index + 1)}`;
      const key = runScopedKey(`soak-${String(iteration)}-${String(index + 1)}`);
      try {
        const sampled = await sampleOperationContinuously(
          () => invokeWeeklyBatch(http, weekStart, key),
          (phase) => processSnapshot(`${batchLabel}-${phase}`),
          { intervalMs: 1_000 },
        );
        snapshots.push(...sampled.snapshots);
        const retry = await invokeWeeklyBatch(http, weekStart, key);
        const database = await weeklyBatchDatabaseEvidence(weekStart);
        const entry = {
          database,
          durationMs: sampled.result.durationMs,
          result: sampled.result.body?.data,
          retryResult: retry.body?.data,
          stableRetry:
            JSON.stringify(sampled.result.body?.data) === JSON.stringify(retry.body?.data),
          weekStart,
        };
        batches.push({ ...entry, correct: assertWeeklyRunCorrect(entry) });
      } finally {
        await cleanupWeeklyOwnership(`${batchLabel}-cleanup`);
      }
    }
    runs.push({
      batches,
      iteration,
      resources: analyzeResourceRun(snapshots, allocation),
      snapshots,
    });
  }
  const deciding = medianRun(runs, (run) =>
    Math.max(
      run.resources.heap.peak / run.resources.heap.absoluteCeiling,
      run.resources.rss.peak / run.resources.rss.absoluteCeiling,
      run.resources.fileDescriptors.peak / run.resources.fileDescriptors.absoluteCeiling,
      run.resources.activeLibuvHandles.peak / run.resources.activeLibuvHandles.absoluteCeiling,
    ),
  );
  const everyBatchSucceeded = runs.every((run) => run.batches.every((batch) => batch.correct));
  const aggregateResources = analyzeResourceRun(
    runs.flatMap((run) => run.snapshots),
    allocation,
  );
  const bounded = aggregateResources.bounded && runs.every((run) => run.resources.bounded);
  await writeJson(path.join(reportDirectory, "nfr-perf-009-resource-soak.json"), {
    aggregateResources,
    bounded,
    decidingRun: deciding.iteration,
    everyBatchSucceeded,
    runs,
  });
  return gate(
    "NFR-PERF-009",
    bounded && everyBatchSucceeded,
    {
      aggregateResources,
      decidingRun: deciding.iteration,
      everyBatchSucceeded,
      resources: deciding.resources,
    },
    {
      activeLibuvHandleGrowth: "bounded final, peak, and trend growth",
      fileDescriptorGrowth: "bounded final, peak, and trend growth",
      heapGrowth: "bounded final, peak, and trend growth",
      rssGrowth: "bounded final, peak, and trend growth",
    },
    "Three runs of five successful 50-client batches with continuous in-batch, exact one-primary/two-worker process identity and container-wide aggregate V8 heap, RSS, file-descriptor, active-libuv, OOM, exact-retry, and database evidence; every run must remain below unchanged allocation-derived absolute and growth ceilings.",
  );
}

async function lighthouseGates(baseUrl) {
  expoDirectory = await mkdtemp(path.join(tmpdir(), "spotter-expo-performance-"));
  await runner.run(
    "corepack",
    [
      "pnpm",
      "--dir",
      "client-frontend",
      "exec",
      "expo",
      "export",
      "--platform",
      "web",
      "--output-dir",
      expoDirectory,
    ],
    {
      cwd: root,
      environment: { EXPO_PUBLIC_API_BASE_URL: "" },
      label: "expo-web-production-export",
    },
  );
  expoServer = await startExpoWebServer(expoDirectory, baseUrl);
  const targets = [
    {
      baseUrl,
      ready: { kind: "role", name: "Review queue", role: "heading" },
      route: "/queue",
      surface: "coach",
    },
    {
      baseUrl,
      ready: { kind: "role", name: "c_001", role: "heading" },
      route: `/clients/${clientId(1)}`,
      surface: "coach",
    },
    {
      baseUrl,
      ready: { kind: "role", name: "Programme content", role: "heading" },
      route: `/programmes/${corpusId("54000000", 50 * 100 + 99)}`,
      surface: "coach",
    },
    {
      baseUrl,
      ready: { kind: "role", name: "Context trace", role: "heading" },
      route: `/traces/${corpusId("51000000", 50)}`,
      surface: "coach",
    },
    {
      baseUrl: expoServer.baseUrl,
      ready: { kind: "role", name: "Today", role: "heading" },
      route: "/today",
      surface: "client",
    },
    {
      baseUrl: expoServer.baseUrl,
      ready: { kind: "label", name: "Session notes (optional)" },
      route: `/session/${corpusId("55000000", 1_121)}`,
      surface: "client",
    },
    {
      baseUrl: expoServer.baseUrl,
      ready: { kind: "role", name: "Check-in", role: "heading" },
      route: "/check-in",
      surface: "client",
    },
  ];
  const raw = await runLighthouseMatrix({
    clientBaseUrl: expoServer.baseUrl,
    onResult: async (summary, report) => {
      const safeRoute = summary.route.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "");
      await writeFile(
        path.join(
          reportDirectory,
          `lighthouse-${summary.surface}-${safeRoute}-${String(summary.iteration)}.json`,
        ),
        typeof report === "string" ? report : JSON.stringify(report),
        "utf8",
      );
    },
    targets,
  });
  const summarizeSurface = (surface) =>
    targets
      .filter((target) => target.surface === surface)
      .map((target) => {
        const runs = raw.filter(
          (entry) => entry.surface === surface && entry.route === target.route,
        );
        const deciding = selectLighthouseDecidingRun(runs);
        return {
          accessibilityScore: deciding.accessibilityScore,
          cls: deciding.cls,
          decidingRun: deciding.iteration,
          lcpMs: deciding.lcpMs,
          performanceScore: deciding.performanceScore,
          route: target.route,
          runs,
        };
      });
  const coach = summarizeSurface("coach");
  const client = summarizeSurface("client");
  await writeJson(path.join(reportDirectory, "nfr-perf-007-008-lighthouse.json"), {
    client,
    coach,
    raw,
  });
  return [
    gate(
      "NFR-PERF-007",
      coach.every(
        (entry) =>
          entry.runs.every((run) => run.loadedStateProof.valid) &&
          entry.performanceScore >= 90 &&
          entry.accessibilityScore >= 95 &&
          entry.lcpMs <= 2_500 &&
          entry.cls <= 0.1,
      ),
      coach,
      { accessibilityScore: 95, cls: 0.1, lcpMs: 2_500, performanceScore: 90 },
      "Desktop Lighthouse on queue, client detail, programme review, and trace; three runs/median.",
    ),
    gate(
      "NFR-PERF-008",
      client.every(
        (entry) =>
          entry.runs.every((run) => run.loadedStateProof.valid) &&
          entry.performanceScore >= 85 &&
          entry.accessibilityScore >= 95 &&
          entry.lcpMs <= 2_500 &&
          entry.cls <= 0.1,
      ),
      client,
      { accessibilityScore: 95, cls: 0.1, lcpMs: 2_500, performanceScore: 85 },
      "Mobile Lighthouse on production Expo-web Today, session, and check-in; three runs/median.",
    ),
  ];
}

async function scriptedReviewObservation(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const measurements = [];
  try {
    const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    for (let index = 1; index <= 50; index += 1) {
      const started = performance.now();
      const response = await page.goto(
        `${baseUrl}/programmes/${corpusId("54000000", index * 100 + 99)}`,
        { waitUntil: "networkidle" },
      );
      measurements.push({
        client: `c_${String(index).padStart(3, "0")}`,
        durationMs: performance.now() - started,
        status: response?.status() ?? 0,
      });
    }
  } finally {
    await browser.close();
  }
  const report = {
    automation: "scripted-navigation-only",
    humanValidated: false,
    note: "Observational only; this does not claim a coach completed the workflow.",
    reviewCount: measurements.length,
    targetDurationMs: 20 * 60 * 1_000,
    totalDurationMs: measurements.reduce((sum, value) => sum + value.durationMs, 0),
    measurements,
  };
  await writeJson(path.join(reportDirectory, "scripted-50-plan-review-observation.json"), report);
  return report;
}

function baselineGate(performanceGates, environment) {
  const evidence = baselineComparisons(performanceGates, baseline, {
    currentEnvironment: environment,
    recordBytes: baselineRecordBytes,
  });
  return gate(
    "NFR-PERF-010",
    evidence.valid && evidence.comparisons.every((comparison) => comparison.passed),
    evidence,
    { maximumRegressionFraction: baseline.maximumRegressionFraction },
    "Compared only with a reviewed, measured, provenance-bound release baseline; ceiling placeholders are rejected.",
  );
}

async function junit(gates) {
  const escape = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const cases = gates
    .map(
      (entry) =>
        `<testcase classname="spotter.performance" name="${escape(entry.id)}">${
          entry.passed
            ? ""
            : `<failure message="Performance budget failed">${escape(JSON.stringify(entry.actual))}</failure>`
        }</testcase>`,
    )
    .join("");
  await writeFile(
    path.join(reportDirectory, "performance.junit.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><testsuite name="spotter-performance" tests="${String(gates.length)}" failures="${String(gates.filter((entry) => !entry.passed).length)}">${cases}</testsuite>\n`,
    "utf8",
  );
}

let primaryError;
let reportDraft;
const cleanupErrors = [];
try {
  await mkdir(reportDirectory, { recursive: true });
  await prepareEnvironment();
  const cardinalities = await seedCorpus();
  const baseUrl = await startWebEnvironment();
  const environment = await environmentEvidence(baseUrl, cardinalities);
  const http = new HttpLoadRunner(baseUrl);
  await warmup(http);

  const gates = [];
  gates.push(await queueGate(http));
  gates.push(await readApiGate(http));
  gates.push(await mutationGate(http));
  gates.push(await singlePlanGate(http));
  await cleanupGeneratedOwnership({
    includeWeekly: false,
    label: "single-plan-post-measurement-cleanup",
  });
  assertZeroOwnedRows(
    await runOwnershipCounts("single-plan-post-measurement-residue"),
    "single-plan performance run",
  );
  gates.push(await weeklyBatchGate(http));
  gates.push(await databaseGate(http));
  gates.push(...(await lighthouseGates(baseUrl)));
  gates.push(await soakGate(http, environment.allocation));
  gates.push(baselineGate(gates, environment));
  const observation = await scriptedReviewObservation(baseUrl);
  await junit(gates);
  const sourceAfter = await sourceState();
  const source = assertExactSourceState(sourceBefore, sourceAfter);
  const baselineCandidate = createBaselineCandidate(gates, environment, source.before, {
    execution,
    sourceAfter: source.after,
  });
  await writeJson(path.join(reportDirectory, "baseline-candidate.json"), baselineCandidate);
  reportDraft = {
    baseline,
    baselineCandidate,
    commands: runner.results,
    environment,
    execution,
    gates,
    observation,
    profile,
    project,
    schemaVersion: 2,
    source,
  };
  if (failures.length > 0) {
    throw new Error(`Performance gates failed: ${failures.map((entry) => entry.id).join(", ")}`);
  }
} catch (error) {
  primaryError = error;
} finally {
  if (primaryError !== undefined && ownsCompose) {
    try {
      const logs = await compose.run(["logs", "--no-color", "--timestamps"], {
        allowFailure: true,
        label: "failure-container-logs",
      });
      if (logs.exitCode !== 0) {
        cleanupErrors.push({
          error: new Error(`Failure container-log capture exited with ${String(logs.exitCode)}.`),
          phase: "failure-container-logs",
        });
      }
    } catch (error) {
      cleanupErrors.push({ error, phase: "failure-container-logs" });
    }
  }
  if (runOwnershipLease.acquired) {
    try {
      await cleanupRunDatabase();
    } catch (error) {
      cleanupErrors.push({ error, phase: "performance-database-cleanup" });
    }
  }
  if (weeklyOwnershipLease.acquired) {
    try {
      await cleanupWeeklyOwnership("performance-weekly-final-cleanup");
    } catch (error) {
      cleanupErrors.push({ error, phase: "performance-weekly-database-cleanup" });
    }
  }
  if (standardCorpusLease.acquired) {
    try {
      await cleanupStandardCorpus();
    } catch (error) {
      cleanupErrors.push({ error, phase: "standard-corpus-cleanup" });
    }
  }
  try {
    await expoServer?.close();
  } catch (error) {
    cleanupErrors.push({ error, phase: "expo-server-close" });
  }
  if (expoDirectory !== undefined) {
    try {
      await rm(expoDirectory, { force: true, recursive: true });
    } catch (error) {
      cleanupErrors.push({ error, phase: "expo-directory-remove" });
    }
  }
  if (ownsCompose) {
    try {
      await compose.teardown();
    } catch (error) {
      cleanupErrors.push({ error, phase: "compose-teardown" });
    }
  }
}

const serializedErrors = [
  ...(primaryError === undefined ? [] : [{ error: primaryError, phase: "execution" }]),
  ...cleanupErrors,
].map((entry) => ({
  error: serializeError(entry.error, [postgresAdminPassword, postgresAppPassword, cronSecret]),
  phase: entry.phase,
}));
try {
  await writeJson(path.join(reportDirectory, "commands.json"), runner.results);
} catch (error) {
  cleanupErrors.push({ error, phase: "commands-evidence-write" });
  serializedErrors.push({
    error: serializeError(error, [postgresAdminPassword, postgresAppPassword, cronSecret]),
    phase: "commands-evidence-write",
  });
}
if (reportDraft !== undefined) {
  await writeJson(path.join(reportDirectory, "performance-report.json"), {
    ...reportDraft,
    cleanup: {
      errors: serializedErrors.filter((entry) => entry.phase !== "execution"),
      passed: cleanupErrors.length === 0,
    },
    finishedAt: new Date().toISOString(),
    verdict: finalPerformanceVerdict(profile, reportDraft.gates, serializedErrors),
  });
}
if (serializedErrors.length > 0) {
  await writeJson(path.join(reportDirectory, "performance-failure.json"), {
    commands: runner.results,
    errors: serializedErrors,
    failedAt: new Date().toISOString(),
    failures,
    execution,
    profile,
    project,
    schemaVersion: 2,
  });
}
process.stdout.write(`Performance evidence: ${reportDirectory}\n`);
if (primaryError !== undefined) throw primaryError;
if (cleanupErrors.length > 0) {
  throw new AggregateError(
    cleanupErrors.map((entry) => entry.error),
    `Performance cleanup/evidence finalization failed: ${cleanupErrors.map((entry) => entry.phase).join(", ")}`,
  );
}
