import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "../lib/command.mjs";

const suite = process.argv[2];
if (!new Set(["fast", "full"]).has(suite)) throw new Error("Expected fast or full suite.");

const fast = [
  "format:check",
  "lint",
  "typecheck",
  "verify:generated",
  "test:unit",
  "coverage:changed",
  "test:integration:pglite",
  "test:contract",
  "test:safety",
];
const extended = [
  "test:integration",
  "test:concurrency",
  "test:mutation",
  "test:e2e:web",
  "test:e2e:client",
  "test:a11y",
  "test:mobile",
  "test:performance",
  "test:resilience",
  "test:security",
  "build",
  "test:docker",
];
const commands = suite === "fast" ? fast : [...fast, ...extended];
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/\D/gu, "").slice(0, 15);
const runId = `${stamp}-workspace-${suite}`;
const directory = path.resolve("artifacts", "verification", runId);
await mkdir(path.join(directory, "logs"), { recursive: true });

const results = [];
for (const [index, script] of commands.entries()) {
  const commandStarted = Date.now();
  const code = await run("corepack", ["pnpm", "run", script], {
    env: { SPOTTER_VERIFICATION_RUN_ID: runId },
  });
  const log = `logs/cmd-${String(index + 1).padStart(3, "0")}.log`;
  await writeFile(path.join(directory, log), `${script}: exit ${code}\n`, "utf8");
  results.push({
    command: `pnpm ${script}`,
    durationMs: Date.now() - commandStarted,
    exitCode: code,
    log,
  });
  if (code !== 0) break;
}

const passed = results.length === commands.length && results.every((entry) => entry.exitCode === 0);
const contentHash = createHash("sha256").update(JSON.stringify(results)).digest("hex");
const manifest = {
  schemaVersion: 1,
  runId,
  revision: { contentHash: `sha256:${contentHash}`, dirty: true, git: "working-tree" },
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  environment: { node: process.version, platform: `${process.platform}-${process.arch}` },
  sourceContracts: [
    "DOCS/architecture/requirements.md",
    "DOCS/requirements/requirements.md",
    "DOCS/testing/README.md",
  ],
  commands: results,
  requirements: [],
  exceptions: [{ id: "ENV-MOB-001", status: "not-run", reason: "No native simulator runner" }],
  verdict: passed ? (suite === "full" ? "candidate" : "fast-pass") : "fail",
};
await writeFile(
  path.join(directory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log(`Verification evidence: ${directory}`);
if (!passed) process.exitCode = 1;
