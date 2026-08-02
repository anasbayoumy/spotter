import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    bail: 1,
    clearMocks: true,
    coverage: {
      exclude: ["**/*.d.ts", "**/*.test.ts", "**/__tests__/**", "**/generated/**"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["json", "text-summary"],
      reportsDirectory: "coverage/all",
      thresholds: {
        branches: 0,
        functions: 0,
        lines: 0,
        statements: 0,
      },
    },
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**", "**/.stryker-tmp/**", "**/*.runtime.test.mjs"],
    hookTimeout: 15_000,
    mockReset: true,
    passWithNoTests: false,
    restoreMocks: true,
    // V8 instrumentation materially slows the bounded property suites on shared CI runners.
    testTimeout: 30_000,
  },
});
