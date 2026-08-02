import assert from "node:assert/strict";
import test from "node:test";

import { initializeConfig } from "lighthouse/core/config/config.js";

import { lighthouseConfig, persistRawThenSummarizeLighthouseResult } from "./lighthouse.mjs";

test("installed Lighthouse resolves the per-navigation loaded-state audit", async () => {
  const target = {
    ready: { kind: "role", name: "Review queue", role: "heading" },
    route: "/queue",
    surface: "coach",
  };
  const { resolvedConfig } = await initializeConfig("navigation", lighthouseConfig(target), {
    onlyCategories: ["performance", "accessibility", "spotter-loaded-state"],
  });
  assert.ok(resolvedConfig.artifacts.some((entry) => entry.id === "SpotterLoadedState"));
  assert.ok(
    resolvedConfig.audits.some((entry) => entry.implementation.meta.id === "spotter-loaded-state"),
  );
  assert.ok(resolvedConfig.categories?.["spotter-loaded-state"]);
});

test("persists raw Lighthouse JSON before loaded-state proof parsing", async () => {
  const target = {
    ready: { kind: "role", name: "Review queue", role: "heading" },
    route: "/queue",
    surface: "coach",
  };
  const report = JSON.stringify({ requestedUrl: "http://127.0.0.1:3000/queue" });
  const result = {
    lhr: {
      audits: {
        "cumulative-layout-shift": { numericValue: 0 },
        "largest-contentful-paint": { numericValue: 1_000 },
        "spotter-loaded-state": {
          details: {
            items: [
              {
                expectedPath: "/queue",
                finalPath: "/queue",
                marker: { kind: "role", name: "Review queue", role: "heading" },
                match: null,
                visible: false,
              },
            ],
            type: "debugdata",
          },
          score: 0,
        },
      },
      categories: {
        accessibility: { score: 1 },
        performance: { score: 1 },
      },
      finalDisplayedUrl: "http://127.0.0.1:3000/queue",
      requestedUrl: "http://127.0.0.1:3000/queue",
    },
    report,
  };
  const persisted = [];

  await assert.rejects(
    persistRawThenSummarizeLighthouseResult(result, target, 2, async (identity, raw) => {
      persisted.push({ identity, raw });
    }),
    /loaded-state proof failed.*observed .*"auditNumericValue":null/u,
  );
  assert.deepEqual(persisted, [
    {
      identity: { iteration: 2, route: "/queue", surface: "coach" },
      raw: report,
    },
  ]);
});
