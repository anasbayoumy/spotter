import { runOrThrow } from "./lib/command.mjs";

const mode = process.argv[2];
if (mode !== "demo") {
  throw new Error(`Unsupported runtime mode: ${mode ?? "<missing>"}`);
}

await runOrThrow("corepack", ["pnpm", "exec", "turbo", "run", "demo", "--parallel"], {
  env: {
    AI_MODE: "recorded",
    ALLOW_NO_AUTH_SYNTHETIC_DEMO: "true",
    APP_ENV: "demo",
    DATABASE_MODE: "pglite",
    DATA_POLICY: "synthetic_only",
  },
});
