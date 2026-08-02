import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CleanupOwnershipLease,
  assertExactClientStateRestored,
  assertExistingClientStatePreserved,
  assertZeroOwnedRows,
  performanceOwnership,
} from "./ownership.mjs";

const state = {
  clients: { one: { id: "one", status: "active" } },
  messageGuards: { one: { clientId: "one", humanOwnedUntil: null } },
};

test("derives only canonical run and recorded-week ownership keys", () => {
  const ownership = performanceOwnership("20260802070000-performance-a1b2c3");
  assert.equal(ownership.runKeyPrefix, "perf-20260802070000-performance-a1b2c3-");
  assert.equal(
    ownership.runProgrammeAttemptPrefix,
    "programme:perf-20260802070000-performance-a1b2c3-",
  );
  assert.equal(ownership.weeklyStableKey, "weekly-plan:2026-08-03");
  assert.throws(() => performanceOwnership("../../unsafe"), /Invalid/u);
});

test("rejects any owned-row residue, including malformed counters", () => {
  assert.deepEqual(assertZeroOwnedRows({ programmes: 0, traces: 0 }, "run"), {
    programmes: 0,
    traces: 0,
  });
  assert.throws(() => assertZeroOwnedRows({ programmes: 1 }, "run"), /programmes=1/u);
  assert.throws(() => assertZeroOwnedRows({}, "run"), /no counters/u);
});

test("cleanup ownership arms only after an exact zero preflight", () => {
  const rejected = new CleanupOwnershipLease("run namespace");
  assert.throws(() => rejected.acquire({ programmes: 1 }), /programmes=1/u);
  assert.equal(rejected.acquired, false);

  const acquired = new CleanupOwnershipLease("run namespace");
  assert.deepEqual(acquired.acquire({ programmes: 0, traces: 0 }), {
    programmes: 0,
    traces: 0,
  });
  assert.equal(acquired.acquired, true);
  assert.throws(() => acquired.acquire({ programmes: 0 }), /already acquired/u);
});

test("preserves pre-existing clients/guards and requires exact final restoration", () => {
  assert.equal(
    assertExistingClientStatePreserved(state, {
      clients: { ...state.clients, two: { id: "two", status: "active" } },
      messageGuards: {
        ...state.messageGuards,
        two: { clientId: "two", humanOwnedUntil: null },
      },
    }).clients.two.id,
    "two",
  );
  assert.throws(
    () =>
      assertExistingClientStatePreserved(state, {
        clients: { one: { id: "one", status: "paused" } },
        messageGuards: state.messageGuards,
      }),
    /was changed/u,
  );
  assert.throws(
    () =>
      assertExistingClientStatePreserved(state, {
        clients: state.clients,
        messageGuards: { one: { clientId: "one", humanOwnedUntil: "2026-08-04" } },
      }),
    /message guard one was changed/u,
  );
  assert.deepEqual(assertExactClientStateRestored(state, structuredClone(state)), state);
  assert.throws(
    () => assertExactClientStateRestored(state, { ...state, messageGuards: {} }),
    /not restored exactly/u,
  );
});

test("cleanup keeps foreign-key triggers active and scopes append-only authority by name", async () => {
  const runner = await readFile(new URL("./run.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runner, /session_replication_role/iu);
  for (const trigger of [
    "agent_runs_append_only",
    "app_events_append_only",
    "check_ins_append_only",
    "coach_actions_append_only",
    "context_traces_append_only",
    "engagement_scores_append_only",
    "eval_results_append_only",
  ]) {
    assert.match(runner, new RegExp(`DISABLE TRIGGER ${trigger}`, "u"));
    assert.match(runner, new RegExp(`ENABLE TRIGGER ${trigger}`, "u"));
  }
});

test("arms corpus cleanup before the transactional seed command can commit", async () => {
  const runner = await readFile(new URL("./run.mjs", import.meta.url), "utf8");
  const cleanupArmed = runner.indexOf("standardCorpusLease.acquire(");
  const runArmed = runner.indexOf("runOwnershipLease.acquire(");
  const weeklyArmed = runner.indexOf("weeklyOwnershipLease.acquire(");
  const seedInvoked = runner.indexOf(
    'await psql(corpusSql, { label: "seed-standard-performance-corpus" });',
  );
  assert.ok(cleanupArmed >= 0);
  assert.ok(runArmed >= 0);
  assert.ok(weeklyArmed >= 0);
  assert.ok(seedInvoked > cleanupArmed);
  assert.ok(seedInvoked > runArmed);
  assert.ok(seedInvoked > weeklyArmed);
  assert.doesNotMatch(runner, /if \(databasePrepared\)/u);
});

test("arms mutation cleanup before fixture insertion and sweeps exact leaked programme IDs", async () => {
  const runner = await readFile(new URL("./run.mjs", import.meta.url), "utf8");
  const mutationGate = runner.slice(
    runner.indexOf("async function mutationGate"),
    runner.indexOf("async function singlePlanDatabaseEvidence"),
  );
  assert.ok(mutationGate.indexOf("cleanupLease.acquire(") >= 0);
  assert.ok(
    mutationGate.indexOf("await prepareMutationFixture(fixture);") >
      mutationGate.indexOf("cleanupLease.acquire("),
  );
  assert.match(runner, /'mutationProgrammes'.*programmes WHERE id IN/su);
  assert.match(runner, /acquiredMutationFixtures\.set\(iteration, fixture\)/u);
  assert.match(
    runner,
    /for \(const \[iteration, fixture\] of \[\.\.\.acquiredMutationFixtures\]\)/u,
  );
  assert.match(runner, /'mutationSessions'.*sessions WHERE id IN/su);
});

test("captures redacted runtime logs before failure cleanup removes containers", async () => {
  const runner = await readFile(new URL("./run.mjs", import.meta.url), "utf8");
  const capture = runner.indexOf('label: "failure-container-logs"');
  const cleanup = runner.indexOf("if (runOwnershipLease.acquired)");
  assert.ok(capture >= 0);
  assert.ok(cleanup > capture);
});

test("fresh performance execution migrates an empty database without applying demo data", async () => {
  const runner = await readFile(new URL("./run.mjs", import.meta.url), "utf8");
  const environment = runner.slice(
    runner.indexOf("async function prepareEnvironment"),
    runner.indexOf("async function startWebEnvironment"),
  );
  assert.match(environment, /label: "migrate"/u);
  assert.doesNotMatch(environment, /label: "seed"/u);
  assert.doesNotMatch(environment, /\["run", "--no-deps", "--rm", "seed"\]/u);
});

test("fresh execution inserts and validates the owned corpus before web readiness", async () => {
  const runner = await readFile(new URL("./run.mjs", import.meta.url), "utf8");
  const execution = runner.slice(runner.indexOf("let primaryError;"));
  const prepare = execution.indexOf("await prepareEnvironment();");
  const seed = execution.indexOf("const cardinalities = await seedCorpus();");
  const startWeb = execution.indexOf("const baseUrl = await startWebEnvironment();");
  assert.ok(prepare >= 0);
  assert.ok(seed > prepare);
  assert.ok(startWeb > seed);
});

test("database correctness proof uses the exact persisted recorded-audit model", async () => {
  const runner = await readFile(new URL("./run.mjs", import.meta.url), "utf8");
  assert.equal(runner.match(/model='recorded\/spotter-v1'/gu)?.length, 2);
  assert.doesNotMatch(runner, /model LIKE 'spotter-recorded%'/u);
});
