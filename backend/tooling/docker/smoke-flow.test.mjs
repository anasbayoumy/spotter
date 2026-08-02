import assert from "node:assert/strict";
import test from "node:test";

import { assertOverridePersistence } from "./smoke-flow.mjs";

const expected = {
  reason: "Synthetic QA override with explicit coach rationale.",
  requestId: "docker-smoke-programme-override-v1",
};

test("accepts authoritative override and coach-action persistence evidence", () => {
  assert.doesNotThrow(() =>
    assertOverridePersistence(
      {
        approvalKind: "override",
        auditAction: "overrode_block",
        reason: expected.reason,
        requestId: expected.requestId,
      },
      expected,
    ),
  );
});

test("rejects missing or altered blocked-override audit evidence", () => {
  const valid = {
    approvalKind: "override",
    auditAction: "overrode_block",
    reason: expected.reason,
    requestId: expected.requestId,
  };
  for (const [field, value] of [
    ["approvalKind", undefined],
    ["auditAction", "approved"],
    ["reason", "different reason"],
    ["requestId", "different-request"],
  ]) {
    assert.throws(
      () => assertOverridePersistence({ ...valid, [field]: value }, expected),
      /override|audit/u,
    );
  }
});
