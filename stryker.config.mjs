/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
const config = {
  checkers: ["typescript"],
  concurrency: 2,
  coverageAnalysis: "perTest",
  disableBail: true,
  ignorePatterns: ["/.cache", "/artifacts", "/client-frontend", "/coverage", "/frontend"],
  plugins: ["@stryker-mutator/typescript-checker", "@stryker-mutator/vitest-runner"],
  mutate: [
    "backend/src/domain/**/*.ts",
    "backend/src/evals/safety/**/*.ts",
    "backend/src/agents/context/**/*.ts",
    "backend/src/application/programmes.ts",
    "backend/src/application/accountability.ts",
    "backend/src/infrastructure/database/publish-programme.ts",
    "!**/*.test.ts",
    "!**/index.ts",
  ],
  reporters: ["clear-text", "html", "json"],
  testRunner: "vitest",
  thresholds: { break: 90, high: 95, low: 90 },
  timeoutMS: 15_000,
  vitest: {
    configFile: "backend/vitest.mutation.config.ts",
    related: false,
  },
};

export default config;
