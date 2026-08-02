import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMutationContractFixture,
  assertNonDestructiveCorpusSql,
  assertExactActiveSyntheticClientSet,
  createMutationContractFixture,
  intendedPerformanceClientIds,
  performanceClientId,
  recordedWeekStart,
} from "./fixtures.mjs";
import { readFile } from "node:fs/promises";

test("defines exactly fifty unique synthetic performance identities", () => {
  assert.equal(intendedPerformanceClientIds.length, 50);
  assert.equal(new Set(intendedPerformanceClientIds).size, 50);
  assert.equal(intendedPerformanceClientIds[0], performanceClientId(1));
  assert.equal(intendedPerformanceClientIds.at(-1), performanceClientId(50));
  assert.throws(() => performanceClientId(0), /1 through 50/u);
  assert.equal(assertExactActiveSyntheticClientSet([...intendedPerformanceClientIds]).length, 50);
  assert.throws(
    () => assertExactActiveSyntheticClientSet(intendedPerformanceClientIds.slice(1)),
    /exactly the intended 50/u,
  );
});

test("builds a contract-valid programme day with matching planned and actual exercise", () => {
  const fixture = createMutationContractFixture();
  assert.equal(assertMutationContractFixture(fixture), fixture);
  assert.equal(fixture.payload.days[0].scheduledDate, recordedWeekStart);
  assert.equal(fixture.payload.days[0].exercises[0].id, fixture.actual[0].exerciseId);
});

test("fails when the fixture uses an empty day, wrong week, or unrelated actual exercise", () => {
  const fixture = createMutationContractFixture();
  assert.throws(
    () => assertMutationContractFixture({ ...fixture, payload: { ...fixture.payload, days: [] } }),
    /one day/u,
  );
  assert.throws(
    () =>
      assertMutationContractFixture({
        ...fixture,
        payload: {
          ...fixture.payload,
          days: [{ ...fixture.payload.days[0], scheduledDate: "2026-08-10" }],
        },
      }),
    /requested week/u,
  );
  assert.throws(
    () =>
      assertMutationContractFixture({
        ...fixture,
        actual: [{ ...fixture.actual[0], exerciseId: performanceClientId(1) }],
      }),
    /identities differ/u,
  );
});

test("standard corpus SQL is transactional and cannot rewrite clients or delete message guards", async () => {
  const sql = await readFile(new URL("./fixtures/standard-corpus.sql", import.meta.url), "utf8");
  assert.equal(assertNonDestructiveCorpusSql(sql), sql);
  assert.throws(
    () => assertNonDestructiveCorpusSql(`${sql}\nDELETE FROM message_guards;`),
    /destructive statement/u,
  );
  assert.throws(
    () => assertNonDestructiveCorpusSql("UPDATE clients SET status='active';"),
    /destructive statement/u,
  );
  assert.doesNotMatch(sql, /jsonb_build_object\([^;]*'preference'/iu);
  assert.match(sql, /'note', 'Prefers consistent weekday training\.'/u);
  assert.match(sql, /'forbidden_movement'/u);
  assert.doesNotMatch(sql, /performance_corpus_gate/u);
  assert.match(
    sql,
    /FROM generate_series\(1, 50\) AS corpus\(client_number\)\nON CONFLICT DO NOTHING;/u,
  );
  assert.doesNotMatch(sql, /generate_series\(8, 50\)/u);
});
