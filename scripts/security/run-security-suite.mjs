import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { run } from "../lib/command.mjs";

const excluded = new Set([".git", ".next", ".pnpm-store", ".turbo", "node_modules"]);
const findings = [];

async function walk(relative) {
  const entries = await readdir(relative, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) results.push(...(await walk(child)));
    else if (!/\.(?:gif|ico|jpe?g|lock|pdf|png|webp)$/iu.test(child)) results.push(child);
  }
  return results;
}

for (const file of await walk(".")) {
  const text = await readFile(file, "utf8");
  const checks = [
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u, "private key"],
    [/\bsk-[A-Za-z0-9_-]{20,}\b/u, "provider credential"],
    [/\bAKIA[0-9A-Z]{16}\b/u, "AWS access key"],
  ];
  for (const [pattern, label] of checks) if (pattern.test(text)) findings.push(`${file}: ${label}`);
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}

let code = await run("corepack", ["pnpm", "audit", "--prod", "--audit-level", "high"]);
if (code !== 0) process.exit(code);
code = await run("corepack", ["pnpm", "exec", "turbo", "run", "test:security"]);
process.exitCode = code;
