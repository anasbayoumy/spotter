import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

import { assertNoHorizontalOverflow, installRuntimeGuard } from "./support/runtime-guards";

const ids = {
  adjustment: "00000000-0000-4000-8000-000000001001",
  blockedAdjustment: "00000000-0000-4000-8000-000000001002",
  blockedClient: "00000000-0000-4000-8000-000000000102",
  blockedProgramme: "00000000-0000-4000-8000-000000000602",
  disengagedClient: "00000000-0000-4000-8000-000000000106",
  healthyClient: "00000000-0000-4000-8000-000000000101",
  rejectClient: "00000000-0000-4000-8000-000000000105",
  rejectProgramme: "00000000-0000-4000-8000-000000000606",
  supersededClient: "00000000-0000-4000-8000-000000000104",
  supersededProgramme: "00000000-0000-4000-8000-000000000604",
  currentProgramme: "00000000-0000-4000-8000-000000000605",
} as const;

const documentationScreenshots = fileURLToPath(
  new URL("../../../DOCS/assets/screenshots", import.meta.url),
);
const captureDocumentation = process.env["SPOTTER_CAPTURE_DOCS"] === "true";

async function data<T>(response: APIResponse): Promise<T> {
  const body = (await response.json()) as {
    readonly data: T | null;
    readonly error: { readonly message: string } | null;
  };
  expect(response.ok(), body.error?.message).toBe(true);
  expect(body.error).toBeNull();
  expect(body.data).not.toBeNull();
  return body.data as T;
}

async function queuedHealthyProgramme(request: APIRequestContext): Promise<string> {
  const queued = await data<readonly { readonly clientId: string; readonly id: string }[]>(
    await request.get(`/api/v1/programmes?clientId=${ids.healthyClient}&status=queued&limit=100`),
  );
  const existing = queued.find((programme) => programme.clientId === ids.healthyClient);
  if (existing !== undefined) return existing.id;
  const generated = await data<{ readonly programme: { readonly id: string } }>(
    await request.post("/api/v1/programmes/generate", {
      data: { clientId: ids.healthyClient, targetWeekStart: "2026-08-03" },
      headers: { "Idempotency-Key": `e2e-programme-edit-${crypto.randomUUID()}` },
    }),
  );
  return generated.programme.id;
}

async function openReady(page: Page, path: string, heading: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
}

test.describe.serial("QA-E2E coach journeys", () => {
  test("QA-E2E-001 routes the coach to a deterministic risk-ordered queue", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await page.goto("/");
    await expect(page).toHaveURL(/\/queue$/u);
    await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
    const groupHeadings = page.locator(".queue-group__heading h2");
    await expect(groupHeadings).toHaveText(["Blocked", "Needs attention", "Clear"]);
    await expect(
      page.getByRole("link", { name: "Review Adjustment · v1 for c_007" }),
    ).toHaveAttribute("href", `/adjustments/${ids.adjustment}`);
    await expect(page.getByText(/forbidden movement/iu).first()).toBeVisible();
    const baselineLink = page.getByRole("link", { name: "Client c_001" });
    await expect(baselineLink).toHaveAttribute("href", `/clients/${ids.healthyClient}`);
    await baselineLink.click();
    await expect(page.getByRole("heading", { name: "c_001" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await runtime.assertClean();
  });

  test("QA-E2E-002 generates a proposal with recorded evidence and an inspectable trace", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await openReady(page, `/clients/${ids.healthyClient}`, "c_001");
    await page.getByRole("button", { name: "Generate proposal" }).click();
    const reviewLink = page.getByRole("link", { name: "Review it now" });
    await expect(reviewLink).toBeVisible();
    const href = await reviewLink.getAttribute("href");
    expect(href).toMatch(/^\/programmes\/[0-9a-f-]+$/u);
    const generatedProgrammeId = href?.split("/").at(-1) ?? "";
    expect(generatedProgrammeId).not.toBe("");
    await reviewLink.click();
    await expect(page.getByRole("heading", { name: "Deterministic safety gates" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Independent judges" })).toBeVisible();
    await page.getByRole("link", { name: /Inspect trace/u }).click();
    await expect(page.getByRole("heading", { name: "Context trace" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Exact rendered model input" })).toBeVisible();
    await runtime.assertClean();
  });

  test("QA-E2E-003 edits, reruns evidence, and publishes only after confirmation", async ({
    page,
    request,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    const generatedProgrammeId = await queuedHealthyProgramme(request);
    await page.goto(`/programmes/${generatedProgrammeId}`);
    await expect(page.getByRole("button", { name: "Edit proposal" })).toBeEnabled();
    await page.getByRole("button", { name: "Edit proposal" }).click();
    const summary = page.getByLabel("Programme summary");
    await summary.fill(`${await summary.inputValue()} Coach-reviewed.`);
    const sets = page.locator('input[id^="sets-"]');
    await expect(sets).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) await sets.nth(index).fill("1");
    await page.getByRole("button", { name: "Save and rerun gates" }).click();
    await expect(page.getByText("Changes saved and safety evidence refreshed.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Deterministic safety gates" })).toBeVisible();
    await expect(page.getByText(/Volume Spike/u)).toBeVisible();
    await expect(page.getByText(/volume_spike passed/u)).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("dialog", { name: "Publish this programme?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm publication" }).click();
    await expect(page.getByText("published", { exact: true })).toBeVisible();
    await expect(page.getByText("Programme published successfully.")).toBeVisible();
    await runtime.assertClean();
  });

  test("QA-E2E-004 rejection removes a proposal without making it client visible", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await page.goto(`/programmes/${ids.rejectProgramme}`);
    await expect(page.getByRole("button", { name: "Reject" })).toBeEnabled();
    await page.getByRole("button", { name: "Reject" }).click();
    const dialog = page.getByRole("dialog", { name: "Reject this proposal?" });
    await dialog.getByLabel("Rejection reason (optional)").fill("Not appropriate this week.");
    await dialog.getByRole("button", { name: "Confirm rejection" }).click();
    await expect(page.getByText("rejected", { exact: true })).toBeVisible();
    await openReady(page, `/clients/${ids.rejectClient}`, "c_005");
    await expect(page.getByText("No published programme is currently visible")).toBeVisible();
    await runtime.assertClean();
  });

  test("QA-E2E-005 blocks standard approval and requires a written override", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await page.goto(`/programmes/${ids.blockedProgramme}`);
    await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(page.getByText(/Standard approval is disabled/u)).toBeVisible();
    await page.getByRole("button", { name: "Override block" }).click();
    const dialog = page.getByRole("dialog", { name: "Override the safety block?" });
    await expect(dialog.getByRole("button", { name: "Publish with override" })).toBeDisabled();
    await dialog
      .getByLabel("Override reason")
      .fill("Coach reviewed the synthetic constraint and accepts the bounded fixture plan.");
    await dialog.getByRole("button", { name: "Publish with override" }).click();
    await expect(page.getByText("published", { exact: true })).toBeVisible();
    await runtime.assertClean();
  });

  test("QA-E2E-006 preserves superseded and current programme evidence", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await page.goto(`/programmes/${ids.supersededProgramme}`);
    await expect(page.getByText("superseded", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit proposal" })).toBeDisabled();
    await page.goto(`/programmes/${ids.currentProgramme}`);
    await expect(page.getByText("published", { exact: true })).toBeVisible();
    await openReady(page, `/clients/${ids.supersededClient}`, "c_004");
    await expect(page.getByText("v2", { exact: true })).toBeVisible();
    await runtime.assertClean();
  });

  test("QA-E2E-007 exposes effective client context and immutable evidence links", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await openReady(page, "/clients/00000000-0000-4000-8000-000000000107", "c_007");
    await expect(page.getByRole("heading", { name: "Coaching profile" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Active constraints" })).toBeVisible();
    await expect(page.getByText("Synthetic low-readiness check-in.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Inspect programme evidence/u })).toBeVisible();
    await runtime.assertClean();
  });

  test("QA-E2E-008 inspects, persists edits, approves and rejects adjustment proposals", async ({
    page,
    request,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo, {
      allowResponse: (response) =>
        response.status() === 422 && response.url().includes("/api/v1/adjustments/"),
    });
    await page.goto(`/adjustments/${ids.adjustment}`);
    await expect(page.getByRole("heading", { name: "Reducing operations" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inspect immutable base" })).toHaveAttribute(
      "href",
      "/programmes/00000000-0000-4000-8000-000000000607",
    );
    await page.getByRole("button", { name: "Edit operations" }).click();
    const setsToRemove = page.getByLabel("Sets to remove");
    await setsToRemove.fill("4");
    await page.getByRole("button", { name: "Save adjustment" }).click();
    await expect(page.getByText(/remove every prescribed set/u)).toBeVisible();
    await expect(setsToRemove).toHaveValue("4");
    await setsToRemove.fill("2");
    await page.getByLabel("Edit note (optional)").fill("Reduce volume after coach review.");
    await page.getByRole("button", { name: "Save adjustment" }).click();
    await expect(page.getByText("Adjustment changes saved.")).toBeVisible();
    await expect(page.getByText("Remove 2 set(s)")).toBeVisible();
    await page.getByRole("button", { name: "Approve and apply" }).click();
    await page
      .getByRole("dialog", { name: "Apply this adjustment?" })
      .getByRole("button", { name: "Confirm and apply" })
      .click();
    await expect(page.getByText("applied", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Inspect published version" })).toBeVisible();

    const generated = await data<{ readonly id: string }>(
      await request.post("/api/v1/adjustments/generate", {
        data: { clientId: ids.healthyClient },
        headers: { "Idempotency-Key": `e2e-adjustment-reject-${crypto.randomUUID()}` },
      }),
    );
    await page.goto(`/adjustments/${generated.id}`);
    await page.getByRole("button", { name: "Reject" }).click();
    const rejectDialog = page.getByRole("dialog", { name: "Reject this adjustment?" });
    await rejectDialog.getByLabel("Decision note (optional)").fill("Keep the current version.");
    await rejectDialog.getByRole("button", { name: "Confirm rejection" }).click();
    await expect(page.getByText("rejected", { exact: true })).toBeVisible();

    const ordinaryApproval = await request.post(
      `/api/v1/adjustments/${ids.blockedAdjustment}/approve`,
      {
        data: { expectedVersion: 1 },
        headers: { "Idempotency-Key": `blocked-adjustment-approve-${crypto.randomUUID()}` },
      },
    );
    expect(ordinaryApproval.status()).toBe(422);
    expect((await ordinaryApproval.json()) as unknown).toMatchObject({
      error: { code: "blocked_requires_override" },
    });
    await page.goto(`/adjustments/${ids.blockedAdjustment}`);
    await expect(page.getByRole("button", { name: "Approve and apply" })).toBeDisabled();
    await expect(page.getByText(/Standard approval is disabled/u)).toBeVisible();
    await page.getByRole("button", { name: "Override block" }).click();
    const overrideDialog = page.getByRole("dialog", {
      name: "Override this blocked adjustment?",
    });
    await expect(
      overrideDialog.getByRole("button", { name: "Apply with override" }),
    ).toBeDisabled();
    await overrideDialog
      .getByLabel("Override reason")
      .fill("Coach accepts this deterministic reducing-only adjustment.");
    await overrideDialog.getByRole("button", { name: "Apply with override" }).click();
    await expect(page.getByText("applied", { exact: true })).toBeVisible();
    await runtime.assertClean();
  });

  test("QA-E2E-009 keeps tier-three accountability coach-owned and auditable", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await openReady(page, `/clients/${ids.disengagedClient}`, "c_006");
    await expect(page.getByText(/Tier 3 · drafted/iu)).toBeVisible();
    await page.getByRole("button", { name: "Run accountability" }).click();
    await expect(page.getByText(/Tier 3 recorded · owner coach/u)).toBeVisible();
    await runtime.assertClean();
  });

  test("QA-E2E-010 renders recorded scorecard availability honestly", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await openReady(page, "/scorecard", "Evaluation scorecard");
    await expect(
      page.getByText("Recorded mode reports deterministic fixture performance"),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Safety pass rate by gate" })).toBeVisible();
    await expect(page.getByText(/samples|No qualifying data/u).first()).toBeVisible();
    await runtime.assertClean();
  });

  test("QA-E2E-011 renders loading, empty, 400/409/429/503, offline, and not-found states", async ({
    page,
  }, testInfo) => {
    let allowedStatus = 0;
    const runtime = installRuntimeGuard(page, testInfo, {
      allowRequestFailure: (url) => url.includes("/api/v1/programmes/generate"),
      allowResponse: (response) =>
        [400, 404, 409, 429, 503].includes(response.status()) ||
        (response.status() === allowedStatus && allowedStatus !== 0),
    });
    await page.route("**/api/v1/scorecard", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    await page.goto("/scorecard");
    await expect(page.getByRole("status", { name: "Loading evaluation scorecard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evaluation scorecard" })).toBeVisible();
    await page.unroute("**/api/v1/scorecard");

    const successEnvelope = {
      data: [],
      error: null,
      meta: { hasMore: false, requestId: "e2e-empty-queue", total: 0 },
    };
    await page.route("**/api/v1/programmes?*", (route) =>
      route.fulfill({ contentType: "application/json", json: successEnvelope }),
    );
    await page.route("**/api/v1/adjustments?*", (route) =>
      route.fulfill({ contentType: "application/json", json: successEnvelope }),
    );
    await page.goto("/queue");
    await expect(page.getByText("Nothing needs review")).toBeVisible();
    const emptyStateClient = page.getByRole("link", { name: "Open client c_001" });
    await expect(emptyStateClient).toHaveAttribute("href", `/clients/${ids.healthyClient}`);
    await emptyStateClient.click();
    await expect(page.getByRole("heading", { name: "c_001" })).toBeVisible();
    await page.unroute("**/api/v1/programmes?*");
    await page.unroute("**/api/v1/adjustments?*");

    await page.goto("/programmes/00000000-0000-4000-8000-000000009999");
    await expect(page.getByText(/Programme does not exist/u)).toBeVisible();

    await openReady(page, "/clients/00000000-0000-4000-8000-000000000103", "c_003");
    const week = page.getByLabel("Target week starts");
    await week.fill("");
    await page.getByRole("button", { name: "Generate proposal" }).click();
    await expect(page.getByText(/Choose a valid target week/u)).toBeVisible();
    await week.fill("2026-08-10");

    const failures = [
      { code: "version_conflict", message: "The proposal changed.", status: 409 },
      { code: "rate_limited", message: "Try again shortly.", status: 429 },
      { code: "dependency_unavailable", message: "Recorded gateway unavailable.", status: 503 },
    ] as const;
    for (const failure of failures) {
      allowedStatus = failure.status;
      await page.route("**/api/v1/programmes/generate", (route) =>
        route.fulfill({
          contentType: "application/json",
          json: {
            data: null,
            error: { code: failure.code, message: failure.message },
            meta: { requestId: `e2e-failure-${String(failure.status)}` },
          },
          status: failure.status,
        }),
      );
      await page
        .getByRole("button", { name: /Generate proposal|Retry/u })
        .last()
        .click();
      await expect(page.getByText(failure.message)).toBeVisible();
      await expect(week).toHaveValue("2026-08-10");
      await page.unroute("**/api/v1/programmes/generate");
    }
    await page.route("**/api/v1/programmes/generate", (route) =>
      route.abort("internetdisconnected"),
    );
    await page
      .getByRole("button", { name: /Generate proposal|Retry/u })
      .last()
      .click();
    await expect(page.getByText(/could not reach/u)).toBeVisible();
    await expect(week).toHaveValue("2026-08-10");
    await runtime.assertClean();
  });

  test("QA-E2E-012 captures all primary coach pages at four required viewports", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    const pages = [
      {
        asset: "coach-review-queue.png",
        name: "queue",
        path: "/queue",
        ready: "Review queue",
      },
      {
        asset: "coach-client-workspace.png",
        name: "client",
        path: `/clients/${ids.healthyClient}`,
        ready: "c_001",
      },
      {
        asset: "coach-programme-review.png",
        name: "programme",
        path: `/programmes/${ids.blockedProgramme}`,
        ready: "Programme content",
      },
      {
        asset: "coach-context-trace.png",
        name: "trace",
        path: "/traces/00000000-0000-4000-8000-000000000202",
        ready: "Context trace",
      },
      {
        asset: "coach-evaluation-scorecard.png",
        name: "scorecard",
        path: "/scorecard",
        ready: "Evaluation scorecard",
      },
    ] as const;
    const viewports = [
      { height: 812, name: "375x812", width: 375 },
      { height: 1024, name: "768x1024", width: 768 },
      { height: 800, name: "1280x800", width: 1280 },
      { height: 900, name: "1440x900", width: 1440 },
    ] as const;
    for (const viewport of viewports) {
      await page.setViewportSize({ height: viewport.height, width: viewport.width });
      for (const target of pages) {
        await page.goto(target.path);
        await expect(page.getByRole("heading", { name: target.ready }).first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        await assertNoHorizontalOverflow(page);
        if (target.name === "queue" && captureDocumentation) {
          await expect(page.getByText(/forbidden movement/iu).first()).toBeVisible();
        }
        if (target.name === "programme") {
          await expect(
            page.getByText("Synthetic forbidden movement is correctly blocked."),
          ).toBeVisible();
        }
        if (target.name === "trace") {
          await expect(
            page.getByRole("heading", { name: "Exact rendered model input" }),
          ).toBeVisible();
        }
        if (target.name === "scorecard") {
          await expect(
            page.getByRole("heading", { name: "Safety pass rate by gate" }),
          ).toBeVisible();
        }
        if (target.name === "client" && viewport.width === 768) {
          const contentColumnCount = await page
            .locator(".content-layout")
            .evaluate(
              (element) =>
                getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/u).filter(Boolean)
                  .length,
            );
          expect(contentColumnCount).toBe(1);
        }
        const path = testInfo.outputPath("screenshots", `${target.name}-${viewport.name}.png`);
        await mkdir(dirname(path), { recursive: true });
        await page.screenshot({ fullPage: true, path });
        if (viewport.width === 1440 && captureDocumentation) {
          await page.screenshot({
            fullPage: true,
            path: `${documentationScreenshots}/${target.asset}`,
          });
        }
        await testInfo.attach(`${target.name}-${viewport.name}`, {
          contentType: "image/png",
          path,
        });
      }
    }
    await runtime.assertClean();
  });
});
