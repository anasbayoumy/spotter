import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("artifacts", "verification");
const requested = process.argv[2];
const entries = await readdir(root, { withFileTypes: true });
const candidates = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const selected = requested ?? candidates.at(-1);
if (!selected || !/^[A-Za-z0-9-]+$/u.test(selected))
  throw new Error("No safe evidence run selected.");

const directory = path.join(root, selected);
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.commands))
  throw new Error("Invalid manifest schema.");
if (manifest.commands.some((entry) => entry.exitCode !== 0))
  throw new Error("Evidence contains a failed command.");
for (const command of manifest.commands) {
  const target = path.resolve(directory, command.log);
  if (!target.startsWith(`${directory}${path.sep}`) || !(await stat(target)).isFile()) {
    throw new Error(`Missing or unsafe evidence log: ${command.log}`);
  }
}
if (manifest.verdict !== "candidate" && manifest.verdict !== "pass") {
  throw new Error(`Evidence is not a full release candidate: ${manifest.verdict}`);
}
console.log(`Evidence manifest validated: ${path.relative(process.cwd(), directory)}`);
