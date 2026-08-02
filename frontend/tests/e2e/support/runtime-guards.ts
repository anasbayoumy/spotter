import { expect, type Page, type Response, type TestInfo } from "@playwright/test";

interface RuntimeGuardOptions {
  readonly allowRequestFailure?: (url: string) => boolean;
  readonly allowResponse?: (response: Response) => boolean;
}

export interface RuntimeGuard {
  readonly assertClean: () => Promise<void>;
}

const hydrationPattern = /hydration|did not match|server rendered html|failed to hydrate/iu;
const browserNetworkConsolePattern =
  /^Failed to load resource: (?:net::|the server responded with a status of)/u;

export function installRuntimeGuard(
  page: Page,
  testInfo: TestInfo,
  options: RuntimeGuardOptions = {},
): RuntimeGuard {
  const failures: string[] = [];
  const baseOrigin = new URL(testInfo.project.use.baseURL ?? "http://127.0.0.1").origin;

  page.on("console", (message) => {
    // Playwright's response/requestfailed listeners below retain the URL, method, and allow-list
    // context; Chromium's synthetic duplicate has none of those details.
    if (browserNetworkConsolePattern.test(message.text())) return;
    if (message.type() === "error" || hydrationPattern.test(message.text())) {
      failures.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    failures.push(`pageerror: ${error.message}`);
  });
  page.on("request", (request) => {
    const url = request.url();
    if (/^(?:about:|blob:|data:)/u.test(url)) return;
    if (new URL(url).origin !== baseOrigin) failures.push(`unexpected origin: ${url}`);
  });
  page.on("requestfailed", (request) => {
    if (options.allowRequestFailure?.(request.url()) === true) return;
    if (
      request.failure()?.errorText.includes("ERR_ABORTED") === true &&
      new URL(request.url()).searchParams.has("_rsc")
    ) {
      return;
    }
    failures.push(
      `request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`,
    );
  });
  page.on("response", (response) => {
    if (response.status() < 400 || options.allowResponse?.(response) === true) return;
    failures.push(
      `response ${String(response.status())}: ${response.request().method()} ${response.url()}`,
    );
  });

  return {
    async assertClean() {
      await expect
        .poll(() => failures, {
          message: `Browser runtime defects:\n${failures.join("\n")}`,
          timeout: 500,
        })
        .toEqual([]);
    },
  };
}

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth, "page must reflow without horizontal clipping").toBeLessThanOrEqual(
    overflow.clientWidth + 1,
  );
}
