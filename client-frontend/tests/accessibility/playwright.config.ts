import { defineConfig, devices } from "@playwright/test";

delete process.env.NO_COLOR;

const publicPort = 8181;
const apiPort = 3201;
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;

export default defineConfig({
  expect: { timeout: 12_000 },
  forbidOnly: process.env.CI !== undefined,
  fullyParallel: false,
  globalTeardown: "../e2e/global-teardown.ts",
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  retries: 0,
  testDir: ".",
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${String(publicPort)}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node ../e2e/start-production-server.mjs",
    env: {
      ...(browsersPath === undefined ? {} : { PLAYWRIGHT_BROWSERS_PATH: browsersPath }),
      SPOTTER_CLIENT_API_PORT: String(apiPort),
      SPOTTER_CLIENT_E2E_PORT: String(publicPort),
    },
    reuseExistingServer: false,
    timeout: 300_000,
    url: `http://127.0.0.1:${String(publicPort)}/`,
  },
  workers: 1,
});
