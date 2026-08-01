import { existsSync } from "node:fs";

const knownGeneratedRoots = ["packages/contracts/src/generated", "frontend/src/generated"];
const present = knownGeneratedRoots.filter(existsSync);

if (present.length > 0) {
  throw new Error(
    `Generated roots now exist (${present.join(", ")}); add a reproducibility command before release.`,
  );
}

console.log(
  "No code generator is configured; reproducibility gate is deliberately not applicable.",
);
