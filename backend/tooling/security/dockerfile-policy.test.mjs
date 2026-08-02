import assert from "node:assert/strict";
import test from "node:test";
import { hasExplicitNonRootRuntimeUser } from "./dockerfile-policy.mjs";

test("accepts explicitly allowlisted distroless and Node runtime users", () => {
  assert.equal(
    hasExplicitNonRootRuntimeUser("FROM example.invalid/runtime@sha256:abc\nUSER nonroot\n"),
    true,
  );
  assert.equal(
    hasExplicitNonRootRuntimeUser("FROM example.invalid/runtime@sha256:abc\nUSER node:node\n"),
    true,
  );
});

test("accepts explicit non-zero numeric runtime identities", () => {
  assert.equal(
    hasExplicitNonRootRuntimeUser("FROM example.invalid/runtime@sha256:abc\nUSER 65532:65532\n"),
    true,
  );
});

test("rejects root, zero, variables, and unapproved named users", () => {
  for (const identity of ["root", "0", "0:0", "$APP_USER", "app"]) {
    assert.equal(
      hasExplicitNonRootRuntimeUser(`FROM example.invalid/runtime@sha256:abc\nUSER ${identity}\n`),
      false,
    );
  }
});

test("enforces the effective user of the final runtime stage", () => {
  assert.equal(
    hasExplicitNonRootRuntimeUser(
      [
        "FROM example.invalid/build@sha256:abc AS build",
        "USER nonroot",
        "FROM example.invalid/runtime@sha256:def",
        "USER root",
      ].join("\n"),
    ),
    false,
  );
  assert.equal(
    hasExplicitNonRootRuntimeUser("FROM example.invalid/runtime@sha256:abc\nRUN true\n"),
    false,
  );
});
