import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    bail: 1,
    clearMocks: true,
    coverage: {
      exclude: ["**/*.d.ts", "**/*.test.ts", "**/index.ts", "**/tsconfig.json"],
      include: [
        "src/domain/**/*.ts",
        "src/agents/**/*.ts",
        "src/application/**/*.ts",
        "src/evals/**/*.ts",
        "src/jobs/**/*.ts",
        "src/infrastructure/database/publish-programme.ts",
      ],
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "coverage/unit",
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
        "src/agents/context/**/*.ts": { 100: true },
        "src/application/accountability.ts": { 100: true },
        "src/domain/accountability.ts": { 100: true },
        "src/evals/safety/gates/gates.ts": { 100: true },
        "src/evals/safety/movement-taxonomy.ts": { 100: true },
        "src/infrastructure/database/publish-programme.ts": { 100: true },
      },
    },
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
    hookTimeout: 15_000,
    mockReset: true,
    passWithNoTests: false,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
