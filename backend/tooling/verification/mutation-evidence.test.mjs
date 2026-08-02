import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  mutationExecutionInputs,
  mutationReportFacts,
  validateMutationEvidence,
} from "./mutation-evidence.mjs";

const mutatePatterns = [
  "backend/src/domain/**/*.ts",
  "backend/src/evals/safety/**/*.ts",
  "backend/src/agents/context/**/*.ts",
  "backend/src/application/programmes.ts",
  "backend/src/application/accountability.ts",
  "backend/src/infrastructure/database/publish-programme.ts",
  "!**/*.test.ts",
  "!**/index.ts",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function report(status = "Survived", source = "export const value = 1;\n") {
  return {
    files: {
      "backend/src/domain/example.ts": {
        language: "typescript",
        mutants: [
          {
            id: "1",
            location: {
              end: { column: 23, line: 1 },
              start: { column: 22, line: 1 },
            },
            mutatorName: "ArithmeticOperator",
            replacement: "2",
            status,
            ...(status === "Timeout" ? { statusReason: "Hit limit reached (100/50)" } : {}),
          },
        ],
        source,
      },
    },
    schemaVersion: "1.0",
    thresholds: { break: 90, high: 95, low: 90 },
    testFiles: {},
    projectRoot: "/synthetic/repository",
    config: {
      mutate: mutatePatterns,
      vitest: { configFile: "backend/vitest.mutation.config.ts", related: false },
    },
    framework: { name: "StrykerJS", version: "9.2.0" },
  };
}

function killedMutant(id) {
  return {
    id,
    location: {
      end: { column: 23, line: 1 },
      start: { column: 22, line: 1 },
    },
    mutatorName: "ArithmeticOperator",
    replacement: "2",
    status: "Killed",
  };
}

function reportFile(source, mutants) {
  return { language: "typescript", mutants, source };
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createFixture() {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "spotter-mutation-evidence-"));
  const evidenceDirectory = path.join(repositoryRoot, "evidence");
  const sources = {
    "backend/src/evals/safety/example.ts": "export const safety = 1;\n",
    "backend/src/agents/context/example.ts": "export const context = 1;\n",
    "backend/src/domain/temporal.ts": "export const temporal = 1;\n",
    "backend/src/domain/programme.ts": "export const programme = 1;\n",
    "backend/src/application/programmes.ts": "export const programmes = 1;\n",
    "backend/src/infrastructure/database/publish-programme.ts": "export const publication = 1;\n",
    "backend/src/domain/accountability.ts": "export const accountability = 1;\n",
    "backend/src/application/accountability.ts": "export const accountabilityApp = 1;\n",
    "backend/src/domain/example.ts": "export const example = 1;\n",
  };
  const files = {};
  let id = 1;
  for (const [file, source] of Object.entries(sources)) {
    const mutants = [killedMutant(String(id))];
    id += 1;
    if (file === "backend/src/domain/example.ts") {
      mutants.push({
        id: String(id),
        location: {
          end: { column: 25, line: 1 },
          start: { column: 24, line: 1 },
        },
        mutatorName: "ConditionalExpression",
        replacement: "false",
        status: "Survived",
      });
    }
    files[file] = reportFile(source, mutants);
    const target = path.join(repositoryRoot, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source, "utf8");
  }
  const boundedTestSource = 'test("detects nontermination", () => {});\n';
  const mutationTestPath = "backend/src/domain/example.test.ts";
  const mutationReport = {
    files,
    schemaVersion: "1.0",
    thresholds: { break: 90, high: 95, low: 90 },
    testFiles: {
      [mutationTestPath]: {
        source: boundedTestSource,
        tests: [{ id: "fixture-test-1", name: "detects nontermination" }],
      },
    },
    projectRoot: repositoryRoot,
    config: {
      mutate: mutatePatterns,
      vitest: { configFile: "backend/vitest.mutation.config.ts", related: false },
    },
    framework: { name: "StrykerJS", version: "9.2.0" },
  };
  const reportDirectory = path.join(evidenceDirectory, "reports", "mutation");
  await mkdir(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, "mutation.json");
  await writeJson(reportPath, mutationReport);
  const reportBytes = await readFile(reportPath);
  const facts = mutationReportFacts(mutationReport);

  const config = "export default {};\n";
  await writeFile(path.join(repositoryRoot, "stryker.config.mjs"), config, "utf8");
  const rejectedRelative =
    "DOCS/release/evidence/first-failures/DEF-TEST/mutation-runtime-error-report.json";
  const rejectedPath = path.join(repositoryRoot, rejectedRelative);
  await mkdir(path.dirname(rejectedPath), { recursive: true });
  await writeFile(rejectedPath, "{}\n", "utf8");
  const testPath = path.join(repositoryRoot, mutationTestPath);
  await writeFile(testPath, boundedTestSource, "utf8");
  const executionInputs = await mutationExecutionInputs(repositoryRoot);

  const survivor = facts.survivorInventory[0];
  const reviewedOn = "2026-08-02";
  const reviewer = "fixture mutation reviewer";
  const scope = (scopeId, selectors, killed, survived, thresholdPercent) => {
    const denominator = killed + survived;
    const score = Number(((100 * killed) / denominator).toFixed(6));
    return {
      id: scopeId,
      selectors,
      thresholdPercent,
      counts: { killed, survived, noCoverage: 0, timeout: 0, denominator },
      canonicalScorePercent: score,
      conservativeScorePercent: score,
      pass: true,
      additionalRule: {
        rule: `Fixture additional rule for ${scopeId}.`,
        pass: true,
        basis: "Every unresolved fixture mutant is proven locally equivalent.",
      },
    };
  };
  const counts = facts.counts;
  const classification = {
    schemaVersion: "1.0.0",
    reviewedOn,
    reviewer,
    reportBinding: {
      path: "reports/mutation/mutation.json",
      rawSha256: sha256(reportBytes),
      canonicalReportSha256: facts.canonicalReportSha256,
      selectedFileSetSha256: facts.selectedFileSetSha256,
      selectedTestFileSetSha256: facts.selectedTestFileSetSha256,
      testSourceSetSha256: facts.testSourceSetSha256,
      mutationExecutionInputsSha256: executionInputs.sha256,
      mutatedSourceSetSha256: facts.mutatedSourceSetSha256,
      survivorInventorySha256: facts.survivorInventorySha256,
      timeoutInventorySha256: facts.timeoutInventorySha256,
      strykerVersion: "9.2.0",
      configSha256: sha256(config),
      digestAlgorithms: {
        canonicalReportSha256: "fixture canonical report digest",
        selectedFileSetSha256: "fixture selected file-set digest",
        selectedTestFileSetSha256: "fixture selected mutation test-file digest",
        testSourceSetSha256: "fixture mutation test-source digest",
        mutationExecutionInputsSha256: "fixture complete mutation execution-input digest",
        mutatedSourceSetSha256: "fixture source digest",
        survivorInventorySha256: "fixture survivor digest",
        timeoutInventorySha256: "fixture timeout digest",
      },
    },
    scoringPolicy: {
      denominatorStatuses: ["Killed", "Survived", "NoCoverage", "Timeout"],
      canonicalNumerator: "Killed plus proven timeout.",
      conservativeNumerator: "Killed only.",
      runtimeErrorPolicy: "Any RuntimeError invalidates the report.",
      compileErrorPolicy: "Only checker-proven compile errors may be excluded.",
      equivalentPolicy: "Equivalent survivors remain undetected.",
      scorePrecisionDecimals: 6,
    },
    runtimeAudit: {
      acceptedReport: {
        generatedMutants: facts.mutants.length,
        dryRunTests: 1,
        elapsedSeconds: 1,
        statusCounts: counts,
        workerCrashObserved: false,
        harness: {
          strykerConcurrency: 1,
          disableBail: true,
          testRunnerProcesses: 1,
          checkerProcesses: 1,
          vitestFileParallelism: false,
          vitestMaxWorkers: 1,
        },
      },
      rejectedHarnessRun: {
        statusCounts: { RuntimeError: 1 },
        reasonTaxonomy: [{ category: "fixture_runner_error", count: 1 }],
        rawReportPreserved: true,
        preservedAs: rejectedRelative,
        rawSha256: sha256("{}\n"),
        disposition:
          "Rejected fixture runner errors are never treated as invalid or detected mutants.",
      },
      stabilizationProbe: {
        scope: "fixture",
        generatedMutants: 1,
        RuntimeError: 0,
        CompileError: 0,
        elapsedSeconds: 1,
      },
    },
    scopes: [
      scope("QA-MUT-001", ["backend/src/evals/safety/**"], 1, 0, 95),
      scope(
        "QA-MUT-002",
        ["backend/src/agents/context/**", "backend/src/domain/temporal.ts"],
        2,
        0,
        95,
      ),
      scope(
        "QA-MUT-003",
        [
          "backend/src/domain/programme.ts",
          "backend/src/application/programmes.ts",
          "backend/src/infrastructure/database/publish-programme.ts",
        ],
        3,
        0,
        95,
      ),
      scope(
        "QA-MUT-004",
        ["backend/src/domain/accountability.ts", "backend/src/application/accountability.ts"],
        2,
        0,
        95,
      ),
      scope("QA-MUT-005", ["Every production file selected by stryker.config.mjs"], 9, 1, 90),
    ],
    classifications: [
      {
        ...survivor,
        scopeIds: ["QA-MUT-005"],
        riskCategory: "fixture_equivalence",
        classification: "equivalent",
        proof:
          "The fixture deliberately models a locally equivalent survivor with enough bounded semantic explanation for strict validation.",
        reviewer,
        reviewedOn,
        expiresOn: "2099-08-02",
        disposition: "approved-equivalent-until-expiry",
        countedAsDetected: false,
      },
    ],
    timeouts: [],
    inventorySummary: {
      survived: 1,
      noCoverage: 0,
      timeout: 0,
      runtimeError: 0,
      compileError: 0,
      classifiedSurvived: 1,
      classifiedNoCoverage: 0,
      classifiedTimeout: 0,
      unclassified: 0,
    },
  };
  const sourceClassificationPath = path.join(
    repositoryRoot,
    "backend/tooling/verification/mutation-survivor-classification.json",
  );
  const evidenceClassificationPath = path.join(reportDirectory, "survivor-classification.json");
  await mkdir(path.dirname(sourceClassificationPath), { recursive: true });
  await writeJson(sourceClassificationPath, classification);
  await writeJson(evidenceClassificationPath, classification);
  return {
    classification,
    evidenceClassificationPath,
    evidenceDirectory,
    mutationReport,
    reportPath,
    repositoryRoot,
    sourceClassificationPath,
  };
}

async function disposeFixture(fixture) {
  await rm(fixture.repositoryRoot, { force: true, recursive: true });
}

test("derives deterministic source, survivor, and timeout inventories", () => {
  const survivor = mutationReportFacts(report());
  const repeated = mutationReportFacts(report());
  assert.deepEqual(survivor, repeated);
  assert.equal(survivor.counts.Survived, 1);
  assert.equal(survivor.counts.RuntimeError, 0);
  assert.equal(survivor.survivorInventory.length, 1);
  assert.equal(survivor.timeoutInventory.length, 0);

  const timeout = mutationReportFacts(report("Timeout"));
  assert.equal(timeout.counts.Timeout, 1);
  assert.equal(timeout.timeoutInventory[0].statusReason, "Hit limit reached (100/50)");
  assert.notEqual(timeout.survivorInventorySha256, survivor.survivorInventorySha256);
});

test("binds source bytes and rejects unknown runner statuses", () => {
  const original = mutationReportFacts(report());
  const changed = mutationReportFacts(report("Survived", "export const value = 2;\n"));
  assert.notEqual(original.mutatedSourceSetSha256, changed.mutatedSourceSetSha256);
  assert.throws(() => mutationReportFacts(report("SuspiciouslyGreen")), /Unknown mutation status/u);
});

test("validates exact bytes and accepts only canonical repository-root redaction", async () => {
  const fixture = await createFixture();
  try {
    const exact = await validateMutationEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      releaseTimestamp: "2026-08-02T12:00:00.000Z",
      repositoryRoot: fixture.repositoryRoot,
    });
    assert.equal(exact.bindingMode, "exact-raw-report");

    fixture.mutationReport.projectRoot = "<REPOSITORY_ROOT>";
    await writeJson(fixture.reportPath, fixture.mutationReport);
    const fallback = await validateMutationEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      releaseTimestamp: "2026-08-02T12:00:00.000Z",
      repositoryRoot: fixture.repositoryRoot,
    });
    assert.equal(fallback.bindingMode, "canonical-report-with-repository-root-redaction");
  } finally {
    await disposeFixture(fixture);
  }
});

test("rejects current-source drift, classification inventory tampering, and expiry", async () => {
  const sourceFixture = await createFixture();
  try {
    await writeFile(
      path.join(sourceFixture.repositoryRoot, "backend/src/domain/example.ts"),
      "export const example = 2;\n",
      "utf8",
    );
    await assert.rejects(
      validateMutationEvidence({
        evidenceDirectory: sourceFixture.evidenceDirectory,
        releaseTimestamp: "2026-08-02T12:00:00.000Z",
        repositoryRoot: sourceFixture.repositoryRoot,
      }),
      /source bytes are stale/u,
    );
  } finally {
    await disposeFixture(sourceFixture);
  }

  const inventoryFixture = await createFixture();
  try {
    inventoryFixture.classification.classifications[0].replacement = "true";
    await writeJson(inventoryFixture.sourceClassificationPath, inventoryFixture.classification);
    await writeJson(inventoryFixture.evidenceClassificationPath, inventoryFixture.classification);
    await assert.rejects(
      validateMutationEvidence({
        evidenceDirectory: inventoryFixture.evidenceDirectory,
        releaseTimestamp: "2026-08-02T12:00:00.000Z",
        repositoryRoot: inventoryFixture.repositoryRoot,
      }),
      /does not exactly match/u,
    );
  } finally {
    await disposeFixture(inventoryFixture);
  }

  const expiryFixture = await createFixture();
  try {
    expiryFixture.classification.classifications[0].expiresOn = "2026-08-01";
    await writeJson(expiryFixture.sourceClassificationPath, expiryFixture.classification);
    await writeJson(expiryFixture.evidenceClassificationPath, expiryFixture.classification);
    await assert.rejects(
      validateMutationEvidence({
        evidenceDirectory: expiryFixture.evidenceDirectory,
        releaseTimestamp: "2026-08-02T12:00:00.000Z",
        repositoryRoot: expiryFixture.repositoryRoot,
      }),
      /approval is expired/u,
    );
  } finally {
    await disposeFixture(expiryFixture);
  }

  const scopeFixture = await createFixture();
  try {
    scopeFixture.classification.scopes.at(-1).counts.killed = 8;
    await writeJson(scopeFixture.sourceClassificationPath, scopeFixture.classification);
    await writeJson(scopeFixture.evidenceClassificationPath, scopeFixture.classification);
    await assert.rejects(
      validateMutationEvidence({
        evidenceDirectory: scopeFixture.evidenceDirectory,
        releaseTimestamp: "2026-08-02T12:00:00.000Z",
        repositoryRoot: scopeFixture.repositoryRoot,
      }),
      /counts are stale/u,
    );
  } finally {
    await disposeFixture(scopeFixture);
  }
});

test("rejects killed-mutant tampering, selected-file omissions, traversal, and future review", async () => {
  const mutantFixture = await createFixture();
  try {
    const killed = Object.values(mutantFixture.mutationReport.files)
      .flatMap((file) => file.mutants)
      .find((mutant) => mutant.status === "Killed");
    assert.notEqual(killed, undefined);
    killed.replacement = "tampered killed replacement";
    await writeJson(mutantFixture.reportPath, mutantFixture.mutationReport);
    await assert.rejects(
      validateMutationEvidence({
        evidenceDirectory: mutantFixture.evidenceDirectory,
        releaseTimestamp: "2026-08-02T12:00:00.000Z",
        repositoryRoot: mutantFixture.repositoryRoot,
      }),
      /Canonical mutation report binding is stale/u,
    );
  } finally {
    await disposeFixture(mutantFixture);
  }

  const fileSetFixture = await createFixture();
  try {
    const omitted = path.join(
      fileSetFixture.repositoryRoot,
      "backend/src/domain/new-production.ts",
    );
    await writeFile(omitted, "export const omitted = true;\n", "utf8");
    await assert.rejects(
      validateMutationEvidence({
        evidenceDirectory: fileSetFixture.evidenceDirectory,
        releaseTimestamp: "2026-08-02T12:00:00.000Z",
        repositoryRoot: fileSetFixture.repositoryRoot,
      }),
      /file set does not exactly match/u,
    );
  } finally {
    await disposeFixture(fileSetFixture);
  }

  const testFileSetFixture = await createFixture();
  try {
    const omittedTest = path.join(
      testFileSetFixture.repositoryRoot,
      "backend/src/domain/new-production.test.ts",
    );
    await writeFile(omittedTest, 'test("new candidate", () => {});\n', "utf8");
    await assert.rejects(
      validateMutationEvidence({
        evidenceDirectory: testFileSetFixture.evidenceDirectory,
        releaseTimestamp: "2026-08-02T12:00:00.000Z",
        repositoryRoot: testFileSetFixture.repositoryRoot,
      }),
      /test file set does not exactly match/u,
    );
  } finally {
    await disposeFixture(testFileSetFixture);
  }

  const testSourceFixture = await createFixture();
  try {
    await writeFile(
      path.join(testSourceFixture.repositoryRoot, "backend/src/domain/example.test.ts"),
      'test("changed after mutation", () => {});\n',
      "utf8",
    );
    await assert.rejects(
      validateMutationEvidence({
        evidenceDirectory: testSourceFixture.evidenceDirectory,
        releaseTimestamp: "2026-08-02T12:00:00.000Z",
        repositoryRoot: testSourceFixture.repositoryRoot,
      }),
      /test bytes are stale/u,
    );
  } finally {
    await disposeFixture(testSourceFixture);
  }

  const executionFixture = await createFixture();
  try {
    const turboLog = path.join(executionFixture.repositoryRoot, "backend/.turbo/mutation.log");
    await mkdir(path.dirname(turboLog), { recursive: true });
    await writeFile(turboLog, "generated and intentionally unbound\n", "utf8");
    const buildInfo = path.join(
      executionFixture.repositoryRoot,
      "backend/packages/contracts/tsconfig.tsbuildinfo",
    );
    await mkdir(path.dirname(buildInfo), { recursive: true });
    await writeFile(buildInfo, "generated TypeScript build state\n", "utf8");
    const generatedOutputIgnored = await validateMutationEvidence({
      evidenceDirectory: executionFixture.evidenceDirectory,
      releaseTimestamp: "2026-08-02T12:00:00.000Z",
      repositoryRoot: executionFixture.repositoryRoot,
    });
    assert.equal(generatedOutputIgnored.bindingMode, "exact-raw-report");

    const transitiveInput = path.join(
      executionFixture.repositoryRoot,
      "backend/src/agents/gateway/transitive-support.ts",
    );
    await mkdir(path.dirname(transitiveInput), { recursive: true });
    await writeFile(transitiveInput, "export const transitive = true;\n", "utf8");
    await assert.rejects(
      validateMutationEvidence({
        evidenceDirectory: executionFixture.evidenceDirectory,
        releaseTimestamp: "2026-08-02T12:00:00.000Z",
        repositoryRoot: executionFixture.repositoryRoot,
      }),
      /execution-input binding is stale/u,
    );
  } finally {
    await disposeFixture(executionFixture);
  }

  const traversalReport = report();
  traversalReport.files["backend/src/domain/../escape.ts"] =
    traversalReport.files["backend/src/domain/example.ts"];
  delete traversalReport.files["backend/src/domain/example.ts"];
  assert.throws(() => mutationReportFacts(traversalReport), /Unsafe mutated source path/u);

  const reviewFixture = await createFixture();
  try {
    reviewFixture.classification.reviewedOn = "2026-08-03";
    await writeJson(reviewFixture.sourceClassificationPath, reviewFixture.classification);
    await writeJson(reviewFixture.evidenceClassificationPath, reviewFixture.classification);
    await assert.rejects(
      validateMutationEvidence({
        evidenceDirectory: reviewFixture.evidenceDirectory,
        releaseTimestamp: "2026-08-02T12:00:00.000Z",
        repositoryRoot: reviewFixture.repositoryRoot,
      }),
      /review date is after the release timestamp/u,
    );
  } finally {
    await disposeFixture(reviewFixture);
  }
});
