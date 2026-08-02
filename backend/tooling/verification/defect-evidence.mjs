import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { repositoryRoot, sha256File, walkFiles } from "./evidence-common.mjs";

export const compactEvidenceRoot = "DOCS/release/evidence/public/first-failures";
export const localRawEvidenceRoot = "DOCS/release/evidence/first-failures";
export const compactEvidencePolicy =
  "Raw captures remain immutable in the developer-local vault; this public summary retains reviewed failure facts and cryptographic provenance without publishing browser traces, videos, logs, or mutation payloads.";
export const maxCompactEvidenceBytes = 8 * 1024;

const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const treeSha256Pattern = /^tree-sha256:[0-9a-f]{64}$/u;

export class DefectEvidenceIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = "DefectEvidenceIntegrityError";
  }
}

function assert(condition, message) {
  if (!condition) throw new DefectEvidenceIntegrityError(message);
}

function exactKeys(value, keys, label) {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${label} must be an object.`,
  );
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} has unexpected keys: ${actual.join(", ")}.`,
  );
}

function resolveRepositoryPath(relative, label) {
  assert(
    typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative),
    `${label} is not a repository-relative path.`,
  );
  const resolved = path.resolve(repositoryRoot, relative);
  assert(
    resolved.startsWith(`${repositoryRoot}${path.sep}`),
    `${label} escapes the repository: ${relative}.`,
  );
  return resolved;
}

async function treeSha256(root) {
  const lines = [];
  for (const file of await walkFiles(root)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    lines.push(`${(await sha256File(file)).slice("sha256:".length)}  ${relative}\n`);
  }
  return `tree-sha256:${createHash("sha256").update(lines.join("")).digest("hex")}`;
}

async function validateAvailableRawArtifact(rawArtifact, defectId) {
  const source = resolveRepositoryPath(rawArtifact.path, `Raw evidence for ${defectId}`);
  let metadata;
  try {
    metadata = await stat(source);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const digest =
    rawArtifact.type === "file" && metadata.isFile()
      ? await sha256File(source)
      : rawArtifact.type === "directory" && metadata.isDirectory()
        ? await treeSha256(source)
        : undefined;
  assert(digest === rawArtifact.digest, `Local raw evidence digest is stale: ${rawArtifact.path}.`);
}

export async function validateCompactFirstFailure({ artifact, record, sourceInventory }) {
  const defectId = record?.id;
  assert(/^DEF-\d{3}$/u.test(defectId), "Compact evidence record has an invalid defect ID.");
  exactKeys(
    artifact,
    ["source", "releasePath", "type", "sourceSha256"],
    `Compact artifact ${defectId}`,
  );
  const expectedSource = `${compactEvidenceRoot}/${defectId}.json`;
  const expectedReleasePath = `reports/defects/first-failures/${defectId}.json`;
  assert(artifact.type === "file", `Compact evidence must be a file: ${defectId}.`);
  assert(
    artifact.source === expectedSource,
    `Compact evidence source is non-canonical: ${defectId}.`,
  );
  assert(
    artifact.releasePath === expectedReleasePath,
    `Compact evidence release path is non-canonical: ${defectId}.`,
  );
  assert(
    sha256Pattern.test(artifact.sourceSha256),
    `Compact evidence source digest is malformed: ${defectId}.`,
  );
  if (sourceInventory !== undefined) {
    assert(
      sourceInventory.has(artifact.source),
      `Compact evidence is ignored or absent from the Git source inventory: ${artifact.source}.`,
    );
  }

  const source = resolveRepositoryPath(artifact.source, `Compact evidence for ${defectId}`);
  const metadata = await stat(source);
  assert(metadata.isFile(), `Compact evidence is not a file: ${artifact.source}.`);
  assert(
    metadata.size <= maxCompactEvidenceBytes,
    `Compact evidence exceeds ${String(maxCompactEvidenceBytes)} bytes: ${artifact.source}.`,
  );
  assert(
    (await sha256File(source)) === artifact.sourceSha256,
    `Compact evidence digest is stale: ${artifact.source}.`,
  );

  const summary = JSON.parse(await readFile(source, "utf8"));
  const rawArtifacts = validateCompactFailureSummary({ record, summary });
  for (const rawArtifact of rawArtifacts) {
    await validateAvailableRawArtifact(rawArtifact, defectId);
  }

  return { digest: artifact.sourceSha256, summary };
}

export function validateCompactFailureSummary({ record, summary }) {
  const defectId = record?.id;
  assert(/^DEF-\d{3}$/u.test(defectId), "Compact evidence record has an invalid defect ID.");
  exactKeys(
    summary,
    ["schemaVersion", "defectId", "kind", "failure", "rawEvidence"],
    `Compact summary ${defectId}`,
  );
  assert(summary.schemaVersion === 1, `Compact summary schema is unsupported: ${defectId}.`);
  assert(summary.defectId === defectId, `Compact summary defect ID is mismatched: ${defectId}.`);
  assert(summary.kind === "compact-first-failure", `Compact summary kind is invalid: ${defectId}.`);

  exactKeys(summary.failure, ["diagnosis", "note", "title"], `Failure facts ${defectId}`);
  for (const field of ["diagnosis", "note", "title"]) {
    const expected = field === "note" ? record.firstFailure.note : record[field];
    assert(summary.failure[field] === expected, `Compact summary ${field} is stale: ${defectId}.`);
  }

  exactKeys(
    summary.rawEvidence,
    ["artifacts", "policy", "retention"],
    `Raw provenance ${defectId}`,
  );
  assert(
    summary.rawEvidence.retention === "developer-local-immutable",
    `Raw evidence retention is invalid: ${defectId}.`,
  );
  assert(
    summary.rawEvidence.policy === compactEvidencePolicy,
    `Raw evidence policy is stale: ${defectId}.`,
  );
  assert(
    Array.isArray(summary.rawEvidence.artifacts) && summary.rawEvidence.artifacts.length > 0,
    `Raw evidence provenance is missing: ${defectId}.`,
  );

  const seenRawPaths = new Set();
  for (const rawArtifact of summary.rawEvidence.artifacts) {
    exactKeys(rawArtifact, ["path", "type", "digest"], `Raw artifact ${defectId}`);
    const rawDefectRoot = `${localRawEvidenceRoot}/${defectId}`;
    assert(
      rawArtifact.path === rawDefectRoot || rawArtifact.path.startsWith(`${rawDefectRoot}/`),
      `Raw evidence path is non-canonical: ${rawArtifact.path}.`,
    );
    assert(
      !seenRawPaths.has(rawArtifact.path),
      `Raw evidence path is duplicated: ${rawArtifact.path}.`,
    );
    seenRawPaths.add(rawArtifact.path);
    assert(
      rawArtifact.type === "file" || rawArtifact.type === "directory",
      `Raw evidence type is invalid: ${rawArtifact.path}.`,
    );
    const digestPattern = rawArtifact.type === "file" ? sha256Pattern : treeSha256Pattern;
    assert(
      digestPattern.test(rawArtifact.digest),
      `Raw evidence digest is malformed: ${rawArtifact.path}.`,
    );
  }
  return summary.rawEvidence.artifacts;
}
