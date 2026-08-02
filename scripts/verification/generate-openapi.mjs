import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildOpenApiDocument, serializeOpenApiDocument } from "./openapi-document.mjs";

const target = path.resolve("packages/contracts/generated/spotter-v1.openapi.json");
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, await serializeOpenApiDocument(await buildOpenApiDocument()), "utf8");
console.log(`Generated ${path.relative(process.cwd(), target)}`);
