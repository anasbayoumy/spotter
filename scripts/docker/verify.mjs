import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { run } from "../lib/command.mjs";

const stamp = new Date().toISOString().replace(/\D/gu, "").slice(0, 14);
const project = `spotter-qa-docker-${stamp}-${process.pid}`;
if (!/^spotter-qa-[a-z0-9-]+$/u.test(project)) throw new Error("Unsafe Compose project name.");

const reportDir = path.resolve("artifacts", "verification", `${stamp}-docker`);
await mkdir(reportDir, { recursive: true });
const compose = ["compose", "-p", project, "--profile", "test", "--profile", "demo"];
const environment = {
  APP_ENV: "test",
  AI_MODE: "recorded",
  DATABASE_URL: "postgresql://spotter_app:spotter_local_only@test-postgres:5432/spotter",
  POSTGRES_PORT: "0",
  POSTGRES_TEST_PORT: "0",
  WEB_PORT: "0",
};
const execFileAsync = promisify(execFile);

async function checked(args) {
  const code = await run("docker", [...compose, ...args], { env: environment });
  if (code !== 0) throw new Error(`docker compose ${args.join(" ")} failed with ${code}`);
}

let verificationError;
try {
  await checked(["config", "--quiet"]);
  const { stdout: rendered } = await execFileAsync("docker", [...compose, "config"], {
    env: { ...process.env, ...environment },
  });
  await writeFile(path.join(reportDir, "compose.rendered.yaml"), rendered, "utf8");

  await checked(["build", "--pull", "migrate", "seed", "web"]);
  await checked(["up", "--detach", "--wait", "test-postgres"]);
  await checked(["run", "--rm", "migrate"]);
  await checked(["run", "--rm", "seed"]);
  await checked(["run", "--rm", "seed"]);
  await checked(["up", "--detach", "--wait", "web"]);
  await checked(["restart", "web"]);
  await checked(["ps"]);
  await checked(["logs", "--no-color"]);
} catch (error) {
  verificationError = error;
}

const teardownCode = await run("docker", [...compose, "down", "--volumes", "--remove-orphans"], {
  env: environment,
});
if (verificationError !== undefined) {
  throw verificationError;
}
if (teardownCode !== 0) {
  throw new Error(`Safe Compose teardown failed with ${teardownCode}`);
}
