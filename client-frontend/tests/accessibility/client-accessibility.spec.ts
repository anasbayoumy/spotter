import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { installRuntimeGuard } from "../e2e/support/runtime-guards";

const sessionId = "00000000-0000-4000-8000-000000000701";

async function assertNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations
      .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
      .map((violation) => ({
        help: violation.help,
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      })),
  ).toEqual([]);
}

async function selectHealthyClient(page: Page): Promise<void> {
  await page.goto("/select-client");
  await page.getByRole("button", { name: "Select c_001" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error("Keyboard focus did not reach the client control.");
}

test("QA-A11Y-001/003 axe passes selector, Today, History, Check-in, and session form", async ({
  page,
}, testInfo) => {
  const runtime = installRuntimeGuard(page, testInfo);
  await page.goto("/select-client");
  await expect(page).toHaveTitle("Spotter Client");
  await expect(page.getByRole("heading", { name: "Select demo client" })).toBeVisible();
  await assertNoSeriousAxeViolations(page);
  await page.getByRole("button", { name: "Select c_001" }).click();
  for (const surface of [
    { path: "/today", ready: "Today" },
    { path: "/history", ready: "History" },
    { path: "/check-in", ready: "Check-in" },
    { path: `/session/${sessionId}`, ready: "Log session" },
  ] as const) {
    await page.goto(surface.path);
    await expect(page.getByRole("heading", { name: surface.ready })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await assertNoSeriousAxeViolations(page);
  }
  await expect(page.getByLabel("Overall session RPE")).toBeVisible();
  await expect(page.getByLabel("Session notes (optional)")).toBeVisible();
  await runtime.assertClean();
});

test("QA-A11Y-001/007 axe and live semantics pass client service-error state", async ({
  page,
}, testInfo) => {
  const runtime = installRuntimeGuard(page, testInfo, {
    allowResponse: (response) => response.status() === 503,
  });
  await selectHealthyClient(page);
  await page.route("**/api/v1/clients/*/today", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: null,
        error: { code: "dependency_unavailable", message: "Today is temporarily unavailable." },
        meta: { requestId: "client-a11y-503" },
      },
      status: 503,
    }),
  );
  await page.goto("/today");
  await expect(page.getByText("Today is temporarily unavailable.")).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await assertNoSeriousAxeViolations(page);
  await runtime.assertClean();
});

test("QA-A11Y-002/006 client controls have visible keyboard focus and reflow", async ({
  page,
}, testInfo) => {
  const runtime = installRuntimeGuard(page, testInfo);
  await selectHealthyClient(page);
  const change = page.getByRole("button", { name: "Change client" });
  await tabTo(page, change);
  await expect(change).toBeFocused();
  const borderWidth = await change.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).borderWidth),
  );
  expect(borderWidth).toBeGreaterThanOrEqual(2);

  await page.setViewportSize({ height: 812, width: 375 });
  await page.goto("/check-in");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(page.getByRole("heading", { name: "Check-in" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Readiness 1 of 5" })).toBeVisible();
  await assertNoSeriousAxeViolations(page);
  await runtime.assertClean();
});
