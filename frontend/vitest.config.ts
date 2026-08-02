import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    bail: 1,
    clearMocks: true,
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    hookTimeout: 15_000,
    mockReset: true,
    passWithNoTests: false,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
