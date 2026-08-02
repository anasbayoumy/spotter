import assert from "node:assert/strict";
import test from "node:test";

import {
  SpotterLoadedStateAudit,
  SpotterLoadedStateGatherer,
  loadedStateProofFromLighthouse,
  validateLoadedStateArtifact,
} from "./lighthouse-proof.mjs";

const artifact = {
  expectedPath: "/clients/one",
  finalPath: "/clients/one/",
  marker: { kind: "role", name: "c_001", role: "heading" },
  match: { tagName: "h1", text: "c_001" },
  visible: true,
};

test("accepts only an exact visible route-specific marker", () => {
  assert.equal(validateLoadedStateArtifact(artifact).valid, true);
  assert.equal(validateLoadedStateArtifact({ ...artifact, finalPath: "/queue" }).valid, false);
  assert.equal(validateLoadedStateArtifact({ ...artifact, visible: false }).valid, false);
  assert.equal(
    validateLoadedStateArtifact({ ...artifact, match: { ...artifact.match, text: "other" } }).valid,
    false,
  );
});

test("custom Lighthouse audit carries the gathered proof into the measured report", () => {
  const audited = SpotterLoadedStateAudit.audit({ SpotterLoadedState: artifact });
  assert.equal(audited.score, 1);
  const result = {
    lhr: {
      audits: {
        "spotter-loaded-state": {
          details: audited.details,
          numericValue: audited.numericValue,
          score: audited.score,
        },
      },
    },
  };
  assert.equal(
    loadedStateProofFromLighthouse(result, {
      ready: { kind: "role", name: "c_001", role: "heading" },
      route: "/clients/one",
    }).valid,
    true,
  );
  delete result.lhr.audits["spotter-loaded-state"].numericValue;
  assert.equal(
    loadedStateProofFromLighthouse(result, {
      ready: { kind: "role", name: "c_001", role: "heading" },
      route: "/clients/one",
    }).valid,
    true,
  );
  result.lhr.audits["spotter-loaded-state"].score = 0;
  assert.throws(
    () =>
      loadedStateProofFromLighthouse(result, {
        ready: { kind: "role", name: "c_001", role: "heading" },
        route: "/clients/one",
      }),
    /Expected .*observed .*"auditNumericValue":null.*"auditScore":0/u,
  );
});

test("rejects a role mismatch and reports the complete observed proof", () => {
  const audited = SpotterLoadedStateAudit.audit({
    SpotterLoadedState: {
      ...artifact,
      marker: { kind: "role", name: "c_001", role: "status" },
    },
  });
  assert.throws(
    () =>
      loadedStateProofFromLighthouse(
        {
          lhr: {
            audits: {
              "spotter-loaded-state": {
                details: audited.details,
                score: audited.score,
              },
            },
          },
        },
        {
          ready: { kind: "role", name: "c_001", role: "heading" },
          route: "/clients/one",
        },
      ),
    /"role":"heading".*observed .*"finalPath":"\/clients\/one".*"role":"status"/u,
  );
});

test("custom gatherer waits on the measured navigation until the exact marker is visible", async () => {
  const attempts = [
    { ...artifact, match: null, visible: false },
    { ...artifact, finalPath: "/queue" },
    artifact,
  ];
  const evaluatedExpected = [];
  const waits = [];
  let currentTime = 0;
  const gatherer = new SpotterLoadedStateGatherer(
    {
      ready: { kind: "role", name: "c_001", role: "heading" },
      route: "/clients/one",
    },
    {
      now: () => currentTime,
      pollIntervalMs: 100,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        currentTime += milliseconds;
      },
      timeoutMs: 500,
    },
  );
  const result = await gatherer.getArtifact({
    driver: {
      executionContext: {
        evaluate(_collect, options) {
          evaluatedExpected.push(options.args[0]);
          return attempts.shift();
        },
      },
    },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(waits, [100, 100]);
  assert.deepEqual(evaluatedExpected, [
    { kind: "role", name: "c_001", path: "/clients/one", role: "heading" },
    { kind: "role", name: "c_001", path: "/clients/one", role: "heading" },
    { kind: "role", name: "c_001", path: "/clients/one", role: "heading" },
  ]);
});

test("custom gatherer stops at its bounded deadline and returns the final invalid proof", async () => {
  const waits = [];
  let attempts = 0;
  let currentTime = 0;
  const gatherer = new SpotterLoadedStateGatherer(
    {
      ready: { kind: "role", name: "c_001", role: "heading" },
      route: "/clients/one",
    },
    {
      now: () => currentTime,
      pollIntervalMs: 100,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        currentTime += milliseconds;
      },
      timeoutMs: 250,
    },
  );
  const result = await gatherer.getArtifact({
    driver: {
      executionContext: {
        evaluate() {
          attempts += 1;
          return { ...artifact, match: null, visible: false };
        },
      },
    },
  });

  assert.equal(result.valid, false);
  assert.equal(attempts, 4);
  assert.deepEqual(waits, [100, 100, 50]);
});
