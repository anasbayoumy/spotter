import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateGoldenFixture,
  goldenManifestSchema,
  type GoldenEvaluationResult,
  type GoldenFixture,
} from "../evals/golden-fixture.js";
import {
  knownMovementFamilies,
  MOVEMENT_TAXONOMY_VERSION,
  movementAliases,
} from "../evals/safety/movement-taxonomy.js";

const applicationRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifestPath = path.join(applicationRoot, "backend/resources/golden/safety/manifest.json");
const rawManifest = await readFile(manifestPath, "utf8");
const manifest = goldenManifestSchema.parse(JSON.parse(rawManifest) as unknown);
const generatedAt = new Date();
const generatedStamp = generatedAt.toISOString().replace(/\D/gu, "").slice(0, 15);
const runId = process.env["SPOTTER_VERIFICATION_RUN_ID"] ?? `${generatedStamp}-safety`;
const reportDirectory = path.join(
  applicationRoot,
  "artifacts",
  "verification",
  runId,
  "reports",
  "safety",
);

interface Comparison {
  readonly field: string;
  readonly actual: unknown;
  readonly expected: unknown;
}

interface FixtureReport {
  readonly actual: GoldenEvaluationResult | null;
  readonly durationMs: number;
  readonly error: string | null;
  readonly expected: GoldenFixture["expected"];
  readonly falseNegative: boolean;
  readonly falsePositive: boolean;
  readonly fixtureId: string;
  readonly matched: boolean;
  readonly mismatches: readonly Comparison[];
  readonly selectedRecordIds: readonly string[];
}

function compare(fixture: GoldenFixture, actual: GoldenEvaluationResult): readonly Comparison[] {
  const comparisons: Comparison[] = [];
  const expected = fixture.expected;
  const add = (field: string, expectedValue: unknown, actualValue: unknown): void => {
    if (
      expectedValue !== undefined &&
      JSON.stringify(expectedValue) !== JSON.stringify(actualValue)
    ) {
      comparisons.push({ field, actual: actualValue, expected: expectedValue });
    }
  };
  add("outcome", expected.outcome, actual.outcome);
  add("band", expected.band, actual.band);
  add("gate", expected.gate, actual.blockedGate);
  add("tier", expected.tier, actual.tier);
  add("maxMessages", expected.maxMessages, actual.maxMessages);
  add("selectedRecordIds", expected.selectedRecordIds, actual.selectedRecordIds);
  add("budgetOutcome", expected.budgetOutcome, actual.budget?.outcome);
  add(
    "selectedOptionalSections",
    expected.selectedOptionalSections,
    actual.budget?.selectedOptionalSections,
  );
  return comparisons;
}

function isUnsafeOutcome(value: GoldenEvaluationResult["outcome"]): boolean {
  return value === "blocked" || value === "escalated" || value === "failed";
}

const results: FixtureReport[] = [];
for (const fixture of manifest.cases) {
  const startedAt = performance.now();
  try {
    const actual = await evaluateGoldenFixture(fixture);
    const mismatches = compare(fixture, actual);
    const expectedUnsafe = isUnsafeOutcome(fixture.expected.outcome);
    const actualUnsafe = isUnsafeOutcome(actual.outcome);
    results.push({
      actual,
      durationMs: performance.now() - startedAt,
      error: null,
      expected: fixture.expected,
      falseNegative: expectedUnsafe && !actualUnsafe,
      falsePositive: !expectedUnsafe && actualUnsafe,
      fixtureId: fixture.id,
      matched: mismatches.length === 0,
      mismatches,
      selectedRecordIds: actual.selectedRecordIds,
    });
  } catch (error: unknown) {
    results.push({
      actual: null,
      durationMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown safety evaluation error",
      expected: fixture.expected,
      falseNegative: isUnsafeOutcome(fixture.expected.outcome),
      falsePositive: false,
      fixtureId: fixture.id,
      matched: false,
      mismatches: [],
      selectedRecordIds: [],
    });
  }
}

const taxonomySnapshot = [...knownMovementFamilies].map((family) => ({
  aliases: movementAliases(family),
  family,
}));
const fixtureContentHash = createHash("sha256").update(rawManifest).digest("hex");
const productionTaxonomyHash = createHash("sha256")
  .update(JSON.stringify({ version: MOVEMENT_TAXONOMY_VERSION, taxonomySnapshot }))
  .digest("hex");
const falseNegatives = results.filter(({ falseNegative }) => falseNegative);
const falsePositives = results.filter(({ falsePositive }) => falsePositive);
const report = {
  schemaVersion: 1,
  runId,
  generatedAt: generatedAt.toISOString(),
  fixtureSchemaVersion: manifest.schemaVersion,
  fixtureContentHash: `sha256:${fixtureContentHash}`,
  productionTaxonomyHash: `sha256:${productionTaxonomyHash}`,
  productionTaxonomyVersion: MOVEMENT_TAXONOMY_VERSION,
  summary: {
    discovered: manifest.cases.length,
    valid: manifest.cases.length,
    executed: results.length,
    matched: results.filter(({ matched }) => matched).length,
    falseNegatives: falseNegatives.length,
    falsePositives: falsePositives.length,
  },
  results,
};

const renderGroup = (title: string, entries: readonly FixtureReport[]): string =>
  [
    `## ${title}`,
    entries.length === 0 ? "None." : entries.map((entry) => `- ${entry.fixtureId}`).join("\n"),
  ].join("\n\n");
const mismatched = results.filter(({ matched }) => !matched);
const markdown = [
  "# Safety golden-set report",
  `Run: ${runId}`,
  `Fixtures: ${String(report.summary.matched)}/${String(report.summary.executed)} matched`,
  renderGroup("False negatives", falseNegatives),
  renderGroup("False positives", falsePositives),
  renderGroup("Other mismatches or errors", mismatched),
].join("\n\n");

await mkdir(reportDirectory, { recursive: true });
await Promise.all([
  writeFile(
    path.join(reportDirectory, "results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  ),
  writeFile(path.join(reportDirectory, "results.md"), `${markdown}\n`, "utf8"),
]);

console.log(`Safety evidence: ${reportDirectory}`);
if (mismatched.length > 0 || falseNegatives.length > 0) process.exitCode = 1;
