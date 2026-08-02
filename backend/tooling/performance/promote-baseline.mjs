import { createHash } from "node:crypto";
import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  acceptedMeasurementRecordPath,
  canonicalJson,
  createAcceptedBaselineIndex,
  createAcceptedMeasurementRecord,
  createBaselineCandidate,
  validateAcceptedBaseline,
} from "./evidence.mjs";
import { sourceState } from "../verification/evidence-common.mjs";
import { writeFileAtomically, writeImmutableOrConfirm } from "./persistence.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const evidenceRoot = await realpath(path.join(root, "artifacts", "verification"));
const { values } = parseArgs({
  allowPositionals: false,
  options: {
    "approval-reason": { type: "string" },
    "approved-at": { type: "string" },
    "approved-by": { type: "string" },
    "confirm-source-hash": { type: "string" },
    report: { type: "string" },
  },
  strict: true,
});

for (const required of [
  "approval-reason",
  "approved-at",
  "approved-by",
  "confirm-source-hash",
  "report",
]) {
  if (typeof values[required] !== "string" || values[required].trim().length === 0) {
    throw new Error(`Missing required --${required} value.`);
  }
}

const reportPath = await realpath(path.resolve(root, values.report));
const relativeToEvidence = path.relative(evidenceRoot, reportPath);
if (
  relativeToEvidence === "" ||
  relativeToEvidence.startsWith(`..${path.sep}`) ||
  path.isAbsolute(relativeToEvidence)
) {
  throw new Error("The promoted report must be inside artifacts/verification.");
}
const canonicalApprovedAt = new Date(values["approved-at"]).toISOString();
if (canonicalApprovedAt !== values["approved-at"]) {
  throw new Error("--approved-at must be a canonical ISO-8601 timestamp.");
}

const reportBytes = await readFile(reportPath);
const report = JSON.parse(reportBytes.toString("utf8"));
const candidate = report.baselineCandidate;
const recomputedCandidate = createBaselineCandidate(
  report.gates ?? [],
  report.environment,
  report.source?.before,
  { execution: report.execution, sourceAfter: report.source?.after },
);
if (
  report.profile !== "release" ||
  report.execution?.mode !== "fresh-owned-release" ||
  report.execution?.releaseEligible !== true ||
  candidate?.eligible !== true ||
  candidate.profile !== "release" ||
  report.cleanup?.passed !== true ||
  JSON.stringify(candidate) !== JSON.stringify(recomputedCandidate)
) {
  throw new Error(
    "Only a cleanup-complete release candidate with NFR-PERF-001..009 passing may be promoted.",
  );
}
if (candidate.source?.before?.contentHash !== values["confirm-source-hash"]) {
  throw new Error("--confirm-source-hash does not match the reviewed candidate source hash.");
}
const promotionSource = await sourceState();
createBaselineCandidate(report.gates ?? [], report.environment, candidate.source.before, {
  execution: report.execution,
  sourceAfter: promotionSource,
});

const record = createAcceptedMeasurementRecord(
  candidate,
  {
    acceptedAt: canonicalApprovedAt,
    approvedBy: values["approved-by"],
    reason: values["approval-reason"],
  },
  {
    path: path.relative(root, reportPath).split(path.sep).join("/"),
    sha256: `sha256:${createHash("sha256").update(reportBytes).digest("hex")}`,
  },
);
const recordPath = acceptedMeasurementRecordPath(record);
const recordBytes = Buffer.from(canonicalJson(record));
const baseline = createAcceptedBaselineIndex(record, recordPath);
const validation = validateAcceptedBaseline(baseline, {
  currentEnvironment: report.environment,
  recordBytes,
});
if (!validation.valid) throw new Error(validation.reason);

const recordDestination = path.join(root, recordPath);
await mkdir(path.dirname(recordDestination), { recursive: true });
const recordWrite = await writeImmutableOrConfirm(recordDestination, recordBytes);
const destination = path.join(import.meta.dirname, "baseline.json");
await writeFileAtomically(destination, Buffer.from(canonicalJson(baseline)));
process.stdout.write(
  `Promoted measured baseline from ${path.relative(root, reportPath)} to ${recordPath} (${recordWrite}).\n`,
);
