import { defineConfig, mergeConfig } from "vitest/config";

import unitConfig from "./vitest.unit.config";

export default mergeConfig(
  unitConfig,
  defineConfig({
    root: new URL(".", import.meta.url).pathname,
    test: {
      include: ["src/**/*.test.ts", "tests/pglite/publish-programme.coverage.integration.test.ts"],
    },
  }),
);
