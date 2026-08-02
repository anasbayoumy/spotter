import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const reportPaths = [
  "backend/coverage/all/coverage-final.json",
  "coverage/backend-contract/coverage-final.json",
  "frontend/coverage/all/coverage-final.json",
  "client-frontend/coverage/all/coverage-final.json",
  "client-frontend/coverage/mobile/coverage-final.json",
  "coverage/shared/coverage-final.json",
];
const sourcePattern =
  /^(?:backend\/src|backend\/packages\/[^/]+\/src|frontend\/src|client-frontend\/src)\/.*\.(?:ts|tsx)$/u;
const threshold = Object.freeze({ backend: 90, changed: 90, repository: 80 });

function git(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

function globRegex(pattern) {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*" && pattern[index + 2] === "/") {
      expression += "(?:.*/)?";
      index += 2;
    } else if (character === "*" && pattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "{") {
      const end = pattern.indexOf("}", index + 1);
      if (end === -1) throw new Error(`Invalid coverage allowlist glob: ${pattern}`);
      const alternatives = pattern
        .slice(index + 1, end)
        .split(",")
        .map((entry) => escapeRegex(entry));
      expression += `(?:${alternatives.join("|")})`;
      index = end;
    } else {
      expression += escapeRegex(character);
    }
  }
  return new RegExp(`${expression}$`, "u");
}

function normalizeFile(file) {
  const absolute = path.isAbsolute(file) ? file : path.resolve(repositoryRoot, file);
  return path.relative(repositoryRoot, absolute).split(path.sep).join("/");
}

function mergeCoverage(target, incoming, file) {
  const current = target.get(file);
  if (current === undefined) {
    target.set(file, structuredClone(incoming));
    return;
  }
  if (
    JSON.stringify(current.statementMap) !== JSON.stringify(incoming.statementMap) ||
    JSON.stringify(current.fnMap) !== JSON.stringify(incoming.fnMap) ||
    JSON.stringify(current.branchMap) !== JSON.stringify(incoming.branchMap)
  ) {
    throw new Error(`Coverage maps disagree for ${file}.`);
  }
  for (const [id, count] of Object.entries(incoming.s)) current.s[id] += count;
  for (const [id, count] of Object.entries(incoming.f)) current.f[id] += count;
  for (const [id, counts] of Object.entries(incoming.b)) {
    current.b[id] = current.b[id].map((count, index) => count + (counts[index] ?? 0));
  }
}

function emptyMetrics() {
  return {
    branches: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    lines: { covered: 0, total: 0 },
  };
}

function addMetric(target, name, covered) {
  target[name].total += 1;
  if (covered) target[name].covered += 1;
}

function addFileMetrics(target, coverage, changedLines) {
  const lineCounts = new Map();
  for (const [id, location] of Object.entries(coverage.statementMap)) {
    const line = location.start.line;
    if (changedLines !== undefined && !changedLines.has(line)) continue;
    lineCounts.set(line, Math.max(lineCounts.get(line) ?? 0, coverage.s[id]));
  }
  for (const count of lineCounts.values()) addMetric(target, "lines", count > 0);

  for (const [id, definition] of Object.entries(coverage.fnMap)) {
    const line = (definition.decl ?? definition.loc).start.line;
    if (changedLines === undefined || changedLines.has(line)) {
      addMetric(target, "functions", coverage.f[id] > 0);
    }
  }

  for (const [id, definition] of Object.entries(coverage.branchMap)) {
    const counts = coverage.b[id];
    for (const [index, location] of definition.locations.entries()) {
      if (changedLines === undefined || changedLines.has(location.start.line)) {
        addMetric(target, "branches", (counts[index] ?? 0) > 0);
      }
    }
  }
}

function percentage(metric) {
  return metric.total === 0 ? 100 : Number(((metric.covered / metric.total) * 100).toFixed(2));
}

function summarize(metrics) {
  return Object.fromEntries(
    Object.entries(metrics).map(([name, metric]) => [
      name,
      { ...metric, percentage: percentage(metric) },
    ]),
  );
}

function resolveBase() {
  const requested = process.env["COVERAGE_BASE"]?.trim();
  const reference = requested && requested.length > 0 ? requested : "origin/main";
  try {
    return { reference, revision: git(["merge-base", "HEAD", reference]) };
  } catch (error) {
    throw new Error(`Cannot resolve coverage base ${reference}.`, { cause: error });
  }
}

async function changedLinesSince(baseRevision) {
  const roots = ["backend/src", "backend/packages", "frontend/src", "client-frontend/src"];
  const diff = git(["diff", "--unified=0", "--no-color", baseRevision, "--", ...roots]);
  const changed = new Map();
  let currentFile;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      continue;
    }
    if (!line.startsWith("@@") || currentFile === undefined) continue;
    const hunk = /\+(\d+)(?:,(\d+))?/u.exec(line);
    if (hunk === null) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const lines = changed.get(currentFile) ?? new Set();
    for (let offset = 0; offset < count; offset += 1) lines.add(start + offset);
    changed.set(currentFile, lines);
  }

  const untracked = git(["ls-files", "--others", "--exclude-standard", "--", ...roots]);
  for (const file of untracked.split("\n").filter(Boolean)) {
    const source = await readFile(path.join(repositoryRoot, file), "utf8");
    const lineCount = source.split("\n").length;
    changed.set(file, new Set(Array.from({ length: lineCount }, (_, index) => index + 1)));
  }
  return changed;
}

const allowlist = JSON.parse(
  await readFile(path.join(import.meta.dirname, "coverage-allowlist.json"), "utf8"),
);
const allowlistPatterns = allowlist.entries.map((entry) => globRegex(entry.pattern));
const isAllowed = (file) => allowlistPatterns.some((pattern) => pattern.test(file));

const coverage = new Map();
for (const reportPath of reportPaths) {
  const report = JSON.parse(await readFile(path.join(repositoryRoot, reportPath), "utf8"));
  for (const [file, fileCoverage] of Object.entries(report)) {
    const normalized = normalizeFile(file);
    if (sourcePattern.test(normalized) && !isAllowed(normalized)) {
      mergeCoverage(coverage, fileCoverage, normalized);
    }
  }
}

const base = resolveBase();
const changedLines = await changedLinesSince(base.revision);
const changedSourceFiles = [...changedLines.keys()].filter(
  (file) => sourcePattern.test(file) && !isAllowed(file),
);
const unreportedFiles = changedSourceFiles.filter((file) => !coverage.has(file)).sort();

const repositoryMetrics = emptyMetrics();
const backendMetrics = emptyMetrics();
const changedMetrics = emptyMetrics();
const fileSummaries = [];
for (const [file, fileCoverage] of coverage) {
  addFileMetrics(repositoryMetrics, fileCoverage);
  if (/^backend\/src\/(?:domain|application)\//u.test(file)) {
    addFileMetrics(backendMetrics, fileCoverage);
  }
  const lines = changedLines.get(file);
  if (lines !== undefined) addFileMetrics(changedMetrics, fileCoverage, lines);
  const fileMetrics = emptyMetrics();
  addFileMetrics(fileMetrics, fileCoverage);
  fileSummaries.push({ file, ...summarize(fileMetrics) });
}

const summary = {
  schemaVersion: 1,
  base,
  thresholds: threshold,
  measuredFiles: coverage.size,
  files: fileSummaries.sort(
    (left, right) =>
      left.lines.percentage - right.lines.percentage || left.file.localeCompare(right.file),
  ),
  changedSourceFiles: changedSourceFiles.length,
  unreportedFiles,
  backend: summarize(backendMetrics),
  repository: summarize(repositoryMetrics),
  changed: summarize(changedMetrics),
};

const failures = [];
for (const [metric, result] of Object.entries(summary.backend)) {
  if (result.percentage < threshold.backend)
    failures.push(`backend ${metric} ${result.percentage}%`);
}
for (const [metric, result] of Object.entries(summary.repository)) {
  if (result.percentage < threshold.repository)
    failures.push(`repository ${metric} ${result.percentage}%`);
}
for (const [metric, result] of Object.entries(summary.changed)) {
  if (result.percentage < threshold.changed)
    failures.push(`changed ${metric} ${result.percentage}%`);
}
if (unreportedFiles.length > 0)
  failures.push(`${unreportedFiles.length} changed source files unreported`);

const outputDirectory = path.join(repositoryRoot, "artifacts/verification/coverage");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "summary.json"),
  `${JSON.stringify({ ...summary, passed: failures.length === 0, failures }, null, 2)}\n`,
  "utf8",
);

for (const [scope, metrics] of [
  ["backend domain/application", summary.backend],
  ["repository", summary.repository],
  ["changed", summary.changed],
]) {
  console.log(
    `${scope}: lines ${metrics.lines.percentage}% | branches ${metrics.branches.percentage}% | functions ${metrics.functions.percentage}%`,
  );
}
console.log(`coverage base: ${base.reference} (${base.revision})`);
console.log(`coverage evidence: ${path.relative(repositoryRoot, outputDirectory)}/summary.json`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`coverage gate failed: ${failure}`);
  if (unreportedFiles.length > 0) console.error(unreportedFiles.join("\n"));
  process.exitCode = 1;
}
