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
    // The structured network listeners below enforce the same defect with request context.
    if (browserNetworkConsolePattern.test(message.text())) return;
    if (message.type() === "error" || hydrationPattern.test(message.text())) {
      failures.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("request", (request) => {
    const url = request.url();
    if (/^(?:about:|blob:|data:)/u.test(url)) return;
    if (new URL(url).origin !== baseOrigin) failures.push(`unexpected origin: ${url}`);
  });
  page.on("requestfailed", (request) => {
    if (options.allowRequestFailure?.(request.url()) === true) return;
    const requestUrl = new URL(request.url());
    if (
      request.failure()?.errorText.includes("ERR_ABORTED") === true &&
      request.method() === "GET" &&
      requestUrl.origin === baseOrigin &&
      requestUrl.pathname.startsWith("/api/")
    ) {
      // React Query cancels obsolete reads when Expo Router changes or reloads a route.
      return;
    }
    if (
      request.failure()?.errorText.includes("ERR_ABORTED") === true &&
      requestUrl.searchParams.has("_rsc")
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
