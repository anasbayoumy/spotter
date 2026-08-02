import assert from "node:assert/strict";
import test from "node:test";

import { assertCleanReleaseSource, resolvePerformanceExecution } from "./execution-policy.mjs";

test("release always owns a fresh build and rejects every attachment override", () => {
  assert.deepEqual(resolvePerformanceExecution({}), {
    attached: false,
    mode: "fresh-owned-release",
    ownsCompose: true,
    profile: "release",
    releaseEligible: true,
  });
  for (const name of [
    "SPOTTER_PERF_COMPOSE_PROJECT",
    "SPOTTER_PERF_BASE_URL",
    "SPOTTER_PERF_WEB_PORT",
  ]) {
    assert.throws(() => resolvePerformanceExecution({ [name]: "supplied" }), /cannot attach/u);
  }
});

test("only smoke can attach and its mode is unambiguously non-release", () => {
  assert.deepEqual(
    resolvePerformanceExecution({
      SPOTTER_PERF_COMPOSE_PROJECT: "spotter-qa-run",
      SPOTTER_PERF_PROFILE: "smoke",
    }),
    {
      attached: true,
      mode: "attached-smoke-non-release",
      ownsCompose: false,
      profile: "smoke",
      releaseEligible: false,
    },
  );
  assert.throws(
    () =>
      resolvePerformanceExecution({
        SPOTTER_PERF_BASE_URL: "http://127.0.0.1:3000",
        SPOTTER_PERF_PROFILE: "smoke",
      }),
    /require an explicit QA Compose project/u,
  );
  assert.throws(
    () => resolvePerformanceExecution({ SPOTTER_PERF_PROFILE: "benchmark" }),
    /release or smoke/u,
  );
});

test("dirty source is rejected before a release build but retained as smoke evidence", () => {
  const dirty = { dirty: true };
  assert.throws(
    () => assertCleanReleaseSource(resolvePerformanceExecution({}), dirty),
    /clean source tree/u,
  );
  assert.equal(
    assertCleanReleaseSource(resolvePerformanceExecution({ SPOTTER_PERF_PROFILE: "smoke" }), dirty),
    dirty,
  );
});
