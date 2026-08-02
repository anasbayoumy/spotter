import { execFile, spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

delete process.env.FORCE_COLOR;
delete process.env.NO_COLOR;

const execFileAsync = promisify(execFile);
const workspace = fileURLToPath(new URL("../../..", import.meta.url));
const statePath = fileURLToPath(new URL("./.runtime-state.json", import.meta.url));
const publicPort = Number.parseInt(process.env.SPOTTER_CLIENT_E2E_PORT ?? "8081", 10);
const apiPort = Number.parseInt(process.env.SPOTTER_CLIENT_API_PORT ?? "3200", 10);
const composeProject = `spotter-e2e-client-${Date.now()}-${process.pid}`.slice(0, 62);
const buildLock = `${workspace}/.cache/e2e-next-build.lock`;
const runtimeDirectory = `${workspace}/.cache/e2e-runtime/${composeProject}`;
const exportDirectory = resolve(runtimeDirectory, "client-web");
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

let apiProcess;
let staticServer;
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
    if (staticServer !== undefined) {
      await new Promise((resolveClose) => staticServer.close(resolveClose)).catch(() => undefined);
    }
    if (apiProcess?.pid !== undefined && apiProcess.exitCode === null) {
      try {
        process.kill(-apiProcess.pid, "SIGTERM");
      } catch {
        apiProcess.kill("SIGTERM");
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
    if (apiProcess?.exitCode !== null) {
      throw new Error(`The production API server exited with ${String(apiProcess?.exitCode)}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`Readiness returned ${String(response.status)}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Production API did not become ready: ${String(lastError)}`);
}

function contentType(pathname) {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    }[extname(pathname)] ?? "application/octet-stream"
  );
}

function staticPathFor(pathname) {
  if (pathname === "/") return join(exportDirectory, "index.html");
  if (/^\/session\/[^/]+\/?$/u.test(pathname)) {
    return join(exportDirectory, "session/[sessionId].html");
  }
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/u, "");
  const direct = resolve(exportDirectory, relative);
  if (!direct.startsWith(`${exportDirectory}/`)) return null;
  if (existsSync(direct)) return direct;
  const html = `${direct.replace(/\/$/u, "")}.html`;
  return existsSync(html) ? html : null;
}

async function proxyApi(request, response) {
  const target = `http://127.0.0.1:${String(apiPort)}${request.url ?? "/"}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || ["connection", "content-length", "host"].includes(name)) continue;
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else headers.set(name, value);
  }
  if (headers.has("origin")) {
    // Next's standalone request URL canonicalizes to localhost even while the listener is bound
    // to 127.0.0.1. Present the canonical upstream origin at this reverse-proxy boundary.
    headers.set("origin", `http://localhost:${String(apiPort)}`);
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
  try {
    const upstream = await fetch(target, {
      body,
      headers,
      method: request.method,
      redirect: "manual",
    });
    response.statusCode = upstream.status;
    upstream.headers.forEach((value, name) => {
      if (!["connection", "content-encoding", "transfer-encoding"].includes(name)) {
        response.setHeader(name, value);
      }
    });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.statusCode = 502;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: String(error) }));
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${String(publicPort)}`);
  if (url.pathname.startsWith("/api/")) {
    await proxyApi(request, response);
    return;
  }
  const path = staticPathFor(url.pathname);
  if (path === null) {
    response.statusCode = 404;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end("Not found");
    return;
  }
  const file = await stat(path);
  response.statusCode = 200;
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-length", file.size);
  response.setHeader("content-type", contentType(path));
  response.setHeader("x-content-type-options", "nosniff");
  createReadStream(path).pipe(response);
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
    CRON_SECRET: "client-e2e-production-cron-secret",
    DATA_POLICY: "synthetic_only",
    DATABASE_MODE: "postgres",
    DATABASE_URL: `postgresql://spotter_app:spotter_local_only@127.0.0.1:${databasePort}/spotter`,
    DEMO_CLIENT_ID: "00000000-0000-4000-8000-000000000101",
    DEMO_COACH_ID: "00000000-0000-4000-8000-000000000001",
    EXPO_PUBLIC_API_BASE_URL: "",
    HOSTNAME: "127.0.0.1",
    LOG_LEVEL: "warn",
    MIGRATIONS_DIR: `${workspace}/backend/migrations`,
    PORT: String(apiPort),
  };
  await run("corepack", ["pnpm", "--filter", "@spotter/backend", "db:migrate"], {
    env: applicationEnvironment,
  });
  await run("corepack", ["pnpm", "--filter", "@spotter/backend", "db:seed"], {
    env: applicationEnvironment,
  });
  await buildIsolatedFrontend(applicationEnvironment);
  await rm(exportDirectory, { force: true, recursive: true });
  await run(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@spotter/client-frontend",
      "exec",
      "expo",
      "export",
      "--platform",
      "web",
      "--output-dir",
      exportDirectory,
      "--clear",
    ],
    { env: { ...applicationEnvironment, CI: "1" } },
  );
  apiProcess = spawn("node", [`${runtimeDirectory}/frontend/server.js`], {
    cwd: `${runtimeDirectory}/frontend`,
    detached: true,
    env: applicationEnvironment,
    stdio: "inherit",
  });
  apiProcess.once("error", (error) => {
    process.stderr.write(`${String(error)}\n`);
    void shutdown(1);
  });
  await writeFile(statePath, JSON.stringify({ applicationPid: apiProcess.pid, composeProject }), {
    mode: 0o600,
  });
  await waitForReady(`http://127.0.0.1:${String(apiPort)}/health/ready`);
  staticServer = createServer((request, response) => {
    void serveStatic(request, response).catch((error) => {
      response.statusCode = 500;
      response.end(String(error));
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    staticServer.once("error", rejectListen);
    staticServer.listen(publicPort, "127.0.0.1", resolveListen);
  });
  process.stdout.write(`Production client E2E server ready on ${String(publicPort)}.\n`);
  setInterval(() => undefined, 60_000);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  await shutdown(1);
}
