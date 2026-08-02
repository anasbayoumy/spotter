import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  compactEvidenceRoot,
  DefectEvidenceIntegrityError,
  localRawEvidenceRoot,
  validateCompactFailureSummary,
  validateCompactFirstFailure,
} from "./defect-evidence.mjs";
import { repositoryRoot, sourceState } from "./evidence-common.mjs";

const historyPath = path.join(
  repositoryRoot,
  "backend",
  "tooling",
  "verification",
  "defect-history.json",
);

async function readHistory() {
  return JSON.parse(await readFile(historyPath, "utf8"));
}

test("runtime defects use compact, digest-bound public summaries", async () => {
  const history = await readHistory();
  const runtimeFailures = history.records.filter(
    (record) => record.firstFailure.kind === "runtime-failure",
  );
  assert(runtimeFailures.length > 0);
  const inventory = new Set((await sourceState()).files);

  for (const record of runtimeFailures) {
    assert.equal(record.firstFailure.artifacts.length, 1, record.id);
    await validateCompactFirstFailure({
      artifact: record.firstFailure.artifacts[0],
      record,
      sourceInventory: inventory,
    });
  }

  const publicSources = runtimeFailures.map((record) => record.firstFailure.artifacts[0].source);
  assert.equal(new Set(publicSources).size, runtimeFailures.length);
  assert(publicSources.every((source) => source.startsWith(`${compactEvidenceRoot}/`)));
});

test("raw captures are excluded from release source inventory", async () => {
  const rawInventory = (await sourceState()).files.filter((file) =>
    file.startsWith(`${localRawEvidenceRoot}/`),
  );
  assert.deepEqual(rawInventory, [`${localRawEvidenceRoot}/.gitignore`]);
});

test("compact summaries reject embedded payloads and stale failure facts", async () => {
  const history = await readHistory();
  const record = history.records.find((candidate) => candidate.id === "DEF-004");
  assert(record !== undefined);
  const source = path.join(repositoryRoot, record.firstFailure.artifacts[0].source);
  const summary = JSON.parse(await readFile(source, "utf8"));

  const embeddedPayload = structuredClone(summary);
  embeddedPayload.rawEvidence.payload = "raw log content";
  assert.throws(
    () => validateCompactFailureSummary({ record, summary: embeddedPayload }),
    DefectEvidenceIntegrityError,
  );

  const staleFacts = structuredClone(summary);
  staleFacts.failure.note = "A different failure description.";
  assert.throws(
    () => validateCompactFailureSummary({ record, summary: staleFacts }),
    /Compact summary note is stale/u,
  );

  const escapedRawPath = structuredClone(summary);
  escapedRawPath.rawEvidence.artifacts[0].path = "../../private.log";
  assert.throws(
    () => validateCompactFailureSummary({ record, summary: escapedRawPath }),
    /Raw evidence path is non-canonical/u,
  );
});
