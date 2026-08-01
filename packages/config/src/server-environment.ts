import { z } from "zod";

const trueString = z.enum(["true", "false"]).transform((value) => value === "true");

export const serverEnvironmentSchema = z
  .looseObject({
    AI_MODE: z.enum(["recorded", "live"]).default("recorded"),
    ALLOW_NO_AUTH_SYNTHETIC_DEMO: trueString.default(false),
    APP_ENV: z.enum(["development", "test", "demo", "production"]).default("development"),
    CRON_SECRET: z.string().min(16).max(512).default("local-demo-cron-only"),
    DATABASE_MODE: z.enum(["postgres", "pglite"]).default("pglite"),
    DATABASE_URL: z
      .url()
      .default("postgresql://spotter_app:spotter_local_only@127.0.0.1:5432/spotter"),
    DATA_POLICY: z.enum(["synthetic_only", "non_synthetic"]).default("synthetic_only"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    MIGRATIONS_DIR: z.string().min(1).default("migrations"),
    PGLITE_DATA_DIR: z.string().min(1).default("memory://"),
  })
  .superRefine((environment, context) => {
    if (environment.APP_ENV === "production") {
      if (
        !environment.ALLOW_NO_AUTH_SYNTHETIC_DEMO ||
        environment.DATA_POLICY !== "synthetic_only"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "No-auth production mode is allowed only for an explicitly enabled synthetic demo",
          path: ["ALLOW_NO_AUTH_SYNTHETIC_DEMO"],
        });
      }
    }
    if (environment.AI_MODE === "live" && environment.APP_ENV === "demo") {
      context.addIssue({
        code: "custom",
        message: "The keyless demo must use recorded AI",
        path: ["AI_MODE"],
      });
    }
  });

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(source);
}
