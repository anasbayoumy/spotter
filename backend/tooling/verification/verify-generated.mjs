import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildOpenApiDocument, serializeOpenApiDocument } from "./openapi-document.mjs";

const target = path.resolve("backend/packages/contracts/generated/spotter-v1.openapi.json");
const expected = await serializeOpenApiDocument(await buildOpenApiDocument());
const actual = await readFile(target, "utf8");
if (actual !== expected) {
  throw new Error(
    "Generated OpenAPI inventory is stale. Run `pnpm generate:openapi` and commit the result.",
  );
}

const parsed = JSON.parse(actual);
const operations = Object.values(parsed.paths).flatMap((item) => Object.keys(item));
if (operations.length !== 30) {
  throw new Error(`OpenAPI inventory expected 30 operations but found ${operations.length}.`);
}
console.log(`Generated OpenAPI inventory is reproducible (${operations.length} operations).`);
