import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../..");
const workspaceRoot = resolve(projectRoot, "..");
const reportDirectory = join(workspaceRoot, "reports", "mobile");
const exportRoot = mkdtempSync(join(tmpdir(), "spotter-mobile-gates-"));
const startedAt = new Date().toISOString();
const results = [];

function run(name, command, args, options = {}) {
  const childEnvironment = { ...process.env };
  delete childEnvironment.FORCE_COLOR;
  delete childEnvironment.NO_COLOR;
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: {
      ...childEnvironment,
      CI: "1",
      EXPO_PUBLIC_API_BASE_URL: "https://api.example.invalid",
      ...options.env,
    },
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit",
  });
  const passed = result.status === 0 && result.error === undefined;
  results.push({ name, passed });
  if (!passed) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    throw result.error ?? new Error(`${name} failed with exit code ${String(result.status)}`);
  }
  return result.stdout ?? "";
}

function fileCount(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) =>
    entry.isFile(),
  ).length;
}

let failure;
try {
  run("native component and route tests", "pnpm", [
    "exec",
    "vitest",
    "run",
    "--config",
    "tests/mobile/vitest.config.ts",
  ]);
  run("Expo dependency and config doctor", "pnpm", ["exec", "expo-doctor"]);
  const configuration = JSON.parse(
    run(
      "public Expo configuration",
      "pnpm",
      ["exec", "expo", "config", "--type", "public", "--json"],
      {
        capture: true,
      },
    ),
  );
  if (
    configuration.ios?.bundleIdentifier !== "dev.spotter.client" ||
    configuration.android?.package !== "dev.spotter.client" ||
    configuration.web?.output !== "static"
  ) {
    throw new Error("Public Expo configuration does not contain the expected platform identities.");
  }
  for (const platform of ["ios", "android"]) {
    const outputDirectory = join(exportRoot, platform);
    run(`${platform} production export`, "pnpm", [
      "exec",
      "expo",
      "export",
      "--platform",
      platform,
      "--output-dir",
      outputDirectory,
      "--clear",
    ]);
    const outputFiles = fileCount(outputDirectory);
    if (outputFiles === 0) throw new Error(`${platform} export produced no files.`);
    results.push({ name: `${platform} export artifact`, outputFiles, passed: true });
  }
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
} finally {
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(
    join(reportDirectory, "mobile-gates.json"),
    `${JSON.stringify(
      {
        finishedAt: new Date().toISOString(),
        outcome: failure === undefined ? "passed" : "failed",
        results,
        startedAt,
      },
      null,
      2,
    )}\n`,
  );
  rmSync(exportRoot, { force: true, recursive: true });
}

if (failure !== undefined) throw failure;
