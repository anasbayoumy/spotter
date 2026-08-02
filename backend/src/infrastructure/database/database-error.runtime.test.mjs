import assert from "node:assert/strict";
import test from "node:test";

import { isDatabaseDependencyUnavailable } from "./database-error.ts";

test("loads the database classifier through the production Node ESM resolver", () => {
  const error = Object.assign(new Error("opaque driver failure"), { code: "ECONNREFUSED" });
  assert.equal(isDatabaseDependencyUnavailable(error), true);
});
