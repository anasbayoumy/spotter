import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";

import { waitFor } from "../docker/lib.mjs";
import {
  SpotterLoadedStateAudit,
  SpotterLoadedStateGatherer,
  loadedStateProofFromLighthouse,
} from "./lighthouse-proof.mjs";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function availableFile(root, pathname) {
  const decoded = decodeURIComponent(pathname).replace(/\0/gu, "");
  const relative = decoded.replace(/^\/+|\/+$/gu, "");
  const candidates = [
    relative.length === 0 ? "index.html" : relative,
    `${relative}.html`,
    path.join(relative, "index.html"),
    /^session\/[^/]+$/u.test(relative) ? "session/[sessionId].html" : "",
    "+not-found.html",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(root, candidate);
    if (
      !resolved.startsWith(`${path.resolve(root)}${path.sep}`) &&
      resolved !== path.resolve(root)
    ) {
      continue;
    }
    try {
      if ((await stat(resolved)).isFile()) return resolved;
    } catch {
      // Candidate is absent; continue to the next deterministic route mapping.
    }
  }
  return null;
}

export async function startExpoWebServer(root, upstreamBaseUrl) {
  const upstream = new URL(upstreamBaseUrl);
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname.startsWith("/api/") || requestUrl.pathname.startsWith("/health/")) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const headers = { ...request.headers };
        delete headers.host;
        const proxied = await fetch(
          new URL(`${requestUrl.pathname}${requestUrl.search}`, upstream),
          {
            body: chunks.length === 0 ? undefined : Buffer.concat(chunks),
            headers,
            method: request.method,
          },
        );
        response.writeHead(proxied.status, Object.fromEntries(proxied.headers.entries()));
        response.end(Buffer.from(await proxied.arrayBuffer()));
        return;
      }
      const file = await availableFile(root, requestUrl.pathname);
      if (file === null) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      const content = await readFile(file);
      response.writeHead(200, {
        "cache-control": file.endsWith(".html")
          ? "no-store"
          : "public, max-age=31536000, immutable",
        "content-type": contentTypes[path.extname(file)] ?? "application/octet-stream",
      });
      response.end(content);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Static server failure");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expo server has no TCP port.");
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Chrome port reservation failed.");
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function launchChrome() {
  const port = await reservePort();
  const userDataDirectory = await mkdtemp(path.join(tmpdir(), "spotter-lighthouse-"));
  const child = spawn(
    chromium.executablePath(),
    [
      "--headless=new",
      `--remote-debugging-port=${String(port)}`,
      `--user-data-dir=${userDataDirectory}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  await waitFor(
    "the Lighthouse Chromium debugger",
    async () => {
      const response = await fetch(`http://127.0.0.1:${String(port)}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      });
      return response.ok;
    },
    { timeoutMs: 30_000 },
  ).catch(async (error) => {
    child.kill("SIGTERM");
    await rm(userDataDirectory, { force: true, recursive: true });
    throw new Error(`${error.message} Chrome stderr: ${stderr.slice(-2_000)}`);
  });
  return {
    child,
    port,
    userDataDirectory,
    async close() {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5_000).unref();
      });
      await rm(userDataDirectory, { force: true, recursive: true });
    },
  };
}

function normalizedPathname(url) {
  const pathname = new URL(url, "http://performance.invalid").pathname.replace(/\/+$/u, "");
  return pathname === "" ? "/" : pathname;
}

async function assertTargetReady(browser, target) {
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  try {
    await page.goto(`${target.baseUrl}${target.route}`, { waitUntil: "networkidle" });
    if (normalizedPathname(page.url()) !== normalizedPathname(target.route)) {
      throw new Error(`Performance target ${target.route} redirected to ${page.url()}.`);
    }
    const locator =
      target.ready.kind === "label"
        ? page.getByLabel(target.ready.name)
        : page.getByRole(target.ready.role, { name: target.ready.name });
    await locator.first().waitFor({ state: "visible", timeout: 30_000 });
  } finally {
    await page.close();
  }
}

function lighthouseResult(result, target, iteration) {
  if (result === undefined) throw new Error(`Lighthouse produced no result for ${target.route}.`);
  const performanceScore = (result.lhr.categories.performance?.score ?? 0) * 100;
  const accessibilityScore = (result.lhr.categories.accessibility?.score ?? 0) * 100;
  const lcp = result.lhr.audits["largest-contentful-paint"]?.numericValue;
  const cls = result.lhr.audits["cumulative-layout-shift"]?.numericValue;
  if (typeof lcp !== "number" || typeof cls !== "number") {
    throw new Error(`Lighthouse omitted LCP/CLS for ${target.route}.`);
  }
  if (normalizedPathname(result.lhr.finalDisplayedUrl) !== normalizedPathname(target.route)) {
    throw new Error(
      `Lighthouse target ${target.route} finished at ${result.lhr.finalDisplayedUrl}.`,
    );
  }
  const loadedStateProof = loadedStateProofFromLighthouse(result, target);
  return {
    accessibilityScore,
    cls,
    finalUrl: result.lhr.finalDisplayedUrl,
    iteration,
    lcpMs: lcp,
    loadedStateProof,
    performanceScore,
    requestedUrl: result.lhr.requestedUrl,
    route: target.route,
    surface: target.surface,
  };
}

export async function persistRawThenSummarizeLighthouseResult(result, target, iteration, onResult) {
  if (result === undefined) throw new Error(`Lighthouse produced no result for ${target.route}.`);
  await onResult?.(
    {
      iteration,
      route: target.route,
      surface: target.surface,
    },
    result.report,
  );
  return lighthouseResult(result, target, iteration);
}

export function lighthouseConfig(target) {
  return {
    artifacts: [
      {
        gatherer: { instance: new SpotterLoadedStateGatherer(target) },
        id: "SpotterLoadedState",
      },
    ],
    audits: [{ implementation: SpotterLoadedStateAudit }],
    categories: {
      "spotter-loaded-state": {
        auditRefs: [{ id: "spotter-loaded-state", weight: 1 }],
        title: "Spotter loaded state",
      },
    },
    extends: "lighthouse:default",
    ...(target.surface === "client"
      ? {}
      : {
          settings: {
            formFactor: "desktop",
            screenEmulation: {
              deviceScaleFactor: 1,
              disabled: false,
              height: 900,
              mobile: false,
              width: 1440,
            },
          },
        }),
  };
}

export async function runLighthouseMatrix(options) {
  const chrome = await launchChrome();
  const results = [];
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(chrome.port)}`);
    if (options.clientBaseUrl !== undefined) {
      const context = browser.contexts()[0] ?? (await browser.newContext());
      const page = await context.newPage();
      await page.goto(`${options.clientBaseUrl}/select-client`, { waitUntil: "networkidle" });
      const selector = page.getByRole("button", { name: /^Select c_001$/u });
      await selector.waitFor({ state: "visible", timeout: 30_000 });
      await selector.click();
      await page.getByRole("heading", { name: "Today" }).waitFor({ timeout: 30_000 });
      await page.close();
    }
    for (const target of options.targets) {
      await assertTargetReady(browser, target);
      for (let iteration = 1; iteration <= 3; iteration += 1) {
        const result = await lighthouse(
          `${target.baseUrl}${target.route}`,
          {
            disableStorageReset: true,
            logLevel: "error",
            onlyCategories: ["performance", "accessibility", "spotter-loaded-state"],
            output: "json",
            port: chrome.port,
          },
          lighthouseConfig(target),
        );
        const summary = await persistRawThenSummarizeLighthouseResult(
          result,
          target,
          iteration,
          options.onResult,
        );
        results.push(summary);
      }
    }
    return results;
  } finally {
    await browser?.close();
    await chrome.close();
  }
}
