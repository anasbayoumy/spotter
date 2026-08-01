import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  retries: process.env.CI === undefined ? 0 : 1,
  testDir: ".",
  use: {
    baseURL: "http://127.0.0.1:8081",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000 CI=1 pnpm exec expo start --web --port 8081",
    port: 8081,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop-web", use: { ...devices["Desktop Chrome"] } },
    { name: "compact-web", use: { ...devices["Pixel 7"] } },
  ],
});
