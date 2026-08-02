import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

import { installRuntimeGuard } from "./support/runtime-guards";

const ids = {
  blockedClient: "00000000-0000-4000-8000-000000000102",
  disengagedClient: "00000000-0000-4000-8000-000000000106",
  healthyClient: "00000000-0000-4000-8000-000000000101",
  session: "00000000-0000-4000-8000-000000000701",
  supersededClient: "00000000-0000-4000-8000-000000000104",
} as const;

const documentationScreenshots = resolve(process.cwd(), "../DOCS/assets/screenshots");
const captureDocumentation = process.env.SPOTTER_CAPTURE_DOCS === "true";

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

async function selectClient(page: Page, handle: string): Promise<void> {
  await page.goto("/select-client");
  await expect(page.getByRole("heading", { name: "Select demo client" })).toBeVisible();
  await page.getByRole("button", { name: `Select ${handle}` }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

async function expectDemoBoundary(page: Page): Promise<void> {
  const copy = page.getByText("Synthetic demo · Client selector is not sign-in", { exact: true });
  await expect(copy).toBeVisible();
  const banner = copy.locator("..");
  await expect
    .poll(async () => (await banner.boundingBox())?.width ?? 0, {
      message: "The synthetic/no-auth boundary must not collapse in a mobile viewport.",
    })
    .toBeGreaterThan(300);
}

async function ensureCompletedHistorySession(request: APIRequestContext): Promise<void> {
  const session = await data<{
    readonly rpe: number | null;
    readonly status: string;
    readonly version: number;
  }>(await request.get(`/api/v1/sessions/${ids.session}`));
  if (session.status === "completed") {
    expect(session.rpe).toBe(7.5);
    return;
  }
  expect(session.status).toBe("scheduled");

  const logged = await data<{ readonly version: number }>(
    await request.post(`/api/v1/sessions/${ids.session}/log`, {
      data: {
        actual: [
          {
            exerciseId: "00000000-0000-4000-8000-000000000301",
            sets: Array.from({ length: 4 }, (_, index) => ({
              completed: true,
              loadKg: 40,
              reps: 8,
              rpe: 7,
              setIndex: index + 1,
            })),
          },
        ],
        clientId: ids.healthyClient,
        expectedVersion: session.version,
        notes: "Independent QA-CLI-007 completed-history fixture.",
      },
      headers: { "Idempotency-Key": `client-e2e-history-log-${crypto.randomUUID()}` },
    }),
  );
  const completed = await data<{ readonly rpe: number | null; readonly status: string }>(
    await request.post(`/api/v1/sessions/${ids.session}/complete`, {
      data: {
        clientId: ids.healthyClient,
        expectedVersion: logged.version,
        performedAt: "2026-08-02T08:00:00.000Z",
        rpe: 7.5,
      },
      headers: { "Idempotency-Key": `client-e2e-history-complete-${crypto.randomUUID()}` },
    }),
  );
  expect(completed).toMatchObject({ rpe: 7.5, status: "completed" });
}

test.describe.serial("QA-CLI production Expo-web journeys", () => {
  test("QA-CLI-001 selects a synthetic handle and persists it without identity fields", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await page.goto("/");
    await expect(page.getByText(/selector is not sign-in/iu)).toBeVisible();
    await selectClient(page, "c_001");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    await expect(page.getByText(/password|sign in/iu)).toHaveCount(0);
    await runtime.assertClean();
  });

  test("QA-CLI-002 Today exposes only the current coach-published contract", async ({
    page,
    request,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await selectClient(page, "c_001");
    await expect(
      page.getByText("Only the current coach-published plan is shown here."),
    ).toBeVisible();
    await expect(page.getByText(/Rest day|Row ergometer intervals/u).first()).toBeVisible();
    const today = await data<{
      readonly clientId: string;
      readonly programme: { readonly id: string; readonly status: string } | null;
    }>(await request.get(`/api/v1/clients/${ids.healthyClient}/today`));
    expect(today.clientId).toBe(ids.healthyClient);
    expect(today.programme).toMatchObject({
      id: "00000000-0000-4000-8000-000000000601",
      status: "published",
    });
    await runtime.assertClean();
  });

  test("QA-CLI-003 never exposes queued, blocked, rejected, or superseded content", async ({
    page,
    request,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await selectClient(page, "c_002");
    await expect(page.getByText("No published plan yet")).toBeVisible();
    await expect(page.getByText("A synthetic recorded-mode training week.")).toHaveCount(0);
    const blockedToday = await data<{ readonly programme: unknown }>(
      await request.get(`/api/v1/clients/${ids.blockedClient}/today`),
    );
    expect(blockedToday.programme).toBeNull();

    const supersededToday = await data<{
      readonly programme: { readonly id: string; readonly version: number } | null;
    }>(await request.get(`/api/v1/clients/${ids.supersededClient}/today`));
    expect(supersededToday.programme).toMatchObject({
      id: "00000000-0000-4000-8000-000000000605",
      version: 2,
    });
    expect(supersededToday.programme?.id).not.toBe("00000000-0000-4000-8000-000000000604");
    await runtime.assertClean();
  });

  test("QA-CLI-008 sends one eligible nudge while coach-owned automation remains private", async ({
    page,
    request,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    const cronHeaders = {
      Authorization: "Bearer client-e2e-production-cron-secret",
      "Idempotency-Key": "client-e2e-accountability-2026-08-03",
    };
    const first = await request.post("/api/v1/jobs/daily-accountability", {
      data: {
        effectiveAt: "2026-08-03T09:00:00.000Z",
        runKey: "daily-accountability:2026-08-03",
      },
      headers: cronHeaders,
    });
    const firstSummary = await data<{
      readonly processed: number;
      readonly runKey: string;
      readonly status: string;
      readonly succeeded: number;
    }>(first);
    const replay = await request.post("/api/v1/jobs/daily-accountability", {
      data: {
        effectiveAt: "2026-08-03T09:00:00.000Z",
        runKey: "daily-accountability:2026-08-03",
      },
      headers: cronHeaders,
    });
    const replaySummary = await data<typeof firstSummary>(replay);
    expect(replaySummary).toEqual(firstSummary);
    const freshWindow = await request.post("/api/v1/jobs/daily-accountability", {
      data: {
        effectiveAt: "2026-08-04T09:00:00.000Z",
        runKey: "daily-accountability:2026-08-04",
      },
      headers: {
        Authorization: "Bearer client-e2e-production-cron-secret",
        "Idempotency-Key": "client-e2e-accountability-2026-08-04",
      },
    });
    const freshSummary = await data<typeof firstSummary>(freshWindow);
    expect(freshSummary.status).toBe("completed");
    expect(freshSummary.processed).toBeGreaterThan(0);

    const messages = await data<
      readonly {
        readonly actor: string;
        readonly status: string;
        readonly tier: number;
      }[]
    >(await request.get(`/api/v1/clients/${ids.healthyClient}/messages?limit=100`));
    expect(
      messages.filter(
        (message) => message.actor === "agent" && message.status === "sent" && message.tier === 1,
      ),
    ).toHaveLength(1);
    expect(
      messages.filter((message) => message.actor === "agent" && message.tier === 1),
    ).toHaveLength(1);

    await selectClient(page, "c_001");
    await expect(page.getByText("A note for you")).toBeVisible();
    await selectClient(page, "c_006");
    await expect(page.getByText("Synthetic coach outreach brief.")).toHaveCount(0);
    const coachOwnedToday = await data<{ readonly outstandingMessage: unknown }>(
      await request.get(`/api/v1/clients/${ids.disengagedClient}/today`),
    );
    expect(coachOwnedToday.outstandingMessage).toBeNull();
    await runtime.assertClean();
  });

  test("QA-CLI-004/005 validates, preserves, idempotently logs, and completes one session", async ({
    page,
    request,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await selectClient(page, "c_001");
    await page.goto(`/session/${ids.session}`);
    await expect(page.getByRole("heading", { name: "Log session" })).toBeVisible();
    await page.getByLabel("Session notes (optional)").fill("E2E completed with controlled effort.");
    await page.getByRole("button", { name: "Save and complete session" }).click();
    await expect(page.getByText("Check the session fields")).toBeVisible();
    await expect(page.getByLabel("Session notes (optional)")).toHaveValue(
      "E2E completed with controlled effort.",
    );

    const switches = page.getByRole("switch");
    await expect(switches).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
      await expect(switches.nth(index)).toBeChecked();
      await page.getByLabel(`Set ${String(index + 1)} RPE`).fill("7");
    }
    await page.getByLabel("Set 1 load kg").fill("40");
    await page.getByLabel("Overall session RPE").fill("7.5");
    const submit = page.getByRole("button", { name: "Save and complete session" });
    await submit.dblclick();
    await expect(page.getByText("Session completed")).toBeVisible();

    const stored = await data<{
      readonly actual: readonly unknown[] | null;
      readonly notes: string | null;
      readonly status: string;
      readonly version: number;
    }>(await request.get(`/api/v1/sessions/${ids.session}`));
    expect(stored.status).toBe("completed");
    expect(stored.notes).toBe("E2E completed with controlled effort.");
    expect(stored.actual).toHaveLength(1);
    expect(stored.version).toBeGreaterThanOrEqual(3);

    await page.reload();
    await expect(page.getByText("Session completed")).toBeVisible();
    await runtime.assertClean();
  });

  test("QA-CLI-006 check-in free text is present in the next exact assembled trace", async ({
    page,
    request,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    const uniqueBody = `E2E readiness context ${crypto.randomUUID()}`;
    await selectClient(page, "c_001");
    await page.goto("/check-in");
    await expect(page.getByRole("heading", { name: "Check-in" })).toBeVisible();
    await page.getByRole("radio", { name: "Readiness 2 of 5" }).click();
    await page.getByLabel("How are you feeling?").fill(uniqueBody);
    await page.getByRole("button", { name: "Send check-in" }).click();
    await expect(page.getByText(/Check-in received|Sent for human review/u)).toBeVisible();

    const review = await data<{ readonly traceId: string }>(
      await request.post("/api/v1/programmes/generate", {
        data: { clientId: ids.healthyClient, targetWeekStart: "2026-08-10" },
        headers: { "Idempotency-Key": `client-e2e-trace-${crypto.randomUUID()}` },
      }),
    );
    const trace = await data<{ readonly rendered: string }>(
      await request.get(`/api/v1/traces/${review.traceId}`),
    );
    expect(trace.rendered).toContain(uniqueBody);
    await runtime.assertClean();
  });

  test("QA-CLI-007 History distinguishes completed and missed work while excluding planned work", async ({
    page,
    request,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await ensureCompletedHistorySession(request);
    await selectClient(page, "c_001");
    await page.goto("/history");
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(page.getByText(/Completed · Session RPE 7.5/u)).toBeVisible();
    await expect(page.getByText("Missed after its due date")).toBeVisible();
    await expect(page.getByText(/scheduled|planned/u)).toHaveCount(0);
    await runtime.assertClean();
  });

  test("QA-CLI-009 offline and 503 failures preserve the local check-in draft", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo, {
      allowRequestFailure: (url) => url.includes("/api/v1/check-ins"),
      allowResponse: (response) => response.status() === 503,
    });
    await selectClient(page, "c_003");
    await page.goto("/check-in");
    await page.getByRole("radio", { name: "Readiness 1 of 5" }).click();
    const response = page.getByLabel("How are you feeling?");
    await response.fill("E2E draft must survive transport failure.");
    await page.route("**/api/v1/check-ins", (route) => route.abort("internetdisconnected"));
    await page.getByRole("button", { name: "Send check-in" }).click();
    await expect(page.getByText("You appear to be offline")).toBeVisible();
    await expect(response).toHaveValue("E2E draft must survive transport failure.");
    await page.unroute("**/api/v1/check-ins");

    await page.route("**/api/v1/check-ins", (route) =>
      route.fulfill({
        contentType: "application/json",
        json: {
          data: null,
          error: { code: "dependency_unavailable", message: "Check-in service unavailable." },
          meta: { requestId: "client-e2e-503" },
        },
        status: 503,
      }),
    );
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Check-in service unavailable.")).toBeVisible();
    await expect(response).toHaveValue("E2E draft must survive transport failure.");
    await page.unroute("**/api/v1/check-ins");
    await page.reload();
    await expect(page.getByLabel("How are you feeling?")).toHaveValue(
      "E2E draft must survive transport failure.",
    );
    await runtime.assertClean();
  });

  test("QA-CLI-010 completes with no console, hydration, asset, runtime, or origin defect", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await page.setViewportSize({ height: 844, width: 390 });
    await selectClient(page, "c_001");
    for (const path of [
      "/today",
      "/history",
      "/check-in",
      `/session/${ids.session}`,
      "/select-client",
    ] as const) {
      await page.goto(path);
      await expect(page.locator("body")).not.toBeEmpty();
      await expectDemoBoundary(page);
    }
    await runtime.assertClean();
  });

  test("QA-CLI-011 captures every documented client screen from the current build", async ({
    page,
  }, testInfo) => {
    const runtime = installRuntimeGuard(page, testInfo);
    await page.setViewportSize({ height: 844, width: 390 });
    await mkdir(documentationScreenshots, { recursive: true });

    const capture = async (name: string): Promise<void> => {
      const screenshotPath = `${documentationScreenshots}/${name}`;
      await mkdir(dirname(screenshotPath), { recursive: true });
      await page.waitForLoadState("networkidle");
      await expectDemoBoundary(page);
      if (captureDocumentation) {
        await page.screenshot({ fullPage: true, path: screenshotPath });
      }
    };

    await page.goto("/select-client");
    await expect(page.getByRole("heading", { name: "Select demo client" })).toBeVisible();
    await capture("client-selector-mobile.png");

    await selectClient(page, "c_002");
    await expect(page.getByText("No published plan yet")).toBeVisible();
    await capture("client-no-published-plan-mobile.png");

    await selectClient(page, "c_001");
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(page.getByText(/Rest day|Row ergometer intervals/u).first()).toBeVisible();
    await capture("client-today-mobile.png");

    await page.goto("/check-in");
    await expect(page.getByRole("heading", { name: "Check-in" })).toBeVisible();
    await capture("client-check-in-mobile.png");

    await page.goto(`/session/${ids.session}`);
    await expect(
      page.getByRole("heading", { name: /Log session|Session completed/u }),
    ).toBeVisible();
    await capture("client-session-log-mobile.png");
    await runtime.assertClean();
  });
});
