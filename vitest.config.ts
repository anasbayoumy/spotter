import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    bail: 1,
    clearMocks: true,
    coverage: {
      exclude: [
        "**/*.d.ts",
        "**/*.config.*",
        "**/generated/**",
        "**/index.ts",
        "**/test/**",
        "**/tests/**",
        "**/testkit/**",
      ],
      include: [
        "backend/src/**/*.{ts,tsx}",
        "frontend/src/**/*.{ts,tsx}",
        "client-frontend/src/**/*.{ts,tsx}",
      ],
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "tests/e2e-*/**"],
    hookTimeout: 15_000,
    include: ["**/*.{test,spec}.{ts,tsx}"],
    mockReset: true,
    passWithNoTests: false,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
