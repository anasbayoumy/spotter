import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const roots = ["backend", "client-frontend", "frontend", "tests"];
const findings = [];

async function walk(relative) {
  try {
    const entries = await readdir(relative, { withFileTypes: true });
    const results = await Promise.all(
      entries
        .filter(
          (entry) =>
            ![
              ".next",
              ".expo",
              "build",
              "coverage",
              "dist",
              "node_modules",
              "playwright-report",
              "reports",
              "test-results",
            ].includes(entry.name),
        )
        .map((entry) => {
          const child = path.join(relative, entry.name);
          return entry.isDirectory() ? walk(child) : Promise.resolve([child]);
        }),
    );
    return results.flat();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

const files = (await Promise.all(roots.map(walk)))
  .flat()
  .filter((file) => /\.(?:js|jsx|mjs|ts|tsx)$/u.test(file));

const patterns = [
  { name: "focused test", pattern: /\b(?:describe|it|test)\.only\s*\(/u },
  { name: "TypeScript suppression", pattern: /@ts-(?:ignore|nocheck)/u },
  { name: "blanket ESLint suppression", pattern: /eslint-disable(?:\s|$)/u },
  {
    name: "placeholder implementation",
    pattern: /throw new Error\(["'`](?:not implemented|todo)/iu,
  },
  { name: "empty catch", pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/u },
];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const lines = source.split(/\r?\n/u);
  lines.forEach((line, index) => {
    for (const entry of patterns) {
      if (entry.pattern.test(line)) findings.push(`${file}:${index + 1}: ${entry.name}`);
    }
    if (/\b(?:describe|it|test)\.(?:skip|todo)\s*\(/u.test(line)) {
      const previous = lines[index - 1] ?? "";
      if (!/spotter-allow-skip:\s*ENV-MOB-001/u.test(`${previous}\n${line}`)) {
        findings.push(`${file}:${index + 1}: unexplained skipped/todo test`);
      }
    }
  });
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Forbidden-pattern check passed for ${files.length} files.`);
}
