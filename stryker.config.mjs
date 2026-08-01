/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
const config = {
  checkers: ["typescript"],
  coverageAnalysis: "perTest",
  mutate: [
    "backend/src/domain/**/*.ts",
    "backend/src/evals/safety/**/*.ts",
    "backend/src/agents/context/**/*.ts",
    "!**/*.test.ts",
    "!**/index.ts",
  ],
  reporters: ["clear-text", "html", "json"],
  testRunner: "vitest",
  thresholds: { break: 90, high: 95, low: 90 },
  timeoutMS: 15_000,
};

export default config;
