import { createHash, timingSafeEqual } from "node:crypto";

import { parseServerEnvironment } from "@spotter/config";

export function assertCronSecret(request: Request): void {
  const environment = parseServerEnvironment(process.env);
  if (environment.APP_ENV === "demo") return;
  if (new URL(request.url).searchParams.has("cronSecret")) {
    throw Object.assign(new Error("Cron invocation is not authorized."), {
      code: "invalid_cron_secret",
    });
  }
  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : request.headers.get("x-cron-secret");
  const expectedBytes = createHash("sha256").update(environment.CRON_SECRET).digest();
  const suppliedBytes = createHash("sha256")
    .update(supplied ?? "")
    .digest();
  const valid = timingSafeEqual(expectedBytes, suppliedBytes);
  if (!valid) {
    throw Object.assign(new Error("Cron invocation is not authorized."), {
      code: "invalid_cron_secret",
    });
  }
}
