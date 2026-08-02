import { defineConfig, devices } from "@playwright/test";

delete process.env["NO_COLOR"];

const port = 3100;
const browsersPath = process.env["PLAYWRIGHT_BROWSERS_PATH"];

export default defineConfig({
  expect: { timeout: 12_000 },
  forbidOnly: process.env["CI"] !== undefined,
  fullyParallel: false,
  globalTeardown: "../e2e/global-teardown.ts",
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  retries: 0,
  testDir: ".",
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${String(port)}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node ../e2e/start-production-server.mjs",
    env: {
      ...(browsersPath === undefined ? {} : { PLAYWRIGHT_BROWSERS_PATH: browsersPath }),
      SPOTTER_E2E_WEB_PORT: String(port),
    },
    reuseExistingServer: false,
    timeout: 300_000,
    url: `http://127.0.0.1:${String(port)}/health/ready`,
  },
  workers: 1,
});
