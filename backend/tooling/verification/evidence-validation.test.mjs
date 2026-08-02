import assert from "node:assert/strict";
import test from "node:test";

import { isCanonicalRequirementId } from "./evidence-validation.mjs";

test("accepts canonical requirement families with digit-bearing segments", () => {
  for (const value of ["QA-E2E-011", "QA-A11Y-005", "QA-REL-001", "NFR-PERF-010"]) {
    assert.equal(isCanonicalRequirementId(value), true, value);
  }
});

test("rejects malformed requirement identifiers", () => {
  for (const value of [
    "QA-E2E-11",
    "QA--E2E-011",
    "QA-e2e-011",
    "1QA-E2E-011",
    "QA-E2E2-011-extra",
    "QA-E2E-011\n",
    null,
  ]) {
    assert.equal(isCanonicalRequirementId(value), false, String(value));
  }
});
