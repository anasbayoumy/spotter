import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

import {
  repositoryRoot,
  requirementInventory,
  sha256File,
  sourceState,
  walkFiles,
} from "./evidence-common.mjs";
import { validateCompactFirstFailure } from "./defect-evidence.mjs";
import { validateMutationEvidence } from "./mutation-evidence.mjs";

const suite = process.argv[2];
if (!new Set(["fast", "full"]).has(suite)) throw new Error("Expected fast or full suite.");

const fastScripts = [
  "install:frozen",
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
const extendedScripts = [
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
const scripts = suite === "fast" ? fastScripts : [...fastScripts, ...extendedScripts];
const startedAt = new Date();
const sourceBefore = await sourceState();
const sourceInventory = new Set(sourceBefore.files);
const shortRevision = sourceBefore.git.slice(0, 8);
const timePrefix = startedAt
  .toISOString()
  .replace(/[-:]/gu, "")
  .replace(/\.\d{3}/u, "");

async function selectRunDirectory() {
  for (let attempt = 1; attempt <= 99; attempt += 1) {
    const runId = `${timePrefix}-${shortRevision}-${String(attempt).padStart(2, "0")}`;
    const directory = path.join(repositoryRoot, "artifacts", "verification", runId);
    try {
      await access(directory);
    } catch {
      return { directory, runId };
    }
  }
  throw new Error("Could not allocate a unique verification run directory.");
}

const { directory, runId } = await selectRunDirectory();
const requiredDirectories = [
  "logs",
  "reports/junit",
  "reports/coverage",
  "reports/mutation",
  "reports/safety",
  "reports/contract",
  "reports/integration",
  "reports/concurrency",
  "reports/e2e/coach",
  "reports/e2e/client",
  "reports/accessibility",
  "reports/mobile",
  "reports/performance",
  "reports/resilience",
  "reports/security",
  "reports/docker",
  "reports/gates",
];
await Promise.all(
  requiredDirectories.map((relative) => mkdir(path.join(directory, relative), { recursive: true })),
);

function strictDescendant(parent, target) {
  const relative = path.relative(parent, target);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function resolveRepositorySource(relative, label) {
  if (typeof relative !== "string" || relative.length === 0 || path.isAbsolute(relative)) {
    throw new Error(`${label} is not a safe repository-relative path.`);
  }
  const target = path.resolve(repositoryRoot, relative);
  if (!strictDescendant(repositoryRoot, target)) {
    throw new Error(`${label} escapes the repository: ${relative}`);
  }
  return target;
}

function resolveEvidenceReport(relative, label) {
  if (
    typeof relative !== "string" ||
    !relative.startsWith("reports/") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} must be beneath the evidence reports directory.`);
  }
  const target = path.resolve(directory, relative);
  if (!strictDescendant(path.join(directory, "reports"), target)) {
    throw new Error(`${label} escapes the evidence reports directory: ${relative}`);
  }
  return target;
}

async function treeSha256(root) {
  const lines = [];
  for (const file of await walkFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    lines.push(`${(await sha256File(file)).slice("sha256:".length)}  ${relative}\n`);
  }
  return `tree-sha256:${createHash("sha256").update(lines.join("")).digest("hex")}`;
}

async function prepareDefectEvidence() {
  const sourceRelative = "backend/tooling/verification/defect-history.json";
  const source = resolveRepositorySource(sourceRelative, "Defect history source");
  const history = JSON.parse(await readFile(source, "utf8"));
  if (!Array.isArray(history.records) || history.records.length === 0) {
    throw new Error("Defect history has no records.");
  }
  const proofs = [];
  for (const record of history.records) {
    const artifacts = record?.firstFailure?.artifacts;
    if (!Array.isArray(artifacts)) {
      throw new Error(`Defect ${String(record?.id)} has no first-failure artifact inventory.`);
    }
    if (record?.firstFailure?.kind === "runtime-failure") {
      if (artifacts.length !== 1) {
        throw new Error(
          `Defect ${String(record?.id)} must declare one compact first-failure summary.`,
        );
      }
      await validateCompactFirstFailure({
        artifact: artifacts[0],
        record,
        sourceInventory,
      });
    }
    for (const artifact of artifacts) {
      const artifactSource = resolveRepositorySource(
        artifact.source,
        `Defect ${String(record.id)} source`,
      );
      const artifactDestination = resolveEvidenceReport(
        artifact.releasePath,
        `Defect ${String(record.id)} release path`,
      );
      const metadata = await stat(artifactSource);
      let digest;
      if (artifact.type === "file" && metadata.isFile()) {
        digest = await sha256File(artifactSource);
        if (digest !== artifact.sourceSha256) {
          throw new Error(`Defect ${String(record.id)} source digest is stale: ${artifact.source}`);
        }
      } else if (artifact.type === "directory" && metadata.isDirectory()) {
        digest = await treeSha256(artifactSource);
        if (digest !== artifact.sourceTreeSha256) {
          throw new Error(
            `Defect ${String(record.id)} source tree digest is stale: ${artifact.source}`,
          );
        }
      } else {
        throw new Error(`Defect ${String(record.id)} artifact type does not match its source.`);
      }
      await mkdir(path.dirname(artifactDestination), { recursive: true });
      await cp(artifactSource, artifactDestination, {
        force: true,
        recursive: metadata.isDirectory(),
      });
      proofs.push({
        defectId: record.id,
        digest,
        releasePath: artifact.releasePath,
        source: artifact.source,
        type: artifact.type,
      });
    }
  }
  const defectDirectory = path.join(directory, "reports", "defects");
  await mkdir(defectDirectory, { recursive: true });
  await cp(source, path.join(defectDirectory, "defect-history.json"), { force: true });
  await writeFile(
    path.join(defectDirectory, "source-digest-verification.json"),
    `${JSON.stringify({ proofs, schemaVersion: 1, source: sourceRelative }, null, 2)}\n`,
    "utf8",
  );
}

await prepareDefectEvidence();

const ansiPattern = new RegExp(`${String.fromCodePoint(27)}\\[[0-?]*[ -/]*[@-~]`, "gu");
const secretValues = Object.entries(process.env)
  .filter(
    ([key, value]) =>
      /(?:SECRET|PASSWORD|TOKEN|API_KEY|DATABASE_URL)/u.test(key) &&
      value !== undefined &&
      value.length >= 8,
  )
  .map(([, value]) => value);

function sanitized(value) {
  let output = value.replace(ansiPattern, "").replaceAll(repositoryRoot, "<REPOSITORY_ROOT>");
  const homeDirectory = process.env["HOME"];
  if (homeDirectory !== undefined && homeDirectory.length > 1) {
    output = output.replaceAll(homeDirectory, "<HOME>");
  }
  const host = hostname();
  if (host.length > 0) output = output.replaceAll(host, "<HOST>");
  for (const secret of secretValues) output = output.replaceAll(secret, "<REDACTED>");
  return output
    .replace(/postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/giu, "postgresql://<REDACTED>@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/giu, "Bearer <REDACTED>")
    .replace(/\b(?:sk|ghp|github_pat)-[A-Za-z0-9_-]{12,}\b/gu, "<REDACTED>");
}

function testCounts(output) {
  let executed = 0;
  let skipped = 0;
  for (const match of output.matchAll(/\bTests\s+(\d+)\s+passed(?:\s+\|\s+(\d+)\s+skipped)?/gu)) {
    executed += Number(match[1]);
    skipped += Number(match[2] ?? 0);
  }
  if (executed === 0) {
    for (const match of output.matchAll(/^\s*(\d+)\s+passed(?:\s+\((?:[^)]*)\))?\s*$/gmu)) {
      executed += Number(match[1]);
    }
    for (const match of output.matchAll(/^\s*(\d+)\s+skipped\s*$/gmu)) skipped += Number(match[1]);
  }
  return executed === 0 && skipped === 0
    ? { discovered: 1, executed: 1, kind: "gate-command", retried: 0, skipped: 0 }
    : {
        discovered: executed + skipped,
        executed,
        kind: "test-cases",
        retried: 0,
        skipped,
      };
}

async function runCaptured(script, index) {
  const id = `cmd-${String(index + 1).padStart(3, "0")}`;
  const relativeLog = `logs/${id}.log`;
  const commandStarted = new Date();
  const output = [];
  const environment = {
    ...process.env,
    SPOTTER_VERIFICATION_RUN_ID: runId,
    SPOTTER_PERF_REPORT_DIR: path.join(directory, "reports", "performance"),
    SPOTTER_DOCKER_REPORT_DIR: path.join(directory, "reports", "docker"),
    SPOTTER_SECURITY_REPORT_DIR: path.join(directory, "reports", "security"),
  };
  const localBrowsers = path.join(repositoryRoot, ".cache", "ms-playwright");
  try {
    await access(localBrowsers);
    environment.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
  } catch {
    delete environment.PLAYWRIGHT_BROWSERS_PATH;
  }

  const code = await new Promise((resolve, reject) => {
    const child = spawn("corepack", ["pnpm", "run", script], {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        const buffer = Buffer.from(chunk);
        output.push(buffer);
        process.stdout.write(buffer);
      });
    }
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal !== null) reject(new Error(`${script} terminated by ${signal}`));
      else resolve(exitCode ?? 1);
    });
  });
  const text = sanitized(Buffer.concat(output).toString("utf8"));
  const logPath = path.join(directory, relativeLog);
  await writeFile(logPath, text, "utf8");
  return {
    id,
    command: `pnpm run ${script}`,
    script,
    startedAt: commandStarted.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - commandStarted.getTime(),
    exitCode: code,
    log: relativeLog,
    logSha256: await sha256File(logPath),
    attempt: 1,
    testCounts: testCounts(text),
  };
}

const results = [];
for (const [index, script] of scripts.entries()) {
  const result = await runCaptured(script, index);
  results.push(result);
  await writeFile(
    path.join(directory, "reports", "gates", `${result.id}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  if (result.exitCode !== 0) break;
}

const sourceAfter = await sourceState();
const sourceStable = sourceBefore.contentHash === sourceAfter.contentHash;
const sourceEligible = sourceStable && (suite === "fast" || sourceBefore.dirty === false);

function commandsForRequirement(id) {
  if (/^QA-STA-/u.test(id))
    return ["install:frozen", "format:check", "lint", "typecheck", "verify:generated", "build"];
  if (/^QA-ARC-/u.test(id)) return ["lint"];
  if (/^QA-COV-/u.test(id)) return ["test:unit", "coverage:changed"];
  if (/^QA-MUT-/u.test(id)) return ["test:mutation"];
  if (/^QA-SAF-/u.test(id)) return ["test:safety"];
  if (/^QA-API-/u.test(id)) return ["test:contract"];
  if (/^QA-DB-/u.test(id)) return ["test:integration:pglite", "test:integration"];
  if (/^QA-CON-/u.test(id)) return ["test:concurrency"];
  if (/^QA-E2E-/u.test(id)) return ["test:e2e:web"];
  if (/^QA-CLI-/u.test(id)) return ["test:e2e:client"];
  if (/^QA-A11Y-/u.test(id)) return ["test:a11y", "test:mobile"];
  if (/^QA-MOB-/u.test(id)) return ["test:mobile", "test:e2e:client", "build"];
  if (/^NFR-PERF-/u.test(id)) return ["test:performance"];
  if (/^NFR-RES-/u.test(id)) return ["test:resilience"];
  if (/^SEC-/u.test(id)) return ["test:security", "test:docker"];
  if (/^QA-DKR-/u.test(id)) return ["test:docker"];
  if (/^QA-EVD-/u.test(id)) return [];
  if (/^QA-REL-/u.test(id) || /^QA-STR-/u.test(id)) return scripts;
  if (/^SYS-/u.test(id) || /^BND-/u.test(id)) return ["lint", "typecheck", "test:contract"];
  if (/^DAT-/u.test(id)) return ["test:integration", "test:concurrency"];
  if (/^AI-/u.test(id)) return ["test:unit", "test:safety", "test:contract"];
  if (/^FLOW-/u.test(id)) return ["test:safety", "test:integration", "test:e2e:web"];
  if (/^PRV-/u.test(id)) return ["test:security", "test:integration"];
  if (/^OPS-/u.test(id)) return ["test:resilience", "test:docker"];
  throw new Error(`No evidence command mapping for ${id}.`);
}

const resultByScript = new Map(results.map((result) => [result.script, result]));
const requirements = (await requirementInventory()).map((id) => {
  if (id === "QA-MOB-006") {
    return {
      id,
      status: "not-run",
      evidence: ["KNOWN-LIMITATIONS.md"],
      exception: "ENV-MOB-001",
    };
  }
  const required = commandsForRequirement(id);
  const evidenceResults = required.map((script) => resultByScript.get(script)).filter(Boolean);
  const status =
    required.length === 0
      ? results.every((result) => result.exitCode === 0) && sourceEligible
        ? "passed"
        : "failed"
      : evidenceResults.length !== required.length
        ? "not-run"
        : evidenceResults.every((result) => result.exitCode === 0) && sourceEligible
          ? "passed"
          : "failed";
  return {
    id,
    status,
    evidence:
      required.length === 0
        ? ["manifest.json", "reports/traceability.json"]
        : evidenceResults.length > 0
          ? evidenceResults.map((result) => result.log)
          : [results.at(-1)?.log ?? "manifest.json"],
  };
});

const contractPaths = [
  "DOCS/architecture/requirements.md",
  "DOCS/requirements/requirements.md",
  "DOCS/requirements/product-contract.md",
  "DOCS/testing/README.md",
  "DOCS/testing/09-evidence-and-fix-loop.md",
  "DOCS/testing/10-release-definition-of-done.md",
  "DOCS/testing/11-requirement-command-matrix.md",
  "DOCS/release/KNOWN-LIMITATIONS.md",
];
const sourceContracts = await Promise.all(
  contractPaths.map(async (contractPath) => ({
    path: contractPath,
    sha256: await sha256File(path.join(repositoryRoot, contractPath)),
  })),
);

async function version(command, args) {
  try {
    return sanitized(
      String(
        await import("node:child_process").then(({ execFileSync }) =>
          execFileSync(command, args, { encoding: "utf8" }).trim(),
        ),
      ),
    );
  } catch {
    return "unavailable";
  }
}

const environment = {
  node: process.version,
  pnpm: await version("corepack", ["pnpm", "--version"]),
  docker: await version("docker", ["version", "--format", "{{.Server.Version}}"]),
  compose: await version("docker", ["compose", "version", "--short"]),
  git: await version("git", ["--version"]),
  os: `${process.platform}-${process.arch}`,
};

const allCommandsPassed =
  results.length === scripts.length && results.every((result) => result.exitCode === 0);
const fullRequirementsSatisfied = requirements.every(
  (requirement) =>
    requirement.status === "passed" ||
    (requirement.id === "QA-MOB-006" && requirement.status === "not-run"),
);
const passed =
  allCommandsPassed && sourceEligible && (suite === "fast" || fullRequirementsSatisfied);

await writeFile(
  path.join(directory, "environment.json"),
  `${JSON.stringify(environment, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(directory, "reports", "traceability.json"),
  `${JSON.stringify({ requirements, runId, schemaVersion: 1 }, null, 2)}\n`,
  "utf8",
);

const manifest = {
  schemaVersion: 1,
  runId,
  suite,
  revision: {
    contentHash: sourceBefore.contentHash,
    dirty: sourceBefore.dirty,
    fileCount: sourceBefore.fileCount,
    git: sourceBefore.git,
    sourceStable,
  },
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  environment,
  sourceContracts,
  commands: results,
  requirements,
  exceptions: [
    {
      id: "ENV-MOB-001",
      status: "not-run",
      reason:
        "The current host has no approved native simulator/device runner; mobile component, Expo doctor/config, iOS/Android export, and Expo-web verification remain mandatory.",
    },
  ],
  verdict: passed ? (suite === "full" ? "pass" : "fast-pass") : "fail",
};

await writeFile(
  path.join(directory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

async function copyIfPresent(source, destination) {
  try {
    const sourceStat = await stat(source);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { force: true, recursive: sourceStat.isDirectory() });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

await Promise.all([
  copyIfPresent(path.join(repositoryRoot, "reports"), path.join(directory, "reports", "tooling")),
  copyIfPresent(
    path.join(repositoryRoot, "backend", "reports"),
    path.join(directory, "reports", "backend"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "frontend", "reports"),
    path.join(directory, "reports", "frontend"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "client-frontend", "reports"),
    path.join(directory, "reports", "client"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "backend", "coverage"),
    path.join(directory, "reports", "coverage", "backend"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "frontend", "coverage"),
    path.join(directory, "reports", "coverage", "frontend"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "client-frontend", "coverage"),
    path.join(directory, "reports", "coverage", "client"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "artifacts", "verification", "coverage"),
    path.join(directory, "reports", "coverage", "aggregate"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "reports", "mutation"),
    path.join(directory, "reports", "mutation"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "reports", "mobile"),
    path.join(directory, "reports", "mobile"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "frontend", "tests", "e2e", "test-results"),
    path.join(directory, "reports", "e2e", "coach", "test-results"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "frontend", "tests", "e2e", "playwright-report"),
    path.join(directory, "reports", "e2e", "coach", "playwright-report"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "client-frontend", "tests", "e2e", "test-results"),
    path.join(directory, "reports", "e2e", "client", "test-results"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "client-frontend", "tests", "e2e", "playwright-report"),
    path.join(directory, "reports", "e2e", "client", "playwright-report"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "frontend", "tests", "accessibility", "playwright-report"),
    path.join(directory, "reports", "accessibility", "coach"),
  ),
  copyIfPresent(
    path.join(repositoryRoot, "client-frontend", "tests", "accessibility", "playwright-report"),
    path.join(directory, "reports", "accessibility", "client"),
  ),
]);

if (suite === "full" && allCommandsPassed) {
  const mutationReport = path.join(directory, "reports", "mutation", "mutation.json");
  const mutationClassification = path.join(
    repositoryRoot,
    "backend",
    "tooling",
    "verification",
    "mutation-survivor-classification.json",
  );
  if (!(await stat(mutationReport)).isFile()) {
    throw new Error("The full suite did not produce a mutation JSON report.");
  }
  if (!(await stat(mutationClassification)).isFile()) {
    throw new Error("The committed mutation survivor classification is missing.");
  }
  await cp(
    mutationClassification,
    path.join(directory, "reports", "mutation", "survivor-classification.json"),
    { force: true },
  );
}

const finalReport = [
  "# Spotter V1 final quality report",
  "",
  `- Run: \`${runId}\``,
  `- Suite: \`${suite}\``,
  `- Git revision: \`${sourceBefore.git}\``,
  `- Tested content: \`${sourceBefore.contentHash}\` (${String(sourceBefore.fileCount)} files)`,
  `- Verdict: **${manifest.verdict}**`,
  `- Source remained stable during verification: ${sourceStable ? "yes" : "no"}`,
  "",
  "## Gate commands",
  "",
  ...results.map(
    (result) =>
      `- [${result.id}](${result.log}): \`${result.command}\` — exit ${String(result.exitCode)}, ${String(result.durationMs)} ms, ${String(result.testCounts.executed)}/${String(result.testCounts.discovered)} checks executed, ${String(result.testCounts.skipped)} skipped, ${String(result.testCounts.retried)} retried.`,
  ),
  "",
  "## Verification character",
  "",
  "Deterministic recorded-mode acceptance is represented by the command logs and linked reports. Live-model behavior is not claimed by this V1 recorded-mode release. The only approved not-run item is native simulator/device proof under ENV-MOB-001.",
  "",
];
await writeFile(path.join(directory, "FINAL-QUALITY-REPORT.md"), finalReport.join("\n"), "utf8");
const knownLimitations = await readFile(
  path.join(repositoryRoot, "DOCS", "release", "KNOWN-LIMITATIONS.md"),
  "utf8",
);
await writeFile(path.join(directory, "KNOWN-LIMITATIONS.md"), knownLimitations, "utf8");

const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".log",
  ".md",
  ".mjs",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
for (const file of await walkFiles(directory)) {
  if (path.basename(file) === "checksums.sha256" || !textExtensions.has(path.extname(file)))
    continue;
  const current = await readFile(file, "utf8");
  const clean = sanitized(current);
  if (clean !== current) await writeFile(file, clean, "utf8");
}

if (suite === "full" && passed) {
  const mutationBinding = await validateMutationEvidence({
    evidenceDirectory: directory,
    releaseTimestamp: manifest.finishedAt,
    repositoryRoot,
  });
  await writeFile(
    path.join(directory, "reports", "mutation", "binding-verification.json"),
    `${JSON.stringify(mutationBinding, null, 2)}\n`,
    "utf8",
  );
}

const checksumLines = [];
for (const file of await walkFiles(directory)) {
  if (path.basename(file) === "checksums.sha256") continue;
  const relative = path.relative(directory, file).split(path.sep).join("/");
  checksumLines.push(`${(await sha256File(file)).slice("sha256:".length)}  ${relative}`);
}
await writeFile(path.join(directory, "checksums.sha256"), `${checksumLines.join("\n")}\n`, "utf8");

process.stdout.write(`Verification evidence: ${path.relative(repositoryRoot, directory)}\n`);
if (!passed) process.exitCode = 1;
