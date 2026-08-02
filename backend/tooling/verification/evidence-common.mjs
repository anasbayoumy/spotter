import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

export function git(args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

export async function sha256File(file) {
  const content = await readFile(file);
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export async function sourceState() {
  const listed = git(["ls-files", "--cached", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const file of listed) {
    const content = await readFile(path.join(repositoryRoot, file));
    hash.update(file);
    hash.update("\0");
    hash.update(String(content.length));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return {
    contentHash: `sha256:${hash.digest("hex")}`,
    dirty: git(["status", "--porcelain=v1", "--untracked-files=all"]).length > 0,
    fileCount: listed.length,
    files: listed,
    git: git(["rev-parse", "HEAD"]),
  };
}

function expandRequirement(match, results) {
  const prefix = match[1];
  const start = Number(match[2]);
  const end = match[3] === undefined ? start : Number(match[3]);
  for (let current = start; current <= end; current += 1) {
    results.add(`${prefix}-${String(current).padStart(3, "0")}`);
  }
}

export async function requirementInventory() {
  const roots = [
    path.join(repositoryRoot, "DOCS", "architecture"),
    path.join(repositoryRoot, "DOCS", "requirements"),
    path.join(repositoryRoot, "DOCS", "testing"),
  ];
  const files = [];
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.join(entry.parentPath, entry.name));
      }
    }
  }
  const requirements = new Set();
  const expression =
    /\b((?:QA|NFR|SEC|SYS|BND|DAT|AI|FLOW|PRV|OPS)(?:-[A-Z]+)*)-(\d{3})(?:\.\.(\d{3}))?\b/gu;
  for (const file of files.sort()) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(expression)) expandRequirement(match, requirements);
  }
  return [...requirements].sort();
}

export async function walkFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) files.push(path.join(entry.parentPath, entry.name));
  }
  return files.sort();
}
