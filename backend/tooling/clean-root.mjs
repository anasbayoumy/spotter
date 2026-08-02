import { rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const targets = [".turbo", "coverage", "playwright-report", "test-results"];

for (const target of targets) {
  const resolved = path.resolve(root, target);
  if (path.dirname(resolved) !== root) {
    throw new Error(`Refusing to clean unexpected path: ${resolved}`);
  }
  await rm(resolved, { force: true, recursive: true });
}
