import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "../lib/command.mjs";
import { hasExplicitNonRootRuntimeUser } from "./dockerfile-policy.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const artifactRoot = path.join(repositoryRoot, "artifacts");
const excluded = new Set([".git", ".next", ".pnpm-store", ".turbo", "node_modules"]);
const publicBundleExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".mjs"]);
const sourceTextExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const findings = [];
const stages = [];

function isStrictDescendant(parent, target) {
  const relative = path.relative(parent, target);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

async function resolveReportDirectory() {
  const configured = process.env["SPOTTER_SECURITY_REPORT_DIR"];
  if (configured !== undefined && configured.length > 0 && !path.isAbsolute(configured)) {
    throw new Error("SPOTTER_SECURITY_REPORT_DIR must be an absolute path.");
  }
  const target = path.resolve(configured ?? path.join(artifactRoot, "security"));
  if (!isStrictDescendant(artifactRoot, target)) {
    throw new Error("Security reports must be written beneath the repository artifacts directory.");
  }
  await mkdir(target, { recursive: true });
  const [realArtifacts, realTarget] = await Promise.all([realpath(artifactRoot), realpath(target)]);
  if (!isStrictDescendant(realArtifacts, realTarget)) {
    throw new Error(
      "Security report directory resolves outside the repository artifacts directory.",
    );
  }
  return target;
}

const reportDirectory = await resolveReportDirectory();

async function writeJson(name, value) {
  await writeFile(path.join(reportDirectory, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function runCaptured(command, args) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`${command} terminated by ${signal}`));
        return;
      }
      resolve({
        exitCode: code ?? 1,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}

async function writeSuiteSummary(verdict) {
  await writeJson("security-suite-summary.json", {
    finishedAt: new Date().toISOString(),
    reportDirectory: path.relative(repositoryRoot, reportDirectory).split(path.sep).join("/"),
    schemaVersion: 1,
    stages,
    verdict,
  });
}

async function writeUnavailableImageEvidence(reason) {
  const summary = { reason, status: "not-run" };
  stages.push({ name: "image-sbom", ...summary }, { name: "image-vulnerability-scan", ...summary });
  await Promise.all([
    writeJson("sbom-summary.json", summary),
    writeJson("image-scan-summary.json", summary),
  ]);
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(relative) {
  const entries = await readdir(relative, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) results.push(...(await walk(child)));
    else if (entry.isFile() && publicBundleExtensions.has(path.extname(entry.name).toLowerCase())) {
      results.push(child);
    }
  }
  return results;
}

async function ownedTextFiles() {
  const listed = await runCaptured("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  if (listed.exitCode !== 0) {
    throw new Error(`Could not enumerate owned files: ${listed.stderr.trim()}`);
  }
  const candidates = listed.stdout
    .split("\0")
    .filter((file) => file.length > 0)
    .filter((file) => {
      const base = path.basename(file);
      return (
        sourceTextExtensions.has(path.extname(base).toLowerCase()) ||
        base.startsWith("Dockerfile") ||
        base.endsWith(".env.example")
      );
    });
  const regularFiles = await Promise.all(
    candidates.map(async (file) => {
      if (path.isAbsolute(file) || file === ".." || file.startsWith(`..${path.sep}`)) return null;
      const metadata = await lstat(path.join(repositoryRoot, file));
      return metadata.isFile() ? file : null;
    }),
  );
  return regularFiles.filter((file) => file !== null).sort();
}

const scannedFiles = await ownedTextFiles();
for (const file of scannedFiles) {
  const text = await readFile(file, "utf8");
  const checks = [
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u, "private key"],
    [/\bsk-[A-Za-z0-9_-]{20,}\b/u, "provider credential"],
    [/\bAKIA[0-9A-Z]{16}\b/u, "AWS access key"],
  ];
  for (const [pattern, label] of checks) if (pattern.test(text)) findings.push(`${file}: ${label}`);
  if (
    /^(?:frontend|client-frontend)\/src\//u.test(file) &&
    !/(?:^|\/)(?:tests?|__tests__)(?:\/|\.)/u.test(file)
  ) {
    const sourceChecks = [
      [/dangerouslySetInnerHTML/u, "unsafe HTML rendering sink"],
      [/\beval\s*\(/u, "eval execution sink"],
      [/\bnew\s+Function\s*\(/u, "dynamic function execution sink"],
      [/NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|DATABASE)/u, "public secret env"],
      [/EXPO_PUBLIC_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|DATABASE)/u, "public secret env"],
    ];
    for (const [pattern, label] of sourceChecks) {
      if (pattern.test(text)) findings.push(`${file}: ${label}`);
    }
  }
}

for (const root of ["frontend/.next/static", "client-frontend/dist"]) {
  if (!(await exists(root))) continue;
  for (const file of await walk(root)) {
    const text = await readFile(file, "utf8");
    if (/(?:CRON_SECRET|DATABASE_URL|AI_API_KEY|POSTGRES_(?:ADMIN|APP)_PASSWORD)/u.test(text)) {
      findings.push(`${file}: server secret identifier in public bundle`);
    }
    for (const name of ["CRON_SECRET", "DATABASE_URL", "AI_API_KEY"]) {
      const secret = process.env[name];
      if (secret !== undefined && secret.length >= 8 && text.includes(secret)) {
        findings.push(`${file}: configured ${name} value in public bundle`);
      }
    }
  }
}

for (const file of [
  "docker/Dockerfile.web",
  "docker/Dockerfile.seed",
  "docker/Dockerfile.migrate",
]) {
  const text = await readFile(file, "utf8");
  const stages = new Set();
  for (const match of text.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\w+))?\s*$/gimu)) {
    const image = match[1];
    if (
      image !== undefined &&
      !stages.has(image) &&
      !image.includes("@") &&
      (!image.includes(":") || image.endsWith(":latest"))
    ) {
      findings.push(`${file}: unpinned base image ${image}`);
    }
    if (match[2] !== undefined) stages.add(match[2]);
  }
  if (!hasExplicitNonRootRuntimeUser(text)) findings.push(`${file}: no non-root USER`);
}

const sourceScan = {
  filesScanned: scannedFiles.length,
  findings,
  status: findings.length === 0 ? "pass" : "fail",
};
stages.push({ name: "source-and-container-definition-scan", ...sourceScan });
await writeJson("source-scan-summary.json", sourceScan);

if (findings.length > 0) {
  console.error(findings.join("\n"));
  await writeUnavailableImageEvidence("Source scan failed before image evidence could run.");
  await writeSuiteSummary("fail");
  process.exit(1);
}

const audit = await runCaptured("corepack", ["pnpm", "audit", "--json", "--prod"]);
const auditGate = await runCaptured("corepack", [
  "pnpm",
  "audit",
  "--prod",
  "--audit-level",
  "high",
]);
let auditCounts = {};
let auditParsed = false;
try {
  const parsed = JSON.parse(audit.stdout);
  if (typeof parsed === "object" && parsed !== null && "metadata" in parsed) {
    const metadata = parsed.metadata;
    if (typeof metadata === "object" && metadata !== null && "vulnerabilities" in metadata) {
      auditCounts = metadata.vulnerabilities;
      auditParsed = true;
    }
  }
} catch {
  auditCounts = {};
}
const highFindings = typeof auditCounts.high === "number" ? auditCounts.high : Number.NaN;
const criticalFindings =
  typeof auditCounts.critical === "number" ? auditCounts.critical : Number.NaN;
const blockingAuditFindings = highFindings + criticalFindings;
const auditPassed = auditParsed && auditGate.exitCode === 0 && blockingAuditFindings === 0;
const auditSummary = {
  blockingFindings: blockingAuditFindings,
  command: "pnpm audit --prod --audit-level high",
  counts: auditCounts,
  exitCode: auditGate.exitCode,
  inventoryCommand: "pnpm audit --json --prod",
  inventoryRawExitCode: audit.exitCode,
  status: auditPassed ? "pass" : "fail",
};
stages.push({ name: "production-dependency-audit", ...auditSummary });
await writeJson("dependency-audit-summary.json", auditSummary);
if (!auditPassed) {
  console.error(
    `Production dependency audit failed (${String(highFindings)} high, ${String(criticalFindings)} critical).`,
  );
  await writeUnavailableImageEvidence("Dependency audit failed before image evidence could run.");
  await writeSuiteSummary("fail");
  process.exit(auditGate.exitCode === 0 ? 1 : auditGate.exitCode);
}

let code = await run("corepack", ["pnpm", "exec", "turbo", "run", "test:security"]);
const testSummary = {
  command: "turbo run test:security",
  exitCode: code,
  status: code === 0 ? "pass" : "fail",
};
stages.push({ name: "security-tests", ...testSummary });
await writeJson("security-tests-summary.json", testSummary);
if (code !== 0) {
  await writeUnavailableImageEvidence("Security tests failed before image evidence could run.");
  await writeSuiteSummary("fail");
  process.exit(code);
}

const imageReference = process.env["SPOTTER_SECURITY_IMAGE"];
if (imageReference !== undefined && imageReference.length > 0) {
  const sbomPath = path.join(reportDirectory, "spotter-web.spdx.json");
  code = await run("syft", [imageReference, "--output", `spdx-json=${sbomPath}`]);
  if (code !== 0) {
    const summary = { exitCode: code, image: imageReference, status: "fail" };
    stages.push({ name: "image-sbom", ...summary });
    await writeJson("sbom-summary.json", summary);
    await writeSuiteSummary("fail");
    process.exit(code);
  }
  const sbomBuffer = await readFile(sbomPath);
  const sbomDocument = JSON.parse(sbomBuffer.toString("utf8"));
  const sbomSummary = {
    documentSha256: sha256(sbomBuffer),
    image: imageReference,
    packageCount: Array.isArray(sbomDocument.packages) ? sbomDocument.packages.length : 0,
    status: "pass",
  };
  stages.push({ name: "image-sbom", ...sbomSummary });
  await writeJson("sbom-summary.json", sbomSummary);

  const scanPath = path.join(reportDirectory, "spotter-web.trivy.json");
  code = await run("trivy", [
    "image",
    "--exit-code",
    "1",
    "--format",
    "json",
    "--output",
    scanPath,
    "--severity",
    "HIGH,CRITICAL",
    imageReference,
  ]);
  const scanBuffer = await readFile(scanPath);
  const scanDocument = JSON.parse(scanBuffer.toString("utf8"));
  const vulnerabilities = Array.isArray(scanDocument.Results)
    ? scanDocument.Results.flatMap((result) =>
        Array.isArray(result.Vulnerabilities) ? result.Vulnerabilities : [],
      )
    : [];
  const scanSummary = {
    critical: vulnerabilities.filter((entry) => entry.Severity === "CRITICAL").length,
    exitCode: code,
    high: vulnerabilities.filter((entry) => entry.Severity === "HIGH").length,
    image: imageReference,
    reportSha256: sha256(scanBuffer),
    status: code === 0 ? "pass" : "fail",
  };
  stages.push({ name: "image-vulnerability-scan", ...scanSummary });
  await writeJson("image-scan-summary.json", scanSummary);
} else {
  await writeUnavailableImageEvidence(
    "SPOTTER_SECURITY_IMAGE is not configured; release image proof is owned by test:docker.",
  );
}
await writeSuiteSummary(
  code !== 0
    ? "fail"
    : imageReference === undefined || imageReference.length === 0
      ? "partial-pass-not-release-evidence"
      : "pass",
);
process.exitCode = code;
