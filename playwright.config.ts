import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://127.0.0.1:3000";
const usesExternalServer = Boolean(process.env["PLAYWRIGHT_EXTERNAL_SERVER"]);

export default defineConfig({
  forbidOnly: true,
  fullyParallel: true,
  outputDir: "test-results",
  reporter: [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  retries: 0,
  testDir: "tests",
  timeout: 30_000,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  ...(usesExternalServer
    ? {}
    : {
        webServer: {
          command: "corepack pnpm --filter @spotter/frontend start",
          reuseExistingServer: process.env["CI"] !== "true",
          timeout: 120_000,
          url: `${baseURL}/health/live`,
        },
      }),
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"] } },
  ],
});
