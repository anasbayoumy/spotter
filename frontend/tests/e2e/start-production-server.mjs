import { execFile, spawn } from "node:child_process";
import { cp, mkdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

delete process.env.FORCE_COLOR;
delete process.env.NO_COLOR;

const execFileAsync = promisify(execFile);
const workspace = fileURLToPath(new URL("../../..", import.meta.url));
const statePath = fileURLToPath(new URL("./.runtime-state.json", import.meta.url));
const webPort = Number.parseInt(process.env.SPOTTER_E2E_WEB_PORT ?? "3000", 10);
const stamp = `${Date.now()}-${process.pid}`;
const composeProject = `spotter-e2e-web-${stamp}`.slice(0, 62);
const buildLock = `${workspace}/.cache/e2e-next-build.lock`;
const runtimeDirectory = `${workspace}/.cache/e2e-runtime/${composeProject}`;
const composeEnvironment = { ...process.env, POSTGRES_TEST_PORT: "0" };
const composeArguments = [
  "compose",
  "-f",
  "compose.yaml",
  "-p",
  composeProject,
  "--profile",
  "test",
];

let applicationProcess;
let cleanupPromise;

function run(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: workspace,
      env: options.env ?? process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${String(code ?? signal)}`));
    });
  });
}

async function cleanup() {
  if (cleanupPromise !== undefined) return cleanupPromise;
  cleanupPromise = (async () => {
    if (applicationProcess?.pid !== undefined && applicationProcess.exitCode === null) {
      try {
        process.kill(-applicationProcess.pid, "SIGTERM");
      } catch {
        applicationProcess.kill("SIGTERM");
      }
    }
    await execFileAsync("docker", [...composeArguments, "down", "--volumes", "--remove-orphans"], {
      cwd: workspace,
      env: composeEnvironment,
      killSignal: "SIGTERM",
      timeout: 30_000,
    }).catch(() => undefined);
    await unlink(statePath).catch(() => undefined);
    await rm(runtimeDirectory, { force: true, recursive: true }).catch(() => undefined);
  })();
  return cleanupPromise;
}

async function acquireBuildLock() {
  await mkdir(`${workspace}/.cache`, { recursive: true });
  for (;;) {
    try {
      await mkdir(buildLock);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const lock = await stat(buildLock).catch(() => null);
      if (lock !== null && Date.now() - lock.mtimeMs > 10 * 60_000) {
        await rm(buildLock, { force: true, recursive: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function buildIsolatedFrontend(environment) {
  await acquireBuildLock();
  try {
    await run("corepack", ["pnpm", "--filter", "@spotter/frontend", "build"], {
      env: environment,
    });
    await rm(runtimeDirectory, { force: true, recursive: true });
    await cp(`${workspace}/frontend/.next/standalone`, runtimeDirectory, { recursive: true });
    await mkdir(`${runtimeDirectory}/frontend/.next`, { recursive: true });
    await cp(`${workspace}/frontend/.next/static`, `${runtimeDirectory}/frontend/.next/static`, {
      recursive: true,
    });
  } finally {
    await rm(buildLock, { force: true, recursive: true });
  }
}

async function shutdown(code) {
  await cleanup();
  process.exit(code);
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));

async function waitForReady(url) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    if (applicationProcess?.exitCode !== null) {
      throw new Error(
        `The production web server exited with ${String(applicationProcess?.exitCode)}.`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`Readiness returned ${String(response.status)}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Production web server did not become ready: ${String(lastError)}`);
}

try {
  await run("docker", [...composeArguments, "up", "--detach", "--wait", "test-postgres"], {
    env: composeEnvironment,
  });
  await writeFile(statePath, JSON.stringify({ composeProject }), { mode: 0o600 });
  const { stdout: mapping } = await execFileAsync(
    "docker",
    [...composeArguments, "port", "test-postgres", "5432"],
    { cwd: workspace, env: composeEnvironment },
  );
  const databasePort = mapping.trim().slice(mapping.trim().lastIndexOf(":") + 1);
  if (!/^\d+$/u.test(databasePort)) {
    throw new Error(`Unexpected PostgreSQL port mapping: ${mapping.trim()}`);
  }

  const applicationEnvironment = {
    ...process.env,
    AI_MODE: "recorded",
    ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
    APP_ENV: "production",
    CRON_SECRET: "e2e-production-cron-secret",
    DATA_POLICY: "synthetic_only",
    DATABASE_MODE: "postgres",
    DATABASE_URL: `postgresql://spotter_app:spotter_local_only@127.0.0.1:${databasePort}/spotter`,
    DEMO_CLIENT_ID: "00000000-0000-4000-8000-000000000101",
    DEMO_COACH_ID: "00000000-0000-4000-8000-000000000001",
    HOSTNAME: "127.0.0.1",
    LOG_LEVEL: "warn",
    MIGRATIONS_DIR: `${workspace}/backend/migrations`,
    PORT: String(webPort),
  };

  await run("corepack", ["pnpm", "--filter", "@spotter/backend", "db:migrate"], {
    env: applicationEnvironment,
  });
  await run("corepack", ["pnpm", "--filter", "@spotter/backend", "db:seed"], {
    env: applicationEnvironment,
  });
  await buildIsolatedFrontend(applicationEnvironment);

  applicationProcess = spawn("node", [`${runtimeDirectory}/frontend/server.js`], {
    cwd: `${runtimeDirectory}/frontend`,
    detached: true,
    env: applicationEnvironment,
    stdio: "inherit",
  });
  applicationProcess.once("error", (error) => {
    process.stderr.write(`${String(error)}\n`);
    void shutdown(1);
  });
  await writeFile(
    statePath,
    JSON.stringify({ applicationPid: applicationProcess.pid, composeProject }),
    { mode: 0o600 },
  );
  await waitForReady(`http://127.0.0.1:${String(webPort)}/health/ready`);
  process.stdout.write(`Production coach E2E server ready on ${String(webPort)}.\n`);
  setInterval(() => undefined, 60_000);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  await shutdown(1);
}
