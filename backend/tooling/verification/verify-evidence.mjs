import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  repositoryRoot,
  requirementInventory,
  sha256File,
  sourceState,
  walkFiles,
} from "./evidence-common.mjs";
import { isCanonicalRequirementId } from "./evidence-validation.mjs";
import { validateMutationEvidence } from "./mutation-evidence.mjs";

const evidenceRoot = path.join(repositoryRoot, "artifacts", "verification");
const requested = process.argv[2];

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

function safeArtifactPath(directory, relative, label) {
  assert(typeof relative === "string" && relative.length > 0, `${label} path is empty.`);
  const target = path.resolve(directory, relative);
  assert(
    target.startsWith(`${directory}${path.sep}`),
    `${label} escapes the evidence directory: ${relative}`,
  );
  return target;
}

function safeRepositoryPath(relative, label) {
  assert(
    typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative),
    `${label} path is unsafe.`,
  );
  const target = path.resolve(repositoryRoot, relative);
  assert(target.startsWith(`${repositoryRoot}${path.sep}`), `${label} escapes the repository.`);
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

async function hasManifest(directory) {
  try {
    return (await stat(path.join(directory, "manifest.json"))).isFile();
  } catch {
    return false;
  }
}

async function selectDirectory() {
  if (requested !== undefined) {
    assert(/^[A-Za-z0-9-]+$/u.test(requested), "Requested evidence run ID is unsafe.");
    const selected = path.join(evidenceRoot, requested);
    assert(await hasManifest(selected), `Evidence run has no manifest: ${requested}`);
    return selected;
  }
  const entries = await readdir(evidenceRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(evidenceRoot, entry.name);
    if (await hasManifest(candidate)) candidates.push(candidate);
  }
  candidates.sort();
  const selected = candidates.at(-1);
  assert(selected !== undefined, "No evidence manifest is available.");
  return selected;
}

const directory = await selectDirectory();
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
const manifestSchema = JSON.parse(
  await readFile(
    path.join(repositoryRoot, "backend", "infra", "evidence", "manifest.schema.json"),
    "utf8",
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateManifest = ajv.compile(manifestSchema);
assert(
  validateManifest(manifest),
  `Manifest JSON Schema validation failed: ${ajv.errorsText(validateManifest.errors, { separator: "; " })}`,
);
exactKeys(
  manifest,
  [
    "schemaVersion",
    "runId",
    "suite",
    "revision",
    "startedAt",
    "finishedAt",
    "environment",
    "sourceContracts",
    "commands",
    "requirements",
    "exceptions",
    "verdict",
  ],
  "manifest",
);
assert(manifest.schemaVersion === 1, "Unsupported evidence schema version.");
assert(manifest.suite === "full", "Evidence is not a full release suite.");
assert(manifest.verdict === "pass", `Evidence verdict is not pass: ${String(manifest.verdict)}`);
assert(
  manifest.runId === path.basename(directory),
  "Manifest run ID does not match its directory.",
);
assert(!Number.isNaN(Date.parse(manifest.startedAt)), "Manifest start time is invalid.");
assert(!Number.isNaN(Date.parse(manifest.finishedAt)), "Manifest finish time is invalid.");
assert(
  Date.parse(manifest.finishedAt) >= Date.parse(manifest.startedAt),
  "Manifest time range is invalid.",
);

exactKeys(manifest.environment, ["node", "pnpm", "docker", "compose", "git", "os"], "environment");
for (const [name, value] of Object.entries(manifest.environment)) {
  assert(typeof value === "string" && value.length > 0, `Environment value is missing: ${name}`);
  assert(value !== "unavailable", `Required environment tool is unavailable: ${name}`);
}

exactKeys(
  manifest.revision,
  ["contentHash", "dirty", "fileCount", "git", "sourceStable"],
  "revision",
);
assert(/^[0-9a-f]{40}$/u.test(manifest.revision.git), "Revision Git SHA is invalid.");
assert(
  /^sha256:[0-9a-f]{64}$/u.test(manifest.revision.contentHash),
  "Revision content hash is invalid.",
);
assert(manifest.revision.dirty === false, "A final pass must be produced from a clean worktree.");
assert(manifest.revision.sourceStable === true, "Source changed during verification.");

const currentSource = await sourceState();
assert(
  currentSource.dirty === false,
  "Current worktree is dirty; evidence cannot be reproduced exactly.",
);
assert(currentSource.git === manifest.revision.git, "Evidence Git revision is stale.");
assert(
  currentSource.contentHash === manifest.revision.contentHash,
  "Evidence content hash is stale.",
);
assert(
  currentSource.fileCount === manifest.revision.fileCount,
  "Evidence owned-file count is stale.",
);

assert(
  Array.isArray(manifest.sourceContracts) && manifest.sourceContracts.length > 0,
  "Source contracts are missing.",
);
for (const contract of manifest.sourceContracts) {
  exactKeys(contract, ["path", "sha256"], `source contract ${String(contract?.path)}`);
  assert(/^DOCS\//u.test(contract.path), `Source contract is outside DOCS: ${contract.path}`);
  const target = path.resolve(repositoryRoot, contract.path);
  assert(
    target.startsWith(`${path.join(repositoryRoot, "DOCS")}${path.sep}`),
    `Unsafe source contract: ${contract.path}`,
  );
  assert(
    (await sha256File(target)) === contract.sha256,
    `Source contract hash is stale: ${contract.path}`,
  );
}

const expectedScripts = [
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
assert(Array.isArray(manifest.commands), "Manifest commands are missing.");
assert(
  JSON.stringify(manifest.commands.map((command) => command.script)) ===
    JSON.stringify(expectedScripts),
  "Manifest command inventory/order is incomplete.",
);
for (const [index, command] of manifest.commands.entries()) {
  exactKeys(
    command,
    [
      "id",
      "command",
      "script",
      "startedAt",
      "finishedAt",
      "durationMs",
      "exitCode",
      "log",
      "logSha256",
      "attempt",
      "testCounts",
    ],
    `command ${String(index + 1)}`,
  );
  assert(
    command.id === `cmd-${String(index + 1).padStart(3, "0")}`,
    `Command ID is out of sequence: ${command.id}`,
  );
  assert(
    command.command === `pnpm run ${command.script}`,
    `Command text is not canonical: ${command.id}`,
  );
  assert(command.exitCode === 0, `Command failed: ${command.id}`);
  assert(command.attempt === 1, `Blocking command was retried: ${command.id}`);
  assert(
    Number.isInteger(command.durationMs) && command.durationMs >= 0,
    `Command duration is invalid: ${command.id}`,
  );
  exactKeys(
    command.testCounts,
    ["discovered", "executed", "kind", "retried", "skipped"],
    `counts ${command.id}`,
  );
  assert(command.testCounts.discovered >= 1, `Command discovered no checks: ${command.id}`);
  assert(command.testCounts.executed >= 1, `Command executed no checks: ${command.id}`);
  assert(command.testCounts.skipped === 0, `Blocking command has skipped checks: ${command.id}`);
  assert(command.testCounts.retried === 0, `Blocking command has retries: ${command.id}`);
  const log = safeArtifactPath(directory, command.log, `command ${command.id}`);
  assert((await stat(log)).isFile(), `Command log is missing: ${command.log}`);
  assert(
    (await sha256File(log)) === command.logSha256,
    `Command log hash is stale: ${command.log}`,
  );
}

const expectedRequirements = await requirementInventory();
assert(Array.isArray(manifest.requirements), "Requirement evidence is missing.");
const actualRequirements = manifest.requirements.map((requirement) => requirement.id);
assert(
  JSON.stringify(actualRequirements) === JSON.stringify(expectedRequirements),
  "Requirement inventory is incomplete or duplicated.",
);
for (const requirement of manifest.requirements) {
  const keys =
    requirement.id === "QA-MOB-006"
      ? ["id", "status", "evidence", "exception"]
      : ["id", "status", "evidence"];
  exactKeys(requirement, keys, `requirement ${requirement.id}`);
  if (requirement.id === "QA-MOB-006") {
    assert(requirement.status === "not-run", "QA-MOB-006 must be accurately not-run.");
    assert(requirement.exception === "ENV-MOB-001", "QA-MOB-006 exception is invalid.");
  } else {
    assert(requirement.status === "passed", `Requirement is not passed: ${requirement.id}`);
  }
  assert(
    Array.isArray(requirement.evidence) && requirement.evidence.length > 0,
    `Requirement lacks evidence: ${requirement.id}`,
  );
  for (const relative of requirement.evidence) {
    const target = safeArtifactPath(directory, relative, `requirement ${requirement.id}`);
    assert(
      (await stat(target)).isFile(),
      `Requirement evidence is missing: ${requirement.id} -> ${relative}`,
    );
  }
}

assert(
  Array.isArray(manifest.exceptions) && manifest.exceptions.length === 1,
  "Unexpected release exceptions.",
);
const [exception] = manifest.exceptions;
exactKeys(exception, ["id", "reason", "status"], "release exception");
assert(
  exception.id === "ENV-MOB-001" && exception.status === "not-run",
  "Native exception is inaccurate.",
);
assert(
  typeof exception.reason === "string" && exception.reason.length >= 20,
  "Native exception has no reason.",
);

const requiredArtifacts = [
  "environment.json",
  "manifest.json",
  "checksums.sha256",
  "reports/defects/defect-history.json",
  "reports/defects/source-digest-verification.json",
  "reports/traceability.json",
  "reports/mutation/mutation.json",
  "reports/mutation/survivor-classification.json",
  "reports/mutation/binding-verification.json",
  "FINAL-QUALITY-REPORT.md",
  "KNOWN-LIMITATIONS.md",
];
for (const relative of requiredArtifacts) {
  assert(
    (await stat(path.join(directory, relative))).isFile(),
    `Required artifact is missing: ${relative}`,
  );
}

const mutationBinding = await validateMutationEvidence({
  evidenceDirectory: directory,
  releaseTimestamp: manifest.finishedAt,
  repositoryRoot,
});
const recordedMutationBinding = JSON.parse(
  await readFile(path.join(directory, "reports", "mutation", "binding-verification.json"), "utf8"),
);
assert(
  JSON.stringify(recordedMutationBinding) === JSON.stringify(mutationBinding),
  "Mutation binding verification is stale or incomplete.",
);

const defectSourcePath = path.join(
  repositoryRoot,
  "backend",
  "tooling",
  "verification",
  "defect-history.json",
);
const defectEvidencePath = path.join(directory, "reports", "defects", "defect-history.json");
assert(
  (await sha256File(defectSourcePath)) === (await sha256File(defectEvidencePath)),
  "Evidence defect history does not match its committed source.",
);
const defectHistory = JSON.parse(await readFile(defectEvidencePath, "utf8"));
exactKeys(
  defectHistory,
  ["schemaVersion", "documentedOn", "releaseGateStatus", "records"],
  "defect history",
);
assert(defectHistory.schemaVersion === 1, "Unsupported defect-history schema version.");
assert(!Number.isNaN(Date.parse(defectHistory.documentedOn)), "Defect-history date is invalid.");
assert(
  defectHistory.releaseGateStatus === "passed",
  `Defect history is not release-passed: ${String(defectHistory.releaseGateStatus)}`,
);
assert(
  Array.isArray(defectHistory.records) && defectHistory.records.length > 0,
  "Defect history has no records.",
);

const proofDocument = JSON.parse(
  await readFile(
    path.join(directory, "reports", "defects", "source-digest-verification.json"),
    "utf8",
  ),
);
exactKeys(proofDocument, ["schemaVersion", "source", "proofs"], "defect digest proof");
assert(proofDocument.schemaVersion === 1, "Unsupported defect digest proof version.");
assert(
  proofDocument.source === "backend/tooling/verification/defect-history.json",
  "Defect digest proof source is invalid.",
);
assert(Array.isArray(proofDocument.proofs), "Defect digest proofs are missing.");

const defectIds = new Set();
const declaredArtifacts = [];
for (const [index, record] of defectHistory.records.entries()) {
  exactKeys(
    record,
    [
      "id",
      "title",
      "classification",
      "requirements",
      "status",
      "firstFailure",
      "diagnosis",
      "fix",
      "regressionEvidence",
      "validation",
    ],
    `defect ${String(index + 1)}`,
  );
  assert(
    record.id === `DEF-${String(index + 1).padStart(3, "0")}`,
    `Defect ID is out of sequence: ${record.id}`,
  );
  assert(!defectIds.has(record.id), `Duplicate defect ID: ${record.id}`);
  defectIds.add(record.id);
  assert(
    new Set(["environment", "performance", "product", "security", "test"]).has(
      record.classification,
    ),
    `Defect classification is invalid: ${record.id}`,
  );
  for (const field of ["title", "diagnosis", "fix"]) {
    assert(
      typeof record[field] === "string" && record[field].length >= 20,
      `Defect ${record.id} has an incomplete ${field}.`,
    );
  }
  assert(
    record.status === "fixed-release-validated",
    `Defect is not release-validated: ${record.id} (${String(record.status)})`,
  );
  assert(
    Array.isArray(record.requirements) && record.requirements.length > 0,
    `Defect has no requirement mapping: ${record.id}`,
  );
  for (const requirement of record.requirements) {
    assert(
      isCanonicalRequirementId(requirement),
      `Defect requirement ID is invalid: ${record.id} -> ${String(requirement)}`,
    );
  }
  exactKeys(
    record.firstFailure,
    ["kind", "retention", "artifacts", "note"],
    `first failure ${record.id}`,
  );
  assert(
    typeof record.firstFailure.note === "string" && record.firstFailure.note.length >= 20,
    `Defect first-failure note is incomplete: ${record.id}`,
  );
  assert(
    Array.isArray(record.firstFailure.artifacts),
    `Defect artifacts are missing: ${record.id}`,
  );
  if (record.firstFailure.kind === "runtime-failure") {
    assert(
      record.firstFailure.retention === "retained",
      `Runtime failure is not retained: ${record.id}`,
    );
    assert(
      record.firstFailure.artifacts.length > 0,
      `Runtime failure has no artifact: ${record.id}`,
    );
  } else if (record.firstFailure.kind === "review-finding") {
    assert(
      record.firstFailure.retention === "not-applicable",
      `Review finding retention is invalid: ${record.id}`,
    );
    assert(
      record.firstFailure.artifacts.length === 0,
      `Review finding declares runtime artifacts: ${record.id}`,
    );
  } else {
    assert(
      record.firstFailure.kind === "unretained-local-run",
      `Defect failure kind is invalid: ${record.id}`,
    );
    assert(
      record.firstFailure.retention === "gap-disclosed",
      `Historical evidence gap is not disclosed: ${record.id}`,
    );
    assert(
      record.firstFailure.artifacts.length === 0,
      `Evidence-gap record declares an artifact: ${record.id}`,
    );
  }
  for (const artifact of record.firstFailure.artifacts) {
    const keys =
      artifact.type === "file"
        ? ["source", "releasePath", "type", "sourceSha256"]
        : ["source", "releasePath", "type", "sourceTreeSha256"];
    exactKeys(artifact, keys, `defect artifact ${record.id}`);
    assert(
      new Set(["file", "directory"]).has(artifact.type),
      `Defect artifact type is invalid: ${record.id}`,
    );
    assert(
      artifact.releasePath.startsWith("reports/"),
      `Defect release path is invalid: ${record.id}`,
    );
    const source = safeRepositoryPath(artifact.source, `Defect ${record.id} source`);
    const metadata = await stat(source);
    const digest =
      artifact.type === "file" && metadata.isFile()
        ? await sha256File(source)
        : artifact.type === "directory" && metadata.isDirectory()
          ? await treeSha256(source)
          : undefined;
    const expected = artifact.type === "file" ? artifact.sourceSha256 : artifact.sourceTreeSha256;
    assert(
      digest === expected,
      `Defect source digest is stale: ${record.id} -> ${artifact.source}`,
    );
    const destination = safeArtifactPath(directory, artifact.releasePath, `Defect ${record.id}`);
    await stat(destination);
    declaredArtifacts.push({
      defectId: record.id,
      digest,
      releasePath: artifact.releasePath,
      source: artifact.source,
      type: artifact.type,
    });
  }
  assert(
    Array.isArray(record.regressionEvidence) && record.regressionEvidence.length > 0,
    `Defect has no regression evidence: ${record.id}`,
  );
  for (const regression of record.regressionEvidence) {
    await stat(safeRepositoryPath(regression, `Defect ${record.id} regression`));
  }
  exactKeys(record.validation, ["status", "note"], `defect validation ${record.id}`);
  assert(
    record.validation.status === "release-pass",
    `Defect validation is not passed: ${record.id}`,
  );
  assert(
    typeof record.validation.note === "string" && record.validation.note.length >= 20,
    `Defect validation note is incomplete: ${record.id}`,
  );
}
assert(
  JSON.stringify(proofDocument.proofs) === JSON.stringify(declaredArtifacts),
  "Defect source digest proof does not exactly match declared artifacts.",
);

const checksumsText = await readFile(path.join(directory, "checksums.sha256"), "utf8");
const checksumEntries = new Map();
for (const line of checksumsText.trim().split("\n")) {
  const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
  assert(match !== null, `Malformed checksum line: ${line}`);
  assert(!checksumEntries.has(match[2]), `Duplicate checksum entry: ${match[2]}`);
  checksumEntries.set(match[2], match[1]);
}
const artifactFiles = (await walkFiles(directory))
  .map((file) => path.relative(directory, file).split(path.sep).join("/"))
  .filter((file) => file !== "checksums.sha256")
  .sort();
assert(
  JSON.stringify([...checksumEntries.keys()].sort()) === JSON.stringify(artifactFiles),
  "Checksum inventory does not exactly cover the evidence tree.",
);
for (const [relative, expected] of checksumEntries) {
  const actual = (await sha256File(safeArtifactPath(directory, relative, "checksum"))).slice(
    "sha256:".length,
  );
  assert(actual === expected, `Checksum mismatch: ${relative}`);
}

const sensitivePatterns = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u, "private key"],
  [/\b(?:sk|ghp|github_pat)-[A-Za-z0-9_-]{12,}\b/u, "credential token"],
  [/\bAKIA[0-9A-Z]{16}\b/u, "AWS access key"],
  [/postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/iu, "database credential"],
  [/\bAuthorization\s*:\s*Bearer\s+(?!<REDACTED>)[^\s<]+/iu, "authorization value"],
  [/\/Users\/[^/\s]+\//u, "host user path"],
  [/\/home\/[^/\s]+\//u, "host user path"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu, "email identity"],
];
const scannableExtensions = new Set([
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
  if (!scannableExtensions.has(path.extname(file))) continue;
  const content = await readFile(file, "utf8");
  for (const [pattern, label] of sensitivePatterns) {
    assert(
      !pattern.test(content),
      `Evidence privacy scan found ${label} in ${path.relative(directory, file)}.`,
    );
  }
  if (path.extname(file) !== ".md") continue;
  for (const link of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    const destination = link[1];
    if (/^(?:https?:|#)/u.test(destination)) continue;
    const resolved = path.resolve(path.dirname(file), destination);
    assert(
      resolved.startsWith(`${directory}${path.sep}`),
      `Markdown link escapes evidence: ${destination}`,
    );
    assert(
      (await stat(resolved)).isFile(),
      `Broken evidence link: ${path.relative(directory, file)} -> ${destination}`,
    );
  }
}

process.stdout.write(`Evidence manifest validated: ${path.relative(repositoryRoot, directory)}\n`);
