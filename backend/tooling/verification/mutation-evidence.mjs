import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const repositoryRootToken = "<REPOSITORY_ROOT>";
const expectedMutatePatterns = [
  "backend/src/domain/**/*.ts",
  "backend/src/evals/safety/**/*.ts",
  "backend/src/agents/context/**/*.ts",
  "backend/src/application/programmes.ts",
  "backend/src/application/accountability.ts",
  "backend/src/infrastructure/database/publish-programme.ts",
  "!**/*.test.ts",
  "!**/index.ts",
];
const mutationInputRootFiles = [
  ".node-version",
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "stryker.config.mjs",
  "tsconfig.base.json",
  "tsconfig.json",
  "turbo.json",
  "vitest.config.ts",
];
const ignoredMutationInputDirectories = new Set([
  ".cache",
  ".expo",
  ".next",
  ".stryker-tmp",
  ".turbo",
  "artifacts",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "reports",
  "test-results",
]);
const ignoredMutationInputRootRelativeDirectories = new Set([
  "backend/infra",
  "backend/tooling",
]);

const expectedScopes = {
  "QA-MUT-001": {
    selectors: ["backend/src/evals/safety/**"],
    thresholdPercent: 95,
    includes: (file) => file.startsWith("backend/src/evals/safety/"),
  },
  "QA-MUT-002": {
    selectors: ["backend/src/agents/context/**", "backend/src/domain/temporal.ts"],
    thresholdPercent: 95,
    includes: (file) =>
      file.startsWith("backend/src/agents/context/") || file === "backend/src/domain/temporal.ts",
  },
  "QA-MUT-003": {
    selectors: [
      "backend/src/domain/programme.ts",
      "backend/src/application/programmes.ts",
      "backend/src/infrastructure/database/publish-programme.ts",
    ],
    thresholdPercent: 95,
    includes: (file) =>
      new Set([
        "backend/src/domain/programme.ts",
        "backend/src/application/programmes.ts",
        "backend/src/infrastructure/database/publish-programme.ts",
      ]).has(file),
  },
  "QA-MUT-004": {
    selectors: [
      "backend/src/domain/accountability.ts",
      "backend/src/application/accountability.ts",
    ],
    thresholdPercent: 95,
    includes: (file) =>
      new Set([
        "backend/src/domain/accountability.ts",
        "backend/src/application/accountability.ts",
      ]).has(file),
  },
  "QA-MUT-005": {
    selectors: ["Every production file selected by stryker.config.mjs"],
    thresholdPercent: 90,
    includes: () => true,
  },
};

const reportStatuses = new Set([
  "Killed",
  "Survived",
  "NoCoverage",
  "Timeout",
  "RuntimeError",
  "CompileError",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${label} is not an object.`,
  );
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} has unexpected keys: ${actual.join(", ")}`,
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(file) {
  return sha256(await readFile(file));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function canonicalKey(value) {
  return JSON.stringify(canonical(value));
}

function normalizedReportValue(value, repositoryRoot) {
  if (typeof value === "string") {
    return repositoryRoot === undefined
      ? value
      : value.replaceAll(repositoryRoot, repositoryRootToken);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizedReportValue(entry, repositoryRoot));
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalizedReportValue(child, repositoryRoot)]),
  );
}

function canonicalReportDigest(report, repositoryRoot) {
  const root =
    repositoryRoot ??
    (typeof report.projectRoot === "string" && path.isAbsolute(report.projectRoot)
      ? report.projectRoot
      : undefined);
  return sha256(JSON.stringify(normalizedReportValue(report, root)));
}

function fileSetDigest(files) {
  return sha256(JSON.stringify([...files].sort()));
}

function isSelectedMutationFile(file) {
  if (
    !file.endsWith(".ts") ||
    file.endsWith(".test.ts") ||
    path.posix.basename(file) === "index.ts"
  ) {
    return false;
  }
  return (
    file.startsWith("backend/src/domain/") ||
    file.startsWith("backend/src/evals/safety/") ||
    file.startsWith("backend/src/agents/context/") ||
    file === "backend/src/application/programmes.ts" ||
    file === "backend/src/application/accountability.ts" ||
    file === "backend/src/infrastructure/database/publish-programme.ts"
  );
}

async function currentSelectedMutationFiles(repositoryRoot) {
  const sourceRoot = path.join(repositoryRoot, "backend", "src");
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) {
        const relative = path.relative(repositoryRoot, target).split(path.sep).join("/");
        if (isSelectedMutationFile(relative)) files.push(relative);
      }
    }
  }
  await walk(sourceRoot);
  return files.sort();
}

async function currentSelectedMutationTests(repositoryRoot) {
  const files = [];
  const sourceRoot = path.join(repositoryRoot, "backend", "src");
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        files.push(path.relative(repositoryRoot, target).split(path.sep).join("/"));
      }
    }
  }
  await walk(sourceRoot);
  const pgliteTest = "backend/tests/pglite/publish-programme.coverage.integration.test.ts";
  try {
    if ((await stat(path.join(repositoryRoot, pgliteTest))).isFile()) files.push(pgliteTest);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return files.sort();
}

export async function mutationExecutionInputs(repositoryRoot) {
  const files = [];
  async function addTree(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory() && ignoredMutationInputDirectories.has(entry.name)) continue;
      const target = path.join(directory, entry.name);
      const relativeTarget = path.relative(repositoryRoot, target).split(path.sep).join("/");
      if (
        entry.isDirectory() &&
        ignoredMutationInputRootRelativeDirectories.has(relativeTarget)
      ) {
        continue;
      }
      if (entry.isDirectory()) await addTree(target);
      else if (entry.isFile() && !entry.name.endsWith(".tsbuildinfo")) files.push(target);
    }
  }
  await addTree(path.join(repositoryRoot, "backend"));
  for (const relative of mutationInputRootFiles) {
    const target = path.join(repositoryRoot, relative);
    try {
      if ((await stat(target)).isFile()) files.push(target);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const unique = [...new Set(files.map((file) => path.resolve(file)))].sort();
  const lines = [];
  for (const file of unique) {
    const relative = path.relative(repositoryRoot, file).split(path.sep).join("/");
    lines.push(`${sha256(await readFile(file))}  ${relative}\n`);
  }
  return {
    fileCount: unique.length,
    sha256: sha256(lines.join("")),
  };
}

function descriptor(file, mutant, includeReason = false) {
  return {
    file,
    id: mutant.id,
    status: mutant.status,
    mutatorName: mutant.mutatorName,
    replacement: mutant.replacement,
    location: mutant.location,
    ...(includeReason ? { statusReason: mutant.statusReason } : {}),
  };
}

function declaredDescriptor(entry, includeReason = false) {
  return {
    file: entry.file,
    id: entry.id,
    status: entry.status,
    mutatorName: entry.mutatorName,
    replacement: entry.replacement,
    location: entry.location,
    ...(includeReason ? { statusReason: entry.statusReason } : {}),
  };
}

function inventoryDigest(entries) {
  const sorted = [...entries].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
  return sha256(JSON.stringify(sorted));
}

function assertExactInventory(actual, declared, label) {
  const actualKeys = actual.map(canonicalKey).sort();
  const declaredKeys = declared.map(canonicalKey).sort();
  assert(new Set(declaredKeys).size === declaredKeys.length, `${label} contains duplicates.`);
  assert(
    JSON.stringify(actualKeys) === JSON.stringify(declaredKeys),
    `${label} does not exactly match the mutation report.`,
  );
}

function roundScore(value) {
  return Number(value.toFixed(6));
}

function statusCounts(mutants) {
  const counts = {
    Killed: 0,
    Survived: 0,
    Timeout: 0,
    NoCoverage: 0,
    RuntimeError: 0,
    CompileError: 0,
  };
  for (const { mutant } of mutants) {
    assert(reportStatuses.has(mutant.status), `Unknown mutation status: ${String(mutant.status)}`);
    counts[mutant.status] += 1;
  }
  return counts;
}

function scopeIdsForFile(file) {
  return Object.entries(expectedScopes)
    .filter(([, scope]) => scope.includes(file))
    .map(([id]) => id);
}

function assertMeaningfulText(value, label, minimum = 20) {
  assert(typeof value === "string" && value.length >= minimum, `${label} is incomplete.`);
}

function validateClassificationEntry(entry, reportEntry, classification, releaseTime) {
  exactKeys(
    entry,
    [
      "file",
      "id",
      "status",
      "mutatorName",
      "replacement",
      "location",
      "scopeIds",
      "riskCategory",
      "classification",
      "proof",
      "reviewer",
      "reviewedOn",
      "expiresOn",
      "disposition",
      "countedAsDetected",
    ],
    `mutation classification ${entry.file}:${entry.id}`,
  );
  assert(
    entry.status === "Survived" || entry.status === "NoCoverage",
    "Invalid classified status.",
  );
  assert(entry.classification === "equivalent", "A non-equivalent mutant remains unresolved.");
  assert(entry.disposition === "approved-equivalent-until-expiry", "Invalid survivor disposition.");
  assert(entry.countedAsDetected === false, "Equivalent survivor was counted as detected.");
  assertMeaningfulText(entry.riskCategory, "Mutation risk category", 8);
  assertMeaningfulText(entry.proof, "Mutation equivalence proof", 80);
  assert(entry.reviewer === classification.reviewer, "Mutation reviewer is inconsistent.");
  assert(entry.reviewedOn === classification.reviewedOn, "Mutation review date is inconsistent.");
  const reviewed = Date.parse(`${entry.reviewedOn}T00:00:00.000Z`);
  const expires = Date.parse(`${entry.expiresOn}T23:59:59.999Z`);
  assert(
    Number.isFinite(reviewed) && Number.isFinite(expires),
    "Mutation review dates are invalid.",
  );
  assert(expires > reviewed && expires > releaseTime, "Mutation equivalence approval is expired.");
  assert(
    JSON.stringify(entry.scopeIds) === JSON.stringify(scopeIdsForFile(entry.file)),
    `Mutation scope mapping is stale: ${entry.file}:${entry.id}`,
  );
  assert(
    canonicalKey(declaredDescriptor(entry)) === canonicalKey(descriptor(entry.file, reportEntry)),
    `Mutation descriptor is stale: ${entry.file}:${entry.id}`,
  );
}

async function validateTimeoutEntry(
  entry,
  reportEntry,
  classification,
  repositoryRoot,
  releaseTime,
) {
  exactKeys(
    entry,
    [
      "file",
      "id",
      "status",
      "mutatorName",
      "replacement",
      "location",
      "scopeIds",
      "classification",
      "statusReason",
      "boundedTest",
      "proof",
      "reviewer",
      "reviewedOn",
      "expiresOn",
      "disposition",
      "countedAsDetected",
    ],
    `mutation timeout ${entry.file}:${entry.id}`,
  );
  assert(entry.status === "Timeout", "Invalid timeout status.");
  assert(
    entry.classification === "proven-nontermination-timeout" &&
      entry.disposition === "accepted-detected-nontermination" &&
      entry.countedAsDetected === true,
    "Mutation timeout lacks a detected nontermination disposition.",
  );
  assertMeaningfulText(entry.proof, "Mutation timeout proof", 80);
  assert(
    /^Hit limit reached \(\d+\/\d+\)$/u.test(entry.statusReason),
    "Timeout reason is invalid.",
  );
  assert(entry.reviewer === classification.reviewer, "Timeout reviewer is inconsistent.");
  assert(entry.reviewedOn === classification.reviewedOn, "Timeout review date is inconsistent.");
  const reviewed = Date.parse(`${entry.reviewedOn}T00:00:00.000Z`);
  const expires = Date.parse(`${entry.expiresOn}T23:59:59.999Z`);
  assert(
    Number.isFinite(reviewed) && Number.isFinite(expires),
    "Timeout review dates are invalid.",
  );
  assert(expires > reviewed && expires > releaseTime, "Mutation timeout approval is expired.");
  assert(
    JSON.stringify(entry.scopeIds) === JSON.stringify(scopeIdsForFile(entry.file)),
    `Timeout scope mapping is stale: ${entry.file}:${entry.id}`,
  );
  assert(
    canonicalKey(declaredDescriptor(entry, true)) ===
      canonicalKey(descriptor(entry.file, reportEntry, true)),
    `Timeout descriptor is stale: ${entry.file}:${entry.id}`,
  );
  exactKeys(
    entry.boundedTest,
    ["file", "name", "vitestTimeoutMs", "strykerTimeoutMs"],
    `bounded timeout test ${entry.id}`,
  );
  assert(
    Number.isInteger(entry.boundedTest.vitestTimeoutMs) && entry.boundedTest.vitestTimeoutMs > 0,
    "Vitest timeout bound is invalid.",
  );
  assert(
    Number.isInteger(entry.boundedTest.strykerTimeoutMs) && entry.boundedTest.strykerTimeoutMs > 0,
    "Stryker timeout bound is invalid.",
  );
  const testPath = path.resolve(repositoryRoot, entry.boundedTest.file);
  assert(
    testPath.startsWith(`${repositoryRoot}${path.sep}`),
    "Timeout test path escapes repository.",
  );
  assert((await stat(testPath)).isFile(), "Bounded timeout test file is missing.");
  const testSource = await readFile(testPath, "utf8");
  const declaredTestNames = [...testSource.matchAll(/\b(?:it|test)\(\s*["']([^"']+)["']/gu)].map(
    (match) => match[1],
  );
  assert(
    declaredTestNames.some((name) => entry.boundedTest.name.endsWith(name)),
    "Bounded timeout test name is stale.",
  );
}

export function mutationReportFacts(report, options = {}) {
  exactKeys(
    report,
    ["files", "schemaVersion", "thresholds", "testFiles", "projectRoot", "config", "framework"],
    "mutation report",
  );
  assert(report.schemaVersion === "1.0", "Unsupported Stryker report schema.");
  assert(typeof report.files === "object" && report.files !== null, "Mutation files are missing.");
  assert(
    typeof report.testFiles === "object" && report.testFiles !== null,
    "Mutation test files are missing.",
  );
  const mutants = [];
  for (const [file, fileReport] of Object.entries(report.files).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    assert(
      /^backend\/src\/.+\.ts$/u.test(file) &&
        !file.includes("\\") &&
        path.posix.normalize(file) === file &&
        !file.split("/").some((segment) => segment === "." || segment === ".."),
      `Unsafe mutated source path: ${file}`,
    );
    assert(typeof fileReport.source === "string", `Mutation source is missing: ${file}`);
    assert(Array.isArray(fileReport.mutants), `Mutation inventory is missing: ${file}`);
    for (const mutant of fileReport.mutants) mutants.push({ file, mutant });
  }
  const sources = Object.entries(report.files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, fileReport]) => `${file}\0${fileReport.source}`)
    .join("\0");
  const testSources = Object.entries(report.testFiles)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, fileReport]) => {
      assert(
        /^backend\/(?:src|tests)\/.+\.(?:mjs|ts)$/u.test(file) &&
          !file.includes("\\") &&
          path.posix.normalize(file) === file &&
          !file.split("/").some((segment) => segment === "." || segment === ".."),
        `Unsafe mutation test path: ${file}`,
      );
      assert(typeof fileReport.source === "string", `Mutation test source is missing: ${file}`);
      return `${file}\0${fileReport.source}`;
    })
    .join("\0");
  const survivors = mutants
    .filter(({ mutant }) => mutant.status === "Survived" || mutant.status === "NoCoverage")
    .map(({ file, mutant }) => descriptor(file, mutant));
  const timeouts = mutants
    .filter(({ mutant }) => mutant.status === "Timeout")
    .map(({ file, mutant }) => descriptor(file, mutant, true));
  return {
    canonicalReportSha256: canonicalReportDigest(report, options.repositoryRoot),
    counts: statusCounts(mutants),
    selectedFileSetSha256: fileSetDigest(Object.keys(report.files)),
    selectedTestFileSetSha256: fileSetDigest(Object.keys(report.testFiles)),
    testSourceSetSha256: sha256(testSources),
    mutants,
    mutatedSourceSetSha256: sha256(sources),
    survivorInventory: survivors,
    survivorInventorySha256: inventoryDigest(survivors),
    timeoutInventory: timeouts,
    timeoutInventorySha256: inventoryDigest(timeouts),
  };
}

export async function validateMutationEvidence(options) {
  const { repositoryRoot, evidenceDirectory } = options;
  const releaseTime = Date.parse(options.releaseTimestamp ?? new Date().toISOString());
  assert(Number.isFinite(releaseTime), "Mutation release timestamp is invalid.");
  const sourcePath = path.join(
    repositoryRoot,
    "backend",
    "tooling",
    "verification",
    "mutation-survivor-classification.json",
  );
  const evidencePath = path.join(
    evidenceDirectory,
    "reports",
    "mutation",
    "survivor-classification.json",
  );
  const reportPath = path.join(evidenceDirectory, "reports", "mutation", "mutation.json");
  assert((await stat(sourcePath)).isFile(), "Committed mutation classification is missing.");
  assert((await stat(evidencePath)).isFile(), "Evidence mutation classification is missing.");
  assert(
    (await sha256File(sourcePath)) === (await sha256File(evidencePath)),
    "Evidence mutation classification is stale.",
  );

  const classification = JSON.parse(await readFile(evidencePath, "utf8"));
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  exactKeys(
    classification,
    [
      "schemaVersion",
      "reviewedOn",
      "reviewer",
      "reportBinding",
      "scoringPolicy",
      "runtimeAudit",
      "scopes",
      "classifications",
      "timeouts",
      "inventorySummary",
    ],
    "mutation classification",
  );
  assert(classification.schemaVersion === "1.0.0", "Unsupported mutation classification schema.");
  assertMeaningfulText(classification.reviewer, "Mutation reviewer", 12);
  assert(
    /^\d{4}-\d{2}-\d{2}$/u.test(classification.reviewedOn),
    "Mutation review date is invalid.",
  );
  const classificationReviewTime = Date.parse(`${classification.reviewedOn}T00:00:00.000Z`);
  assert(
    Number.isFinite(classificationReviewTime) && classificationReviewTime <= releaseTime,
    "Mutation review date is after the release timestamp.",
  );

  exactKeys(
    classification.reportBinding,
    [
      "path",
      "rawSha256",
      "canonicalReportSha256",
      "selectedFileSetSha256",
      "selectedTestFileSetSha256",
      "testSourceSetSha256",
      "mutationExecutionInputsSha256",
      "mutatedSourceSetSha256",
      "survivorInventorySha256",
      "timeoutInventorySha256",
      "strykerVersion",
      "configSha256",
      "digestAlgorithms",
    ],
    "mutation report binding",
  );
  assert(
    classification.reportBinding.path === "reports/mutation/mutation.json",
    "Mutation report binding path is invalid.",
  );
  for (const key of [
    "rawSha256",
    "canonicalReportSha256",
    "selectedFileSetSha256",
    "selectedTestFileSetSha256",
    "testSourceSetSha256",
    "mutationExecutionInputsSha256",
    "mutatedSourceSetSha256",
    "survivorInventorySha256",
    "timeoutInventorySha256",
    "configSha256",
  ]) {
    assert(/^[0-9a-f]{64}$/u.test(classification.reportBinding[key]), `Invalid ${key}.`);
  }
  exactKeys(
    classification.reportBinding.digestAlgorithms,
    [
      "canonicalReportSha256",
      "selectedFileSetSha256",
      "selectedTestFileSetSha256",
      "testSourceSetSha256",
      "mutationExecutionInputsSha256",
      "mutatedSourceSetSha256",
      "survivorInventorySha256",
      "timeoutInventorySha256",
    ],
    "mutation digest algorithms",
  );

  assert(
    report.projectRoot === repositoryRoot || report.projectRoot === repositoryRootToken,
    "Mutation project root is neither exact nor the documented sanitized token.",
  );
  assert(
    JSON.stringify(report.config?.mutate) === JSON.stringify(expectedMutatePatterns),
    "Mutation report selectors are stale or unsupported.",
  );
  assert(
    report.config?.vitest?.configFile === "backend/vitest.mutation.config.ts" &&
      report.config.vitest.related === false,
    "Mutation Vitest configuration is stale or does not run the complete candidate test set.",
  );
  const selectedFiles = await currentSelectedMutationFiles(repositoryRoot);
  const reportedFiles = Object.keys(report.files).sort();
  assert(
    JSON.stringify(reportedFiles) === JSON.stringify(selectedFiles),
    "Mutation report file set does not exactly match the current Stryker selection.",
  );
  const selectedTests = await currentSelectedMutationTests(repositoryRoot);
  const reportedTests = Object.keys(report.testFiles).sort();
  assert(
    JSON.stringify(reportedTests) === JSON.stringify(selectedTests),
    "Mutation report test file set does not exactly match the current Vitest selection.",
  );

  const facts = mutationReportFacts(report, { repositoryRoot });
  const backendSourceRoot = path.join(repositoryRoot, "backend", "src");
  for (const [file, fileReport] of Object.entries(report.files)) {
    const sourcePath = path.resolve(repositoryRoot, file);
    assert(
      sourcePath.startsWith(`${backendSourceRoot}${path.sep}`),
      `Mutated source path escapes backend/src: ${file}`,
    );
    assert((await stat(sourcePath)).isFile(), `Current mutated source is missing: ${file}`);
    assert(
      (await readFile(sourcePath, "utf8")) === fileReport.source,
      `Mutation report source bytes are stale: ${file}`,
    );
  }
  const backendRoot = path.join(repositoryRoot, "backend");
  for (const [file, fileReport] of Object.entries(report.testFiles)) {
    const testPath = path.resolve(repositoryRoot, file);
    assert(
      testPath.startsWith(`${backendRoot}${path.sep}`),
      `Mutation test path escapes backend: ${file}`,
    );
    assert((await stat(testPath)).isFile(), `Current mutation test is missing: ${file}`);
    assert(
      (await readFile(testPath, "utf8")) === fileReport.source,
      `Mutation report test bytes are stale: ${file}`,
    );
  }
  assert(facts.counts.RuntimeError === 0, "Mutation report contains RuntimeError entries.");
  assert(
    facts.counts.CompileError === 0,
    "Mutation report contains unaudited CompileError entries.",
  );
  assert(facts.counts.NoCoverage === 0, "Mutation report contains NoCoverage entries.");
  assert(
    report.framework?.version === classification.reportBinding.strykerVersion,
    "Stryker version binding is stale.",
  );
  assert(
    (await sha256File(path.join(repositoryRoot, "stryker.config.mjs"))) ===
      classification.reportBinding.configSha256,
    "Stryker configuration binding is stale.",
  );
  assert(
    facts.canonicalReportSha256 === classification.reportBinding.canonicalReportSha256,
    "Canonical mutation report binding is stale.",
  );
  assert(
    facts.selectedFileSetSha256 === classification.reportBinding.selectedFileSetSha256,
    "Selected mutation file-set binding is stale.",
  );
  assert(
    facts.selectedTestFileSetSha256 === classification.reportBinding.selectedTestFileSetSha256,
    "Selected mutation test file-set binding is stale.",
  );
  assert(
    facts.testSourceSetSha256 === classification.reportBinding.testSourceSetSha256,
    "Mutation test source-set binding is stale.",
  );
  const executionInputs = await mutationExecutionInputs(repositoryRoot);
  assert(
    executionInputs.sha256 === classification.reportBinding.mutationExecutionInputsSha256,
    "Mutation execution-input binding is stale.",
  );
  assert(
    facts.mutatedSourceSetSha256 === classification.reportBinding.mutatedSourceSetSha256,
    "Mutated source-set binding is stale.",
  );
  assert(
    facts.survivorInventorySha256 === classification.reportBinding.survivorInventorySha256,
    "Mutation survivor inventory binding is stale.",
  );
  assert(
    facts.timeoutInventorySha256 === classification.reportBinding.timeoutInventorySha256,
    "Mutation timeout inventory binding is stale.",
  );

  const rawSha256 = await sha256File(reportPath);
  const bindingMode =
    rawSha256 === classification.reportBinding.rawSha256
      ? "exact-raw-report"
      : "canonical-report-with-repository-root-redaction";

  assert(Array.isArray(classification.classifications), "Mutation classifications are missing.");
  assert(Array.isArray(classification.timeouts), "Mutation timeout classifications are missing.");
  assertExactInventory(
    facts.survivorInventory,
    classification.classifications.map((entry) => declaredDescriptor(entry)),
    "Mutation survivor classification",
  );
  assertExactInventory(
    facts.timeoutInventory,
    classification.timeouts.map((entry) => declaredDescriptor(entry, true)),
    "Mutation timeout classification",
  );

  const reportByDescriptor = new Map(
    facts.mutants.map(({ file, mutant }) => [canonicalKey(descriptor(file, mutant)), mutant]),
  );
  for (const entry of classification.classifications) {
    const reportEntry = reportByDescriptor.get(canonicalKey(declaredDescriptor(entry)));
    assert(reportEntry !== undefined, `Classified mutant is absent: ${entry.file}:${entry.id}`);
    validateClassificationEntry(entry, reportEntry, classification, releaseTime);
  }
  const reportTimeoutByDescriptor = new Map(
    facts.mutants
      .filter(({ mutant }) => mutant.status === "Timeout")
      .map(({ file, mutant }) => [canonicalKey(descriptor(file, mutant, true)), mutant]),
  );
  for (const entry of classification.timeouts) {
    const reportEntry = reportTimeoutByDescriptor.get(
      canonicalKey(declaredDescriptor(entry, true)),
    );
    assert(reportEntry !== undefined, `Timeout mutant is absent: ${entry.file}:${entry.id}`);
    await validateTimeoutEntry(entry, reportEntry, classification, repositoryRoot, releaseTime);
  }

  exactKeys(
    classification.scoringPolicy,
    [
      "denominatorStatuses",
      "canonicalNumerator",
      "conservativeNumerator",
      "runtimeErrorPolicy",
      "compileErrorPolicy",
      "equivalentPolicy",
      "scorePrecisionDecimals",
    ],
    "mutation scoring policy",
  );
  assert(
    JSON.stringify(classification.scoringPolicy.denominatorStatuses) ===
      JSON.stringify(["Killed", "Survived", "NoCoverage", "Timeout"]),
    "Mutation denominator policy is invalid.",
  );
  assert(classification.scoringPolicy.scorePrecisionDecimals === 6, "Score precision is invalid.");

  assert(Array.isArray(classification.scopes), "Mutation scopes are missing.");
  assert(
    JSON.stringify(classification.scopes.map((scope) => scope.id)) ===
      JSON.stringify(Object.keys(expectedScopes)),
    "Mutation scope inventory or order is invalid.",
  );
  for (const recorded of classification.scopes) {
    exactKeys(
      recorded,
      [
        "id",
        "selectors",
        "thresholdPercent",
        "counts",
        "canonicalScorePercent",
        "conservativeScorePercent",
        "pass",
        "additionalRule",
      ],
      `mutation scope ${recorded.id}`,
    );
    const expected = expectedScopes[recorded.id];
    assert(expected !== undefined, `Unknown mutation scope: ${recorded.id}`);
    assert(
      JSON.stringify(recorded.selectors) === JSON.stringify(expected.selectors),
      `Mutation selectors are stale: ${recorded.id}`,
    );
    assert(
      recorded.thresholdPercent === expected.thresholdPercent,
      `Mutation threshold changed: ${recorded.id}`,
    );
    const selected = facts.mutants.filter(({ file }) => expected.includes(file));
    const counts = statusCounts(selected);
    const denominator = counts.Killed + counts.Survived + counts.NoCoverage + counts.Timeout;
    const detectedTimeouts = classification.timeouts.filter(
      (entry) => entry.countedAsDetected && entry.scopeIds.includes(recorded.id),
    ).length;
    const canonicalScore = roundScore((100 * (counts.Killed + detectedTimeouts)) / denominator);
    const conservativeScore = roundScore((100 * counts.Killed) / denominator);
    const expectedCounts = {
      killed: counts.Killed,
      survived: counts.Survived,
      noCoverage: counts.NoCoverage,
      timeout: counts.Timeout,
      denominator,
    };
    exactKeys(recorded.counts, Object.keys(expectedCounts), `mutation counts ${recorded.id}`);
    assert(
      canonicalKey(recorded.counts) === canonicalKey(expectedCounts),
      `Mutation counts are stale: ${recorded.id}`,
    );
    assert(
      recorded.canonicalScorePercent === canonicalScore,
      `Canonical score is stale: ${recorded.id}`,
    );
    assert(
      recorded.conservativeScorePercent === conservativeScore,
      `Conservative score is stale: ${recorded.id}`,
    );
    assert(
      canonicalScore >= expected.thresholdPercent,
      `Canonical mutation threshold failed: ${recorded.id}`,
    );
    assert(
      conservativeScore >= expected.thresholdPercent,
      `Conservative mutation threshold failed: ${recorded.id}`,
    );
    assert(recorded.pass === true, `Mutation scope is not passed: ${recorded.id}`);
    exactKeys(
      recorded.additionalRule,
      ["rule", "pass", "basis"],
      `mutation additional rule ${recorded.id}`,
    );
    assert(
      recorded.additionalRule.pass === true,
      `Mutation additional rule failed: ${recorded.id}`,
    );
    assertMeaningfulText(recorded.additionalRule.basis, `Mutation rule basis ${recorded.id}`, 30);
    const unresolved = classification.classifications.filter((entry) =>
      entry.scopeIds.includes(recorded.id),
    );
    assert(
      unresolved.every((entry) => entry.classification === "equivalent"),
      `Behavioral survivor remains in ${recorded.id}.`,
    );
    if (recorded.id === "QA-MUT-003") {
      assert(
        counts.Survived + counts.NoCoverage + counts.Timeout === 0,
        "Publication authorization/state scope has unresolved mutants.",
      );
    }
  }

  exactKeys(
    classification.inventorySummary,
    [
      "survived",
      "noCoverage",
      "timeout",
      "runtimeError",
      "compileError",
      "classifiedSurvived",
      "classifiedNoCoverage",
      "classifiedTimeout",
      "unclassified",
    ],
    "mutation inventory summary",
  );
  const expectedSummary = {
    survived: facts.counts.Survived,
    noCoverage: facts.counts.NoCoverage,
    timeout: facts.counts.Timeout,
    runtimeError: facts.counts.RuntimeError,
    compileError: facts.counts.CompileError,
    classifiedSurvived: classification.classifications.filter(
      (entry) => entry.status === "Survived",
    ).length,
    classifiedNoCoverage: classification.classifications.filter(
      (entry) => entry.status === "NoCoverage",
    ).length,
    classifiedTimeout: classification.timeouts.length,
    unclassified: 0,
  };
  assert(
    canonicalKey(classification.inventorySummary) === canonicalKey(expectedSummary),
    "Mutation inventory summary is stale.",
  );

  exactKeys(
    classification.runtimeAudit,
    ["acceptedReport", "rejectedHarnessRun", "stabilizationProbe"],
    "mutation runtime audit",
  );
  exactKeys(
    classification.runtimeAudit.acceptedReport,
    [
      "generatedMutants",
      "dryRunTests",
      "elapsedSeconds",
      "statusCounts",
      "workerCrashObserved",
      "harness",
    ],
    "accepted mutation runtime audit",
  );
  exactKeys(
    classification.runtimeAudit.acceptedReport.harness,
    [
      "strykerConcurrency",
      "disableBail",
      "testRunnerProcesses",
      "checkerProcesses",
      "vitestFileParallelism",
      "vitestMaxWorkers",
    ],
    "accepted mutation harness",
  );
  assert(
    classification.runtimeAudit.acceptedReport.harness.disableBail === true &&
      classification.runtimeAudit.acceptedReport.harness.vitestFileParallelism === false &&
      classification.runtimeAudit.acceptedReport.harness.vitestMaxWorkers === 1,
    "Accepted mutation harness is not stabilized.",
  );
  assert(
    classification.runtimeAudit.acceptedReport.generatedMutants === facts.mutants.length,
    "Mutation runtime-audit total is stale.",
  );
  assert(
    canonicalKey(classification.runtimeAudit.acceptedReport.statusCounts) ===
      canonicalKey(facts.counts),
    "Mutation runtime-audit counts are stale.",
  );
  assert(
    classification.runtimeAudit.acceptedReport.workerCrashObserved === false,
    "Mutation worker crash was observed.",
  );
  exactKeys(
    classification.runtimeAudit.rejectedHarnessRun,
    [
      "statusCounts",
      "reasonTaxonomy",
      "rawReportPreserved",
      "preservedAs",
      "rawSha256",
      "disposition",
    ],
    "rejected mutation harness audit",
  );
  assert(
    classification.runtimeAudit.rejectedHarnessRun.statusCounts.RuntimeError > 0,
    "Rejected mutation harness has no recorded runtime errors.",
  );
  assert(
    Array.isArray(classification.runtimeAudit.rejectedHarnessRun.reasonTaxonomy) &&
      classification.runtimeAudit.rejectedHarnessRun.reasonTaxonomy.length > 0,
    "Rejected mutation runtime-error taxonomy is missing.",
  );
  assertMeaningfulText(
    classification.runtimeAudit.rejectedHarnessRun.disposition,
    "Rejected mutation disposition",
    40,
  );
  assert(
    classification.runtimeAudit.rejectedHarnessRun.rawReportPreserved === true,
    "Rejected mutation report preservation is inaccurate.",
  );
  const rejectedReportPath = path.resolve(
    repositoryRoot,
    classification.runtimeAudit.rejectedHarnessRun.preservedAs,
  );
  assert(
    rejectedReportPath.startsWith(`${repositoryRoot}${path.sep}`),
    "Rejected mutation report path escapes the repository.",
  );
  assert(
    (await sha256File(rejectedReportPath)) ===
      classification.runtimeAudit.rejectedHarnessRun.rawSha256,
    "Rejected mutation report evidence is stale.",
  );
  exactKeys(
    classification.runtimeAudit.stabilizationProbe,
    ["scope", "generatedMutants", "RuntimeError", "CompileError", "elapsedSeconds"],
    "mutation stabilization probe",
  );
  assert(
    classification.runtimeAudit.stabilizationProbe.RuntimeError === 0 &&
      classification.runtimeAudit.stabilizationProbe.CompileError === 0,
    "Mutation stabilization probe contains runner errors.",
  );

  return {
    schemaVersion: 1,
    bindingMode,
    rawSha256,
    reviewedRawSha256: classification.reportBinding.rawSha256,
    canonicalReportSha256: facts.canonicalReportSha256,
    selectedFileSetSha256: facts.selectedFileSetSha256,
    selectedTestFileSetSha256: facts.selectedTestFileSetSha256,
    testSourceSetSha256: facts.testSourceSetSha256,
    mutationExecutionInputsSha256: executionInputs.sha256,
    mutatedSourceSetSha256: facts.mutatedSourceSetSha256,
    survivorInventorySha256: facts.survivorInventorySha256,
    timeoutInventorySha256: facts.timeoutInventorySha256,
    statusCounts: facts.counts,
    scopeScores: Object.fromEntries(
      classification.scopes.map((scope) => [
        scope.id,
        {
          canonical: scope.canonicalScorePercent,
          conservative: scope.conservativeScorePercent,
        },
      ]),
    ),
  };
}
