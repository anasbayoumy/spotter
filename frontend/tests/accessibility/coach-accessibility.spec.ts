import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { assertNoHorizontalOverflow, installRuntimeGuard } from "../e2e/support/runtime-guards";

const ids = {
  blockedProgramme: "00000000-0000-4000-8000-000000000602",
  client: "00000000-0000-4000-8000-000000000101",
  programme: "00000000-0000-4000-8000-000000000601",
  queuedProgramme: "00000000-0000-4000-8000-000000000606",
  trace: "00000000-0000-4000-8000-000000000201",
} as const;

async function assertNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(
    blocking.map((violation) => ({
      help: violation.help,
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Keyboard focus did not reach the requested control.");
}

test("QA-A11Y-001/005 axe passes primary coach surfaces with meaningful structure", async ({
  page,
}, testInfo) => {
  const runtime = installRuntimeGuard(page, testInfo);
  const surfaces = [
    { path: "/queue", ready: "Review queue" },
    { path: `/clients/${ids.client}`, ready: "c_001" },
    { path: `/programmes/${ids.programme}`, ready: "Programme content" },
    { path: `/traces/${ids.trace}`, ready: "Context trace" },
    { path: "/scorecard", ready: "Evaluation scorecard" },
  ] as const;
  for (const surface of surfaces) {
    await page.goto(surface.path);
    await expect(page.getByRole("heading", { name: surface.ready }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await assertNoSeriousAxeViolations(page);
  }
  await page.goto(`/programmes/${ids.programme}`);
  await expect(page.getByRole("columnheader", { name: "Exercise" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Load" })).toBeVisible();
  await expect(page.getByText("Clear", { exact: true }).first()).toBeVisible();
  await runtime.assertClean();
});

test("QA-A11Y-001 axe passes empty and service-error states", async ({ page }, testInfo) => {
  const runtime = installRuntimeGuard(page, testInfo, {
    allowResponse: (response) => response.status() === 503,
  });
  const empty = {
    data: [],
    error: null,
    meta: { hasMore: false, requestId: "a11y-empty", total: 0 },
  };
  await page.route("**/api/v1/programmes?*", (route) =>
    route.fulfill({ contentType: "application/json", json: empty }),
  );
  await page.route("**/api/v1/adjustments?*", (route) =>
    route.fulfill({ contentType: "application/json", json: empty }),
  );
  await page.goto("/queue");
  await expect(page.getByText("Nothing needs review")).toBeVisible();
  await assertNoSeriousAxeViolations(page);
  await page.unrouteAll();

  await page.route("**/api/v1/scorecard", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: null,
        error: { code: "dependency_unavailable", message: "Evaluation service unavailable." },
        meta: { requestId: "a11y-error" },
      },
      status: 503,
    }),
  );
  await page.goto("/scorecard");
  await expect(
    page.getByRole("alert").filter({ hasText: "Evaluation service unavailable" }),
  ).toBeVisible();
  await assertNoSeriousAxeViolations(page);
  await runtime.assertClean();
});

test("QA-A11Y-002 skip navigation and critical review actions work by keyboard", async ({
  page,
}, testInfo) => {
  const runtime = installRuntimeGuard(page, testInfo);
  await page.goto("/queue");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await page.waitForLoadState("networkidle");

  await page.goto(`/programmes/${ids.blockedProgramme}`);
  const override = page.getByRole("button", { name: "Override block" });
  await tabTo(page, override);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Override the safety block?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByLabel("Override reason")).toBeFocused();
  await page.keyboard.type("Keyboard-only review reason.");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(override).toBeFocused();
  await runtime.assertClean();
});

test("QA-A11Y-003/004/007 labels, announced errors, focus trap, and return are correct", async ({
  page,
}, testInfo) => {
  const runtime = installRuntimeGuard(page, testInfo);
  await page.goto(`/programmes/${ids.queuedProgramme}`);
  await page.getByRole("button", { name: "Edit proposal" }).click();
  const summary = page.getByLabel("Programme summary");
  await summary.fill("");
  await expect(summary).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert").filter({ hasText: "validation issue" })).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  const reject = page.getByRole("button", { name: "Reject" });
  await reject.click();
  const dialog = page.getByRole("dialog", { name: "Reject this proposal?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    expect(
      await page.locator(":focus").evaluate((node) => node.closest('[role="dialog"]') !== null),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(reject).toBeFocused();
  await runtime.assertClean();
});

test("QA-A11Y-006 contrast and 200 percent text reflow remain usable", async ({
  page,
}, testInfo) => {
  const runtime = installRuntimeGuard(page, testInfo);
  await page.setViewportSize({ height: 800, width: 640 });
  await page.goto(`/programmes/${ids.programme}`);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(page.getByRole("heading", { name: "Programme content" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertNoSeriousAxeViolations(page);
  await runtime.assertClean();
});
