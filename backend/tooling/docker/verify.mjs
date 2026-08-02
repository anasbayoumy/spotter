import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ComposeProject,
  EvidenceCommandRunner,
  assertProjectScopedVolume,
  assertTestPostgresVolumeConfiguration,
  createQaIdentity,
  expectedProjectVolumeName,
  hashWorkspace,
  parseJsonRecords,
  redact,
  resolveEvidenceDirectory,
  serializeError,
  sha256,
  stopServiceGracefully,
  teardownProjectAfterFailure,
  waitFor,
  writeJson,
} from "./lib.mjs";
import {
  assertDrainProof,
  runLiveDatabaseFaultProof,
  runLiveSecurityHttpProof,
  startDeferredJsonRequest,
} from "./live-project-proof.mjs";
import { scanRuntimeLogs } from "./log-scan.mjs";
import {
  assertComposeRuntimeHealth,
  assertEmptyDatabase,
  assertRestartPersistence,
  assertRunningBuiltImage,
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
import { RecordedHttpFlow, runRequiredSmokeFlow } from "./smoke-flow.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const trivyImage =
  "aquasec/trivy:0.67.2@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08";
const imageSecretScanProgram = String.raw`
const fs = require("fs");
const path = require("path");
const findings = [];
const contentRules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["provider-key", /\bsk-[A-Za-z0-9_-]{20,}\b/u],
  [
    "credential-database-url",
    /postgres(?:ql)?:\/\/[^:\s/@]+:(?!spotter_local_only@)[^@\s/]+@/iu,
  ],
];
const filenameRule = /(^|\/)(?:\.env(?:\.|$)|id_rsa$)|\.(?:pem|key)$/u;
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(file);
      continue;
    }
    if (!entry.isFile()) continue;
    if (filenameRule.test(file)) findings.push({ path: file, rule: "secret-filename" });
    const content = fs.readFileSync(file).toString("utf8");
    for (const [rule, pattern] of contentRules) {
      if (pattern.test(content)) findings.push({ path: file, rule });
    }
  }
}
walk("/app");
process.stdout.write(JSON.stringify(findings));`;
const identity = createQaIdentity("docker");
const project = identity.project;
const parentRun = process.env.SPOTTER_VERIFICATION_RUN_ID;
const reportDirectory = await resolveEvidenceDirectory(
  root,
  process.env.SPOTTER_DOCKER_REPORT_DIR,
  parentRun === undefined
    ? path.join(root, "artifacts", "verification", `${identity.runId}-docker`)
    : path.join(root, "artifacts", "verification", parentRun, "docker"),
);
const commandDirectory = path.join(reportDirectory, "commands");
const postgresAdminPassword = `qa-admin-${randomBytes(18).toString("hex")}`;
const postgresAppPassword = `qa-app-${randomBytes(18).toString("hex")}`;
const cronSecret = `qa-cron-${randomBytes(18).toString("hex")}`;
const environment = {
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
  WEB_PORT: "0",
};
const secrets = [postgresAdminPassword, postgresAppPassword, cronSecret];
const runner = new EvidenceCommandRunner(commandDirectory, { environment, secrets });
const compose = new ComposeProject(project, runner, environment);
const steps = [];
let protocolError;
let teardownComplete = false;
let webPort;
let baseUrl;
let smoke;
let builtImages = [];
let teardownFailure;

async function writeMigrationJunit(error) {
  await writeFile(
    path.join(reportDirectory, "migration.junit.xml"),
    junitDocument({
      ...(error === undefined ? {} : { failure: serializeError(error, secrets).message }),
      suite: "spotter.docker.migration",
      test: "empty-postgres-to-current-schema",
    }),
    "utf8",
  );
}

async function step(id, operation) {
  const startedAt = new Date();
  try {
    const evidence = await operation();
    steps.push({
      durationMs: Date.now() - startedAt.getTime(),
      evidence,
      finishedAt: new Date().toISOString(),
      id,
      startedAt: startedAt.toISOString(),
      status: "pass",
    });
    await writeJson(path.join(reportDirectory, "protocol-progress.json"), {
      project,
      schemaVersion: 1,
      steps,
    });
    return evidence;
  } catch (error) {
    if (id === "QA-DKR-005") await writeMigrationJunit(error);
    steps.push({
      durationMs: Date.now() - startedAt.getTime(),
      error: serializeError(error, secrets).message,
      failure: serializeError(error, secrets),
      finishedAt: new Date().toISOString(),
      id,
      startedAt: startedAt.toISOString(),
      status: "fail",
    });
    await writeJson(path.join(reportDirectory, "protocol-progress.json"), {
      project,
      schemaVersion: 1,
      steps,
    });
    throw error;
  }
}

async function psql(sql, options = {}) {
  return compose.run(
    [
      "exec",
      "--no-TTY",
      "--env",
      `PGPASSWORD=${options.admin === true ? postgresAdminPassword : postgresAppPassword}`,
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
    { input: sql, label: options.label ?? "postgres-query" },
  );
}

async function waitForHealth(route, expectedStatus = 200, timeoutMs = 60_000, evidenceName) {
  const transcript = [];
  try {
    const result = await waitFor(
      `${route} HTTP ${String(expectedStatus)}`,
      async () => {
        const startedAt = new Date();
        try {
          const response = await fetch(`${baseUrl}${route}`, {
            headers: { connection: "close" },
            signal: AbortSignal.timeout(2_000),
          });
          const body = await response.text();
          transcript.push({
            body,
            finishedAt: new Date().toISOString(),
            startedAt: startedAt.toISOString(),
            status: response.status,
            url: `${baseUrl}${route}`,
          });
          return response.status === expectedStatus ? { body, status: response.status } : false;
        } catch (error) {
          transcript.push({
            error: error instanceof Error ? error.message : String(error),
            finishedAt: new Date().toISOString(),
            startedAt: startedAt.toISOString(),
            status: 0,
            url: `${baseUrl}${route}`,
          });
          return false;
        }
      },
      { timeoutMs },
    );
    const evidence = { result, route, transcript };
    if (evidenceName !== undefined) {
      await writeJson(path.join(reportDirectory, evidenceName), evidence);
    }
    return evidence;
  } catch (error) {
    if (evidenceName !== undefined) {
      await writeJson(path.join(reportDirectory, evidenceName), {
        failure: serializeError(error, secrets),
        route,
        transcript,
      });
    }
    throw error;
  }
}

async function databaseSnapshot(label) {
  const tablesResult = await psql(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;\n",
    { label: `${label}-tables` },
  );
  const tables = tablesResult.stdout.split("\n").filter(Boolean);
  const snapshot = {};
  for (const table of tables) {
    if (!/^[a-z][a-z0-9_]*$/u.test(table)) throw new Error(`Unsafe table name: ${table}`);
    const result = await psql(
      `SELECT jsonb_build_object(
        'count', count(*),
        'hash', md5(coalesce(string_agg(to_jsonb(row_value)::text, '' ORDER BY to_jsonb(row_value)::text), ''))
      ) FROM ${table} AS row_value;\n`,
      { label: `${label}-${table}` },
    );
    snapshot[table] = JSON.parse(result.stdout.trim());
  }
  await writeJson(path.join(reportDirectory, `${label}.json`), snapshot);
  return snapshot;
}

async function isolatedDatabaseSuite(name, packageScript) {
  const database = `spotter_${name}_${randomBytes(3).toString("hex")}`;
  if (!/^spotter_[a-z]+_[a-f0-9]{6}$/u.test(database))
    throw new Error("Unsafe suite database name.");
  await psql(`CREATE DATABASE ${database} OWNER spotter_app;\n`, {
    admin: true,
    label: `${name}-database-create`,
  });
  try {
    await psql("CREATE EXTENSION IF NOT EXISTS vector;\n", {
      admin: true,
      database,
      label: `${name}-database-vector-extension`,
    });
    const postgresPort = await compose.mappedPort("test-postgres", 5432);
    return await runner.run("corepack", ["pnpm", "--dir", "backend", "run", packageScript], {
      cwd: root,
      environment: {
        AI_MODE: "recorded",
        APP_ENV: "test",
        DATABASE_MODE: "postgres",
        DATABASE_URL: `postgresql://spotter_app:${postgresAppPassword}@127.0.0.1:${String(postgresPort)}/${database}`,
        DATA_POLICY: "synthetic_only",
      },
      label: `${name}-suite`,
    });
  } finally {
    await psql(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${database}' AND pid<>pg_backend_pid();\nDROP DATABASE ${database};\n`,
      { admin: true, label: `${name}-database-drop` },
    );
  }
}

async function inspectBuiltImages(services) {
  const images = [];
  for (const service of services) {
    if (!/^[a-z][a-z0-9-]*$/u.test(service)) throw new Error(`Unsafe service: ${service}`);
    const repository = `${project}-${service}:latest`;
    const result = await runner.run("docker", ["image", "inspect", repository], {
      label: `built-image-${service}`,
    });
    const [inspect] = JSON.parse(result.stdout);
    if (typeof inspect?.Id !== "string" || !inspect.Id.startsWith("sha256:")) {
      throw new Error(`Built image identity is missing for ${service}.`);
    }
    images.push({
      Created: inspect.Created,
      ID: inspect.Id,
      Repository: repository,
      RepoDigests: inspect.RepoDigests ?? [],
      Service: service,
      Size: inspect.Size,
    });
  }
  return images;
}

function parseBuildContextBytes(output) {
  const scale = { B: 1, GB: 1_000_000_000, kB: 1_000, MB: 1_000_000 };
  const values = [...output.matchAll(/transferring context:\s*([\d.]+)(B|kB|MB|GB)/gu)].map(
    (match) => Number(match[1]) * scale[match[2]],
  );
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("BuildKit output did not contain measurable build-context evidence.");
  }
  return { maximumBytes: Math.max(...values), observationsBytes: values };
}

function builtWebImageId() {
  const imageId = builtImages.find((image) => image.Service === "web")?.ID;
  if (typeof imageId !== "string" || !imageId.startsWith("sha256:")) {
    throw new Error("Freshly built web image identity is unavailable.");
  }
  return imageId;
}

async function assertProjectRemoved(labelPrefix) {
  const resources = await compose.assertNoOwnedResources(labelPrefix);
  const testDatabaseVolume = expectedProjectVolumeName(project, "spotter-test-postgres");
  const removedVolume = await runner.run("docker", ["volume", "inspect", testDatabaseVolume], {
    allowFailure: true,
    label: `${labelPrefix}-test-volume-absence`,
  });
  if (removedVolume.exitCode === 0) {
    throw new Error(`Validated QA teardown left ${testDatabaseVolume} behind.`);
  }
  return { removedVolume: testDatabaseVolume, resources };
}

async function scanRuntimeEvidence(results, evidenceFile, options = {}) {
  const sources = [];
  for (const result of results) {
    const text = await readFile(path.join(commandDirectory, result.log), "utf8");
    const findings = scanRuntimeLogs(text, {
      expectedWarningRequestIds: options.expectedWarningRequestIds,
    }).map((finding) => ({ ...finding, source: result.log }));
    sources.push({
      findings,
      log: result.log,
      sensitiveMatches: result.sensitiveMatchCount,
    });
  }
  const report = {
    findings: sources.flatMap((source) => source.findings),
    sensitiveMatches: sources.reduce((total, source) => total + source.sensitiveMatches, 0),
    sources,
  };
  await writeJson(path.join(reportDirectory, evidenceFile), report);
  if (report.findings.length > 0 || report.sensitiveMatches > 0) {
    throw new Error(
      `Container/log scan failed: ${JSON.stringify({
        findings: report.findings,
        sensitiveMatches: report.sensitiveMatches,
      })}`,
    );
  }
  return report;
}

async function gracefulTeardown() {
  const targets = await compose.assertOwnedResources();
  await writeJson(path.join(reportDirectory, "teardown-targets.json"), targets);
  const requestId = "docker-live-sigterm-drain-v1";
  const drain = startDeferredJsonRequest(baseUrl, {
    body: {
      body: "Synthetic SIGTERM drain check-in.",
      clientId: "00000000-0000-4000-8000-000000000102",
      readiness: 4,
      respondedAt: "2026-08-02T11:00:00.000Z",
    },
    idempotencyKey: requestId,
    path: "/api/v1/check-ins",
    requestId,
  });
  await drain.connected;
  let postStopRejected = false;
  let postStopRejectedAt;
  let stopStartedAt;
  const stopped = await stopServiceGracefully({
    compose,
    async duringStop() {
      stopStartedAt = Date.now();
      try {
        postStopRejectedAt = await waitFor(
          "web listener to reject new work after SIGTERM",
          async () => {
            try {
              await fetch(`${baseUrl}/health/live`, {
                headers: { connection: "close" },
                signal: AbortSignal.timeout(1_000),
              });
              return false;
            } catch {
              postStopRejected = true;
              return Date.now();
            }
          },
          { maximumDelayMs: 500, timeoutMs: 10_000 },
        );
      } finally {
        drain.finish();
      }
    },
    runner,
    service: "web",
    timeoutSeconds: 20,
  });
  const outcome = await drain.outcome;
  const drainEvidence = {
    outcome,
    postStopRejected,
    postStopRejectedAt,
    requestId,
    stopStartedAt,
  };
  await writeJson(path.join(reportDirectory, "sigterm-drain-proof.json"), drainEvidence);
  assertDrainProof(drainEvidence);
  const postDrainLogs = await compose.run(["logs", "--no-color", "--timestamps"], {
    label: "post-drain-container-logs",
  });
  await scanRuntimeEvidence([postDrainLogs], "post-drain-log-scan-report.json", {
    expectedWarningRequestIds: ["docker-live-db-fault-v1"],
  });
  await compose.teardown();
  const removed = await assertProjectRemoved("post-teardown");
  teardownComplete = true;
  return {
    drain: drainEvidence,
    durationMs: stopped.durationMs,
    removedVolume: removed.removedVolume,
    removedResources: removed.resources,
    state: stopped.state,
    stoppedContainer: stopped.container,
    targets,
  };
}

try {
  await step("QA-DKR-001", async () => {
    const [
      dockerVersion,
      composeVersion,
      nodeVersion,
      corepackVersion,
      pnpmVersion,
      architecture,
      git,
      workspace,
    ] = await Promise.all([
      runner.run("docker", ["version", "--format", "{{json .}}"], { label: "docker-version" }),
      runner.run("docker", ["compose", "version", "--short"], { label: "compose-version" }),
      runner.run(process.execPath, ["--version"], { label: "node-version" }),
      runner.run("corepack", ["--version"], { label: "corepack-version" }),
      runner.run("corepack", ["pnpm", "--version"], { label: "pnpm-version" }),
      runner.run("uname", ["-m", "-s"], { label: "host-architecture" }),
      runner.run("git", ["rev-parse", "HEAD"], { cwd: root, label: "git-revision" }),
      hashWorkspace(root),
    ]);
    const rendered = await compose.run(["config"], { label: "compose-rendered" });
    await writeFile(
      path.join(reportDirectory, "compose.rendered.yaml"),
      redact(rendered.stdout, secrets),
      "utf8",
    );
    const evidence = {
      architecture: architecture.stdout.trim(),
      compose: composeVersion.stdout.trim(),
      corepack: corepackVersion.stdout.trim(),
      docker: JSON.parse(dockerVersion.stdout),
      git: git.stdout.trim(),
      node: nodeVersion.stdout.trim(),
      pnpm: pnpmVersion.stdout.trim(),
      project,
      runId: identity.runId,
      schemaVersion: 1,
      workspace,
    };
    await writeJson(path.join(reportDirectory, "environment.json"), evidence);
    return evidence;
  });

  await step("QA-DKR-002", async () => {
    const harnessRegressions = await runner.run(
      process.execPath,
      [
        "--test",
        "docker/web-cluster.test.mjs",
        "docker/web-resource-snapshot.test.mjs",
        "backend/tooling/docker/lib.test.mjs",
        "backend/tooling/docker/live-project-proof.test.mjs",
        "backend/tooling/docker/log-scan.test.mjs",
        "backend/tooling/docker/protocol-assertions.test.mjs",
        "backend/tooling/docker/smoke-flow.test.mjs",
        "backend/tooling/performance/statistics.test.mjs",
      ],
      { cwd: root, label: "docker-harness-regressions" },
    );
    await compose.run(["config", "--quiet"], { label: "compose-config-validation" });
    const storageConfigResult = await compose.run(["config", "--format", "json"], {
      label: "compose-storage-topology",
    });
    const storage = assertTestPostgresVolumeConfiguration(JSON.parse(storageConfigResult.stdout));
    const services = await compose.run(["config", "--services"], { label: "compose-topology" });
    const actual = services.stdout.split("\n").filter(Boolean).sort();
    const expected = ["migrate", "postgres", "seed", "test-postgres", "web"];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Unexpected Compose topology: ${JSON.stringify(actual)}`);
    }
    if (actual.some((service) => ["backend", "broker", "worker"].includes(service))) {
      throw new Error("Compose contains a forbidden second backend/broker/worker service.");
    }
    const dockerignore = await readFile(path.join(root, ".dockerignore"), "utf8");
    const patterns = new Set(
      dockerignore
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#")),
    );
    const requiredRecursiveExclusions = [
      "**/.cache",
      "**/.expo",
      "**/.next",
      "**/coverage",
      "**/dist",
      "**/node_modules",
      "**/reports",
      "**/test-results",
      "**/*.tsbuildinfo",
    ];
    const missingExclusions = requiredRecursiveExclusions.filter(
      (pattern) => !patterns.has(pattern),
    );
    if (missingExclusions.length > 0) {
      throw new Error(`Docker context is missing exclusions: ${missingExclusions.join(", ")}`);
    }
    if ([...patterns].some((pattern) => pattern.startsWith("!"))) {
      throw new Error("Docker context contains a negated exclusion that requires explicit review.");
    }
    return {
      actual,
      expected,
      harnessRegressionExitCode: harnessRegressions.exitCode,
      requiredRecursiveExclusions,
      storage,
    };
  });

  await step("QA-DKR-003", async () => {
    const build = await compose.run(["build", "--pull", "--no-cache", "migrate", "seed", "web"], {
      environment: { BUILDKIT_PROGRESS: "plain" },
      label: "clean-production-build",
      stream: true,
    });
    const buildOutput = `${build.stdout}\n${build.stderr}`;
    if (!buildOutput.includes("--frozen-lockfile")) {
      throw new Error("Clean build did not retain proof of the frozen-lockfile install.");
    }
    const buildContext = parseBuildContextBytes(buildOutput);
    if (buildContext.maximumBytes > 100_000_000) {
      throw new Error(
        `Docker build context exceeded 100 MB (${String(buildContext.maximumBytes)} bytes).`,
      );
    }
    const required = ["migrate", "seed", "web"];
    builtImages = await inspectBuiltImages(required);
    await writeJson(path.join(reportDirectory, "images.json"), builtImages);
    return { buildContext, images: builtImages };
  });

  await step("QA-DKR-004", async () => {
    await compose.run(["up", "--detach", "--wait", "--wait-timeout", "120", "test-postgres"], {
      label: "empty-postgres-start",
    });
    const container = await compose.serviceContainer("test-postgres");
    const inspect = await runner.run("docker", ["inspect", container], {
      label: "postgres-inspect",
    });
    const sql = await psql(
      `SELECT jsonb_build_object(
        'database', current_database(),
        'majorVersion', current_setting('server_version_num')::integer / 10000,
        'publicTables', (SELECT count(*) FROM pg_tables WHERE schemaname='public'),
        'appRole', (SELECT jsonb_build_object('canLogin', rolcanlogin, 'isSuperuser', rolsuper) FROM pg_roles WHERE rolname='spotter_app'),
        'vectorVersion', (SELECT extversion FROM pg_extension WHERE extname='vector')
      );\n`,
      { admin: true, label: "postgres-authority-assertions" },
    );
    const assertions = JSON.parse(sql.stdout.trim());
    assertEmptyDatabase(assertions);
    if (
      assertions.database !== "spotter" ||
      assertions.majorVersion !== 16 ||
      assertions.appRole?.canLogin !== true ||
      assertions.appRole?.isSuperuser !== false ||
      typeof assertions.vectorVersion !== "string"
    ) {
      throw new Error(`PostgreSQL authority assertion failed: ${JSON.stringify(assertions)}`);
    }
    const containerInspect = JSON.parse(inspect.stdout)[0];
    const expectedVolume = expectedProjectVolumeName(project, "spotter-test-postgres");
    const dataMounts = containerInspect.Mounts.filter(
      (mount) => mount.Destination === "/var/lib/postgresql/data",
    );
    if (
      dataMounts.length !== 1 ||
      dataMounts[0].Type !== "volume" ||
      dataMounts[0].Name !== expectedVolume
    ) {
      throw new Error(`Unexpected test PostgreSQL PGDATA mount: ${JSON.stringify(dataMounts)}`);
    }
    const volumeResult = await runner.run("docker", ["volume", "inspect", expectedVolume], {
      label: "test-postgres-volume-inspect",
    });
    const storage = assertProjectScopedVolume(
      JSON.parse(volumeResult.stdout)[0],
      project,
      "spotter-test-postgres",
    );
    await writeJson(path.join(reportDirectory, "postgres-authority.json"), assertions);
    return { assertions, inspect: containerInspect.State, storage };
  });

  await step("QA-DKR-005", async () => {
    const migration = await compose.run(["run", "--no-deps", "--rm", "migrate"], {
      label: "one-shot-migration",
    });
    const migrationFiles = (await readdir(path.join(root, "backend", "migrations")))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const localHashes = [];
    for (const file of migrationFiles) {
      const source = await readFile(path.join(root, "backend", "migrations", file));
      localHashes.push({ file, hash: sha256(source) });
    }
    const applied = await psql(
      "SELECT coalesce(jsonb_agg(hash ORDER BY created_at), '[]'::jsonb) FROM drizzle.__drizzle_migrations;\n",
      { label: "migration-checksums" },
    );
    const appliedHashes = JSON.parse(applied.stdout.trim());
    if (
      appliedHashes.length !== localHashes.length ||
      localHashes.some((entry) => !appliedHashes.includes(entry.hash))
    ) {
      throw new Error("Committed migration checksums do not match the authoritative database.");
    }
    const inventory = await psql(
      `SELECT jsonb_build_object(
        'tables', (SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'),
        'indexes', (SELECT jsonb_agg(indexname ORDER BY indexname) FROM pg_indexes WHERE schemaname='public'),
        'constraints', (SELECT jsonb_agg(conname ORDER BY conname) FROM pg_constraint WHERE connamespace='public'::regnamespace)
      );\n`,
      { label: "schema-inventory" },
    );
    const schema = JSON.parse(inventory.stdout.trim());
    const requiredTables = [
      "accountability_states",
      "adjustments",
      "agent_runs",
      "check_ins",
      "clients",
      "coach_actions",
      "context_traces",
      "eval_results",
      "idempotency_records",
      "programmes",
      "sessions",
    ];
    if (requiredTables.some((table) => !schema.tables.includes(table))) {
      throw new Error("Authoritative schema is missing required tables.");
    }
    if (
      !schema.indexes.includes("client_notes_embedding_hnsw_idx") ||
      schema.constraints.length < 40
    ) {
      throw new Error("Authoritative schema index/constraint inventory is incomplete.");
    }
    await writeJson(path.join(reportDirectory, "migration-report.json"), {
      appliedHashes,
      exitCode: migration.exitCode,
      localHashes,
      schema,
    });
    await writeMigrationJunit();
    return {
      applied: appliedHashes.length,
      constraints: schema.constraints.length,
      tables: schema.tables.length,
    };
  });

  await step("QA-DKR-006", async () => {
    await compose.run(["run", "--no-deps", "--rm", "seed"], { label: "seed-first" });
    const first = await databaseSnapshot("seed-first-snapshot");
    await compose.run(["run", "--no-deps", "--rm", "seed"], { label: "seed-second" });
    const second = await databaseSnapshot("seed-second-snapshot");
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      throw new Error("Second seed changed logical row counts/identities/content.");
    }
    const classification = await psql(
      "SELECT jsonb_build_object('nonSynthetic', count(*) FILTER (WHERE data_classification<>'synthetic'), 'synthetic', count(*) FILTER (WHERE data_classification='synthetic')) FROM clients;\n",
      { label: "seed-classification" },
    );
    const counts = JSON.parse(classification.stdout.trim());
    if (counts.nonSynthetic !== 0 || counts.synthetic !== 7) {
      throw new Error(`Seed classification is unsafe: ${JSON.stringify(counts)}`);
    }
    return { classification: counts, stable: true };
  });

  await step("QA-DKR-007", async () => {
    await compose.run(["up", "--detach", "--no-deps", "--wait", "--wait-timeout", "180", "web"], {
      label: "production-web-start",
    });
    webPort = await compose.mappedPort("web", 3000);
    baseUrl = `http://127.0.0.1:${String(webPort)}`;
    const live = await waitForHealth("/health/live");
    const ready = await waitForHealth("/health/ready");
    const readyBody = JSON.parse(ready.result.body);
    if (
      readyBody.dependencies?.database !== "ready" ||
      readyBody.dependencies?.schema !== "ready"
    ) {
      throw new Error("Readiness did not include database/schema state.");
    }
    const processSnapshot = await compose.run(
      ["exec", "--no-TTY", "web", "/nodejs/bin/node", "docker/web-resource-snapshot.mjs"],
      { label: "web-cluster-topology" },
    );
    const topology = JSON.parse(processSnapshot.stdout);
    if (
      topology.primary?.role !== "primary" ||
      topology.workerCount !== 2 ||
      topology.processCount !== 3 ||
      topology.workers?.map((worker) => worker.slot).join(",") !== "1,2"
    ) {
      throw new Error(
        "Production web cluster does not contain exactly one primary and two workers.",
      );
    }
    await writeJson(path.join(reportDirectory, "health-transcript.json"), {
      live,
      processTopology: topology,
      ready,
    });
    const container = await compose.serviceContainer("web");
    const inspect = await runner.run("docker", ["inspect", container], { label: "web-inspect" });
    const containerInspect = JSON.parse(inspect.stdout)[0];
    assertRunningBuiltImage(containerInspect, builtWebImageId());
    if (
      containerInspect.State?.Running !== true ||
      containerInspect.State?.Health?.Status !== "healthy"
    ) {
      throw new Error("Production web container is not running and healthy.");
    }
    return {
      baseUrl,
      image: containerInspect.Image,
      state: containerInspect.State,
      workerCount: topology.workerCount,
    };
  });

  await step("QA-DKR-008", async () => {
    smoke = await runRequiredSmokeFlow({
      baseUrl,
      query: (sql, label) => psql(`${sql}\n`, { label }),
    });
    await writeJson(path.join(reportDirectory, "required-smoke-flow.json"), smoke);
    return { fixtures: smoke.fixtures, requests: smoke.transcript.length };
  });

  await step("QA-DKR-009", async () => {
    const suites = [];
    let liveSecurity;
    try {
      liveSecurity = await runLiveSecurityHttpProof({ baseUrl });
    } catch (error) {
      if (error?.evidence !== undefined) {
        await writeJson(path.join(reportDirectory, "live-security-http-proof.json"), {
          ...error.evidence,
          failure: serializeError(error, secrets),
        });
      }
      throw error;
    }
    await writeJson(path.join(reportDirectory, "live-security-http-proof.json"), liveSecurity);
    suites.push(await isolatedDatabaseSuite("integration", "test:integration"));
    suites.push(await isolatedDatabaseSuite("concurrency", "test:concurrency"));
    suites.push(
      await runner.run("corepack", ["pnpm", "--dir", "backend", "run", "test:safety"], {
        cwd: root,
        environment: { AI_MODE: "recorded", APP_ENV: "test", DATA_POLICY: "synthetic_only" },
        label: "safety-50-suite",
      }),
    );
    suites.push(
      await runner.run("corepack", ["pnpm", "exec", "turbo", "run", "test:security"], {
        cwd: root,
        environment: {
          PLAYWRIGHT_BASE_URL: baseUrl,
          SPOTTER_TEST_BASE_URL: baseUrl,
        },
        label: "security-http-suite",
      }),
    );
    suites.push(
      await runner.run("corepack", ["pnpm", "exec", "turbo", "run", "test:resilience"], {
        cwd: root,
        environment: {
          PLAYWRIGHT_BASE_URL: baseUrl,
          SPOTTER_TEST_BASE_URL: baseUrl,
        },
        label: "relevant-resilience-suite",
      }),
    );
    const performance = separatePerformanceGateEvidence();
    let liveDatabaseFault;
    try {
      liveDatabaseFault = await runLiveDatabaseFaultProof({
        baseUrl,
        startDatabase: () =>
          compose.run(["start", "test-postgres"], { label: "live-fault-postgres-start" }),
        stopDatabase: () =>
          compose.run(["stop", "--timeout", "20", "test-postgres"], {
            label: "live-fault-postgres-stop",
          }),
        waitForDatabase: () =>
          waitFor(
            "PostgreSQL health after live fault",
            async () => {
              const status = await compose.run(["ps", "--format", "json", "test-postgres"], {
                allowFailure: true,
                label: "live-fault-postgres-health",
              });
              return status.exitCode === 0 && status.stdout.includes('"Health":"healthy"');
            },
            { timeoutMs: 60_000 },
          ),
      });
    } catch (error) {
      if (error?.evidence !== undefined) {
        await writeJson(path.join(reportDirectory, "live-database-fault-proof.json"), {
          ...error.evidence,
          failure: serializeError(error, secrets),
        });
      }
      throw error;
    }
    await writeJson(
      path.join(reportDirectory, "live-database-fault-proof.json"),
      liveDatabaseFault,
    );
    await writeJson(
      path.join(reportDirectory, "linked-suite-reports.json"),
      suites.map((suite) => ({
        command: suite.command,
        durationMs: suite.durationMs,
        exitCode: suite.exitCode,
        log: suite.log,
      })),
    );
    return {
      liveDatabaseFault: true,
      liveSecurityProbes: liveSecurity.length,
      performance,
      suites: suites.length,
    };
  });

  await step("QA-DKR-010", async () => {
    const before = await databaseSnapshot("restart-state-before");
    const webContainerBefore = await compose.serviceContainer("web");
    const webPortBefore = webPort;
    await compose.run(["restart", "--timeout", "20", "web"], { label: "restart-web" });
    const webContainerAfter = await compose.serviceContainer("web");
    webPort = await compose.mappedPort("web", 3000);
    baseUrl = `http://127.0.0.1:${String(webPort)}`;
    const webRecovery = await waitForHealth(
      "/health/ready",
      200,
      60_000,
      "restart-web-health-transcript.json",
    );
    await compose.run(["restart", "--timeout", "20", "test-postgres"], {
      label: "restart-postgres",
    });
    await waitFor(
      "PostgreSQL health after restart",
      async () => {
        const inspect = await compose.run(["ps", "--format", "json", "test-postgres"], {
          allowFailure: true,
          label: "postgres-recovery-probe",
        });
        return inspect.exitCode === 0 && inspect.stdout.includes('"Health":"healthy"');
      },
      { timeoutMs: 60_000 },
    );
    const postgresRecovery = await waitForHealth(
      "/health/ready",
      200,
      60_000,
      "restart-postgres-health-transcript.json",
    );
    const after = await databaseSnapshot("restart-state-after");
    const replay = new RecordedHttpFlow(baseUrl);
    const actualReplay = await replay.request(
      "post-restart-idempotency-replay",
      smoke.replaySpecifications.accountability,
    );
    const records = await psql(
      "SELECT count(*) FROM idempotency_records WHERE operation_scope='accountability.run' AND key='docker-smoke-accountability-v1';\n",
      { label: "post-restart-idempotency-count" },
    );
    const expectedReplay = smoke.transcript.find((entry) => entry.label === "accountability-first")
      ?.response?.data;
    const persistence = assertRestartPersistence({
      actualReplay,
      after,
      before,
      expectedReplay,
      idempotencyRecords: Number(records.stdout.trim()),
    });
    await writeJson(path.join(reportDirectory, "restart-recovery.json"), {
      after,
      before,
      persistence,
      postgresRecovery,
      replay: replay.transcript,
      webConnection: {
        containerAfter: webContainerAfter,
        containerBefore: webContainerBefore,
        containerStable: webContainerAfter === webContainerBefore,
        portAfter: webPort,
        portBefore: webPortBefore,
        portChanged: webPort !== webPortBefore,
      },
      webRecovery,
    });
    return persistence;
  });

  await step("QA-DKR-011", async () => {
    const ps = await compose.run(["ps", "--all", "--format", "json"], {
      label: "final-compose-health",
    });
    const logs = await compose.run(["logs", "--no-color", "--timestamps"], {
      label: "complete-container-logs",
    });
    const services = parseJsonRecords(ps.stdout, "Compose service status");
    const topology = assertComposeRuntimeHealth(services, ["test-postgres", "web"]);
    const runtimeOutputs = runner.results.filter((result) =>
      /-(?:one-shot-migration|seed-first|seed-second|complete-container-logs)\.log$/u.test(
        result.log,
      ),
    );
    if (!runtimeOutputs.some((result) => result.log === logs.log)) {
      throw new Error("Complete container log was not selected for content scanning.");
    }
    const content = await scanRuntimeEvidence(runtimeOutputs, "container-log-content-scan.json", {
      expectedWarningRequestIds: ["docker-live-db-fault-v1"],
    });
    const report = {
      content,
      services,
      topology,
    };
    await writeJson(path.join(reportDirectory, "log-scan-report.json"), report);
    return { findings: 0, services: topology.actual };
  });

  await step("QA-DKR-012", async () => {
    const webContainer = await compose.serviceContainer("web");
    const inspectResult = await runner.run("docker", ["inspect", webContainer], {
      label: "web-hardening-inspect",
    });
    const inspect = JSON.parse(inspectResult.stdout)[0];
    const identityResult = await compose.run(
      [
        "exec",
        "--no-TTY",
        "web",
        "/nodejs/bin/node",
        "-e",
        "process.stdout.write(JSON.stringify({uid:process.getuid(),gid:process.getgid()}))",
      ],
      { label: "web-runtime-identity" },
    );
    const identity = JSON.parse(identityResult.stdout.trim());
    const webImage = builtWebImageId();
    const assertions = assertWebContainerHardening(inspect, identity, webImage);
    const fileScan = await runner.run(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--entrypoint",
        "/nodejs/bin/node",
        webImage,
        "-e",
        imageSecretScanProgram,
      ],
      { label: "web-image-secret-file-scan" },
    );
    const imageSecretFindings = JSON.parse(fileScan.stdout.trim());
    if (imageSecretFindings.length > 0) {
      throw new Error(`Web image contains source-secret findings: ${imageSecretFindings.length}.`);
    }
    const sbomFile = path.join(reportDirectory, "web-image.sbom.spdx.json");
    const sbomVersionResult = await runner.run("docker", ["scout", "version"], {
      label: "web-image-sbom-scanner-version",
    });
    const sbomScannerVersion = parseDockerScoutVersion(sbomVersionResult.stdout);
    const sbomResult = await runner.run("docker", dockerScoutSbomArguments(webImage, sbomFile), {
      label: "web-image-sbom",
    });
    const scanFile = path.join(reportDirectory, "web-image.cves.sarif.json");
    const scanDirectory = await mkdtemp(path.join(tmpdir(), "spotter-image-scan-"));
    let scan;
    let scanResult;
    let scannerVersion;
    try {
      await runner.run("docker", ["pull", trivyImage], { label: "trivy-image-pull" });
      const versionResult = await runner.run("docker", trivyVersionArguments(trivyImage), {
        label: "trivy-version",
      });
      scannerVersion = versionResult.stdout.trim();
      const imageArchive = path.join(scanDirectory, "web-image.tar");
      await runner.run("docker", ["image", "save", "--output", imageArchive, webImage], {
        label: "web-image-export-for-scan",
      });
      const containerUser = `${String(process.getuid())}:${String(process.getgid())}`;
      scanResult = await runner.run(
        "docker",
        trivyImageScanArguments({
          scanDirectory,
          scannerImage: trivyImage,
          user: containerUser,
        }),
        { allowFailure: true, label: "web-image-cve-scan" },
      );
      if (![0, 2].includes(scanResult.exitCode)) {
        throw new Error(
          `Trivy failed before producing a trustworthy verdict (exit ${String(scanResult.exitCode)}).`,
        );
      }
      scan = await readFile(path.join(scanDirectory, "web-image.cves.sarif.json"));
      await writeFile(scanFile, scan);
    } finally {
      await rm(scanDirectory, { force: true, recursive: true });
    }
    const sbom = await readFile(sbomFile);
    const sbomEvidence = assertSpdxSbom(JSON.parse(sbom.toString("utf8")));
    const sarif = JSON.parse(scan.toString("utf8"));
    const sarifEvidence = assertTrivySarif(sarif);
    const cveFindings = sarifEvidence.findings;
    const evidence = {
      assertions,
      cveFindings,
      cveReportSha256: sha256(scan),
      cveScannerExitCode: scanResult.exitCode,
      cveScannerImage: trivyImage,
      cveScannerVersion: scannerVersion,
      image: webImage,
      imageId: inspect.Image,
      imageSecretFindings,
      sarif: sarifEvidence,
      sbom: sbomEvidence,
      sbomGenerator: {
        command: sbomResult.command,
        image: webImage,
        version: sbomScannerVersion,
      },
      sbomSha256: sha256(sbom),
    };
    await writeJson(path.join(reportDirectory, "image-security-report.json"), evidence);
    if (scanResult.exitCode === 2 || cveFindings > 0) {
      throw new Error(
        `Web image contains ${String(cveFindings)} critical/high vulnerability findings.`,
      );
    }
    return evidence;
  });

  await step("QA-DKR-013", gracefulTeardown);

  await step("QA-DKR-014", async () => {
    const parity = await runner.run(
      "corepack",
      ["pnpm", "--dir", "backend", "run", "test:integration:pglite"],
      { cwd: root, label: "pglite-fast-demo-parity" },
    );
    const evidence = {
      authority: "fast/demo only; not a substitute for QA-DKR-004..010",
      command: parity.command,
      durationMs: parity.durationMs,
      exitCode: parity.exitCode,
    };
    await writeJson(path.join(reportDirectory, "pglite-parity.json"), evidence);
    return evidence;
  });
} catch (error) {
  protocolError = error;
} finally {
  if (!teardownComplete) {
    try {
      const cleanup = await teardownProjectAfterFailure({
        compose,
        onTargets: (targets) =>
          writeJson(path.join(reportDirectory, "failure-teardown-targets.json"), targets),
        verifyRemoved: () => assertProjectRemoved("failure-post-teardown"),
      });
      await writeJson(path.join(reportDirectory, "failure-teardown-report.json"), cleanup);
    } catch (error) {
      teardownFailure = error;
      if (error?.evidence !== undefined) {
        await writeJson(
          path.join(reportDirectory, "failure-teardown-targets.json"),
          error.evidence.targets,
        );
        await writeJson(path.join(reportDirectory, "failure-teardown-report.json"), {
          ...error.evidence,
          failure: serializeError(error, secrets),
        });
      }
      protocolError ??= error;
    }
  }
  const failedSteps = steps.filter((entry) => entry.status === "fail");
  const eligible = process.env.SPOTTER_DOCKER_FOCUSED !== "1";
  const manifest = {
    commands: runner.results,
    failure: protocolError === undefined ? null : serializeError(protocolError, secrets),
    finishedAt: new Date().toISOString(),
    profile: eligible ? "release" : "focused",
    project,
    reportDirectory,
    schemaVersion: 1,
    steps,
    teardownFailure:
      teardownFailure === undefined ? null : serializeError(teardownFailure, secrets),
    verdict:
      protocolError === undefined && failedSteps.length === 0 && steps.length === 14 && eligible
        ? "pass"
        : protocolError === undefined && failedSteps.length === 0
          ? "focused-pass-not-release-evidence"
          : "fail",
  };
  const serializedEvidence = JSON.stringify(manifest);
  const evidenceFindings = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /\bsk-[A-Za-z0-9_-]{20,}\b/u,
    ...secrets.map((secret) => new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u")),
  ].filter((pattern) => pattern.test(serializedEvidence));
  if (evidenceFindings.length > 0) {
    protocolError ??= new Error("Final Docker evidence contains a secret/credential pattern.");
    manifest.failure = serializeError(protocolError, secrets);
    manifest.verdict = "fail";
  }
  await writeJson(path.join(reportDirectory, "docker-protocol-report.json"), manifest);
  await writeJson(path.join(reportDirectory, "commands.json"), runner.results);
}

process.stdout.write(`Docker verification evidence: ${reportDirectory}\n`);
if (protocolError !== undefined) throw protocolError;
