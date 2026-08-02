import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^react-native$/u,
        replacement: new URL("./react-native-test-double.tsx", import.meta.url).pathname,
      },
    ],
  },
  test: {
    bail: 1,
    clearMocks: true,
    coverage: {
      exclude: ["**/*.d.ts", "**/*.test.{ts,tsx}", "**/__tests__/**", "**/generated/**"],
      include: ["src/**/*.{ts,tsx}"],
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "coverage/mobile",
    },
    environment: "node",
    include: ["tests/mobile/**/*.test.{ts,tsx}"],
    mockReset: true,
    restoreMocks: true,
  },
});
