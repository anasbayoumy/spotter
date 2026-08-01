import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const applicationRoots = ["backend", "client-frontend", "frontend"];
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const violations = [];

async function filesUnder(relative) {
  const absolute = path.join(root, relative);
  try {
    const entries = await readdir(absolute, { withFileTypes: true });
    const nested = await Promise.all(
      entries
        .filter((entry) => ![".next", ".expo", "dist", "node_modules"].includes(entry.name))
        .map((entry) =>
          entry.isDirectory()
            ? filesUnder(path.join(relative, entry.name))
            : Promise.resolve([path.join(relative, entry.name)]),
        ),
    );
    return nested.flat().filter((file) => sourceExtensions.has(path.extname(file)));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function importsOf(source) {
  const values = [];
  const pattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/gu;
  for (const match of source.matchAll(pattern)) values.push(match[1] ?? match[2] ?? match[3]);
  return values.filter(Boolean);
}

function reject(file, specifier, reason) {
  violations.push(`${file}: ${reason} (${specifier})`);
}

const files = (await Promise.all([...applicationRoots, "packages"].map(filesUnder))).flat();
for (const file of files) {
  const source = await readFile(path.join(root, file), "utf8");
  for (const specifier of importsOf(source)) {
    const importsBackend =
      specifier === "@spotter/backend" || specifier.startsWith("@spotter/backend/");
    if (
      file.startsWith("client-frontend/") &&
      (importsBackend || /^(next|drizzle-|@ai-sdk|ai$)/u.test(specifier))
    ) {
      reject(file, specifier, "client application crossed the server boundary");
    }
    if (
      file.startsWith("frontend/") &&
      importsBackend &&
      !file.includes("/src/app/api/v1/") &&
      !file.includes("/src/app/health/") &&
      !file.includes("/src/server/") &&
      !file.includes("/tests/contract/")
    ) {
      reject(
        file,
        specifier,
        "backend imports are restricted to server composition and API adapters",
      );
    }
    if (
      file.includes("backend/src/domain/") &&
      /^(next|react|expo|drizzle-|postgres|@ai-sdk|ai$)/u.test(specifier)
    ) {
      reject(file, specifier, "domain imports framework or infrastructure code");
    }
    if (
      file.includes("backend/src/agents/") &&
      /(?:repositories|infrastructure|publish|approval)/u.test(specifier)
    ) {
      reject(file, specifier, "agent module imports mutation infrastructure");
    }
    if (
      file.includes("backend/src/evals/safety/") &&
      /(?:model-gateway|live-gateway|@ai-sdk|ai$)/u.test(specifier)
    ) {
      reject(file, specifier, "deterministic safety code imports a model provider");
    }
    if (
      file.startsWith("packages/contracts/") &&
      /^(next|react|expo|drizzle-|postgres|@ai-sdk|ai$|@spotter\/backend)/u.test(specifier)
    ) {
      reject(file, specifier, "contracts package contains runtime/application behavior");
    }
  }
}

const topEntries = await readdir(root, { withFileTypes: true });
if (topEntries.some((entry) => entry.isDirectory() && entry.name === "apps")) {
  violations.push(
    "apps/: non-canonical application container; use the three approved root folders",
  );
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Boundary check passed for ${files.length} source files.`);
}
