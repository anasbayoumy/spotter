import { execFileSync } from "node:child_process";
import { run } from "../lib/command.mjs";

const task = process.argv[2];
if (!task || !/^test:[a-z-]+$/u.test(task)) throw new Error("A safe Turbo test task is required.");

const stamp = new Date().toISOString().replace(/\D/gu, "").slice(0, 14);
const project = `spotter-qa-${task.replace(/[^a-z]/gu, "-")}-${stamp}-${process.pid}`.slice(0, 62);
if (!/^spotter-qa-[a-z0-9-]+$/u.test(project)) throw new Error("Unsafe Compose project name.");

const compose = ["compose", "-p", project, "--profile", "test"];
const environment = { POSTGRES_TEST_PORT: "0" };

try {
  let code = await run("docker", [...compose, "up", "--detach", "--wait", "test-postgres"], {
    env: environment,
  });
  if (code !== 0) process.exit(code);

  const mapping = execFileSync("docker", [...compose, "port", "test-postgres", "5432"], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
  }).trim();
  const port = mapping.slice(mapping.lastIndexOf(":") + 1);
  if (!/^\d+$/u.test(port)) throw new Error(`Unexpected PostgreSQL port mapping: ${mapping}`);

  code = await run("corepack", ["pnpm", "exec", "turbo", "run", task], {
    env: {
      AI_MODE: "recorded",
      APP_ENV: "test",
      DATABASE_MODE: "postgres",
      DATABASE_URL: `postgresql://spotter_app:spotter_local_only@127.0.0.1:${port}/spotter`,
    },
  });
  process.exitCode = code;
} finally {
  await run("docker", [...compose, "down", "--volumes", "--remove-orphans"], {
    env: environment,
  });
}
