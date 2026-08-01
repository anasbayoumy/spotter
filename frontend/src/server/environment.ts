import { timingSafeEqual } from "node:crypto";

import { parseServerEnvironment } from "@spotter/config";

export function assertCronSecret(request: Request): void {
  const environment = parseServerEnvironment(process.env);
  if (environment.APP_ENV === "demo") return;
  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : request.headers.get("x-cron-secret");
  const expectedBytes = Buffer.from(environment.CRON_SECRET);
  const suppliedBytes = Buffer.from(supplied ?? "");
  const valid =
    expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
  if (!valid) {
    throw Object.assign(new Error("Cron invocation is not authorized."), {
      code: "invalid_cron_secret",
    });
  }
}
