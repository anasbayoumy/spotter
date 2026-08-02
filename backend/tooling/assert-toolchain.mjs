const expectedNode = "24.11.1";
const expectedPnpm = "10.20.0";
const nodeVersion = process.versions.node;
const userAgent = process.env.npm_config_user_agent ?? "";

if (nodeVersion !== expectedNode) {
  throw new Error(`Spotter requires Node ${expectedNode}; received ${nodeVersion}.`);
}

if (userAgent) {
  const pnpmMatch = /pnpm\/(\d+\.\d+\.\d+)/u.exec(userAgent);
  if (!pnpmMatch || pnpmMatch[1] !== expectedPnpm) {
    throw new Error(`Spotter requires Corepack pnpm ${expectedPnpm}; received ${userAgent}.`);
  }
}
