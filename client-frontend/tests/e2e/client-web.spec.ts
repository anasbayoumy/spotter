import { expect, test, type Page } from "@playwright/test";

async function selectFirstSyntheticClient(page: Page): Promise<void> {
  await page.goto("/select-client");
  const firstClient = page.getByRole("button", { name: /^Select c_/u }).first();
  await expect(firstClient).toBeVisible();
  await firstClient.click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

test("synthetic selector opens the published Today experience", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/selector is not sign-in/iu)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Select demo client" })).toBeVisible();
  await selectFirstSyntheticClient(page);
  await expect(page.getByText(/current coach-published plan/iu)).toBeVisible();
});

test("check-in remains validated and labels its human-review contract", async ({ page }) => {
  await selectFirstSyntheticClient(page);
  await page.goto("/check-in");
  await expect(page.getByRole("heading", { name: "Check-in" })).toBeVisible();
  await expect(page.getByText(/does not automatically change your plan/iu)).toBeVisible();
  await page.getByRole("button", { name: "Send check-in" }).click();
  await expect(page.getByRole("alert")).toContainText(/check your response/iu);
  await expect(page.getByText(/routed for human review/iu)).toBeVisible();
});
