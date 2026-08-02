import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    bail: 1,
    clearMocks: true,
    coverage: {
      exclude: ["**/*.d.ts", "**/*.test.{ts,tsx}", "**/generated/**"],
      include: ["src/**/*.{ts,tsx}"],
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
    exclude: ["**/node_modules/**", "**/dist/**", "**/.expo/**"],
    hookTimeout: 15_000,
    mockReset: true,
    passWithNoTests: false,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
