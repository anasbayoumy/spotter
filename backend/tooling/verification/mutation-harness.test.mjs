import assert from "node:assert/strict";
import test from "node:test";

import mutationConfig from "../../../stryker.config.mjs";

const expectedMutateSelectors = [
  "backend/src/domain/**/*.ts",
  "backend/src/evals/safety/**/*.ts",
  "backend/src/agents/context/**/*.ts",
  "backend/src/application/programmes.ts",
  "backend/src/application/accountability.ts",
  "backend/src/infrastructure/database/publish-programme.ts",
  "!**/*.test.ts",
  "!**/index.ts",
];

test("mutation harness retains the reviewed scope and semantic gates", () => {
  assert.deepEqual(mutationConfig.mutate, expectedMutateSelectors);
  assert.deepEqual(mutationConfig.thresholds, { break: 90, high: 95, low: 90 });
  assert.equal(mutationConfig.disableBail, true);
  assert.equal(mutationConfig.ignoreStatic, undefined);
  assert.equal(mutationConfig.timeoutMS, 15_000);
  assert.deepEqual(mutationConfig.vitest, {
    configFile: "backend/vitest.mutation.config.ts",
    related: false,
  });
});

test("mutation harness serializes resource-intensive test execution", () => {
  assert.equal(mutationConfig.concurrency, 1);
  assert.equal(mutationConfig.maxConcurrentTestRunners, undefined);
});

test("mutation harness preserves durable progress and report observability", () => {
  assert.deepEqual(mutationConfig.reporters, [
    "event-recorder",
    "progress-append-only",
    "clear-text",
    "html",
    "json",
  ]);
});
