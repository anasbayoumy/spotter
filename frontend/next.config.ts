import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  transpilePackages: [
    "@spotter/backend",
    "@spotter/config",
    "@spotter/contracts",
    "@spotter/design-tokens",
  ],
};

export default config;
