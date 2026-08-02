import path from "node:path";

import { runOrThrow } from "../lib/command.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const scopes = [
  {
    cwd: path.join(repositoryRoot, "backend"),
    filters: ["src", "tests/pglite", "tests/property"],
    config: "vitest.coverage.config.ts",
  },
  {
    cwd: path.join(repositoryRoot, "frontend"),
    filters: ["src", "tests/contract", "tests/resilience", "tests/security"],
    config: "vitest.coverage.config.ts",
  },
  {
    cwd: repositoryRoot,
    filters: ["frontend/tests/contract"],
    config: "vitest.backend-contract-coverage.config.ts",
  },
  {
    cwd: path.join(repositoryRoot, "client-frontend"),
    filters: ["src"],
    config: "vitest.coverage.config.ts",
  },
  {
    cwd: path.join(repositoryRoot, "client-frontend"),
    filters: ["tests/mobile"],
    config: "tests/mobile/vitest.config.ts",
  },
  {
    cwd: repositoryRoot,
    filters: ["backend/packages"],
    config: "vitest.shared-coverage.config.ts",
  },
];

// This verifies production Node ESM/TypeScript resolution and intentionally uses node:test.
// Keep it explicit so Vitest does not collect the file as an empty suite from the broad src scope.
await runOrThrow(
  process.execPath,
  ["--test", "backend/src/infrastructure/database/database-error.runtime.test.mjs"],
  { cwd: repositoryRoot },
);

for (const scope of scopes) {
  await runOrThrow(
    "corepack",
    ["pnpm", "exec", "vitest", "run", ...scope.filters, "--config", scope.config, "--coverage"],
    { cwd: scope.cwd },
  );
}

await runOrThrow(process.execPath, ["backend/tooling/verification/verify-coverage.mjs"], {
  cwd: repositoryRoot,
});
