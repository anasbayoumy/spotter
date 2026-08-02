import { parseServerEnvironment } from "@spotter/config";
import { describe, expect, it } from "vitest";

import { createApplicationLogger } from "./create-backend.js";

describe("application logging security", () => {
  it("emits structured redacted logs without host, process, secrets, or forged lines", () => {
    const lines: string[] = [];
    const logger = createApplicationLogger(parseServerEnvironment({ LOG_LEVEL: "info" }), {
      write(message: string): void {
        lines.push(message);
      },
    });
    logger.info(
      {
        AI_API_KEY: "synthetic-secret-api-key",
        CRON_SECRET: "synthetic-secret-cron",
        DATABASE_URL: "postgresql://user:synthetic-secret-password@private-host/db",
        event: "security_log_probe",
        notes: "safe\nforged-log-entry",
        request: {
          headers: {
            authorization: "Bearer synthetic-secret-token",
            cookie: "session=synthetic-secret-cookie",
            "x-cron-secret": "synthetic-secret-header",
          },
        },
        requestId: "security-log-request-001",
      },
      "security log probe",
    );

    expect(lines).toHaveLength(1);
    const serialized = lines[0] ?? "";
    const parsed = JSON.parse(serialized) as Readonly<Record<string, unknown>>;
    expect(parsed).toMatchObject({
      event: "security_log_probe",
      msg: "security log probe",
      requestId: "security-log-request-001",
    });
    expect(parsed).not.toHaveProperty("hostname");
    expect(parsed).not.toHaveProperty("pid");
    expect(serialized).not.toContain("private-host");
    expect(serialized).not.toContain("synthetic-secret");
    expect(serialized).not.toContain("forged-log-entry");
    expect(serialized.split("\n").filter(Boolean)).toHaveLength(1);
  });
});
