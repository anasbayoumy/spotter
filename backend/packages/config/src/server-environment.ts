import { z } from "zod";

const trueString = z.enum(["true", "false"]).transform((value) => value === "true");
const optionalEnvironmentText = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional(),
);
const qaRunIdSchema = z
  .string()
  .regex(/^\d{14}-[a-z0-9][a-z0-9-]{0,30}-[a-f0-9]{6}$/u, "Invalid ephemeral QA run identity");
const qaProjectSchema = z
  .string()
  .regex(/^spotter-qa-[a-z0-9][a-z0-9-]{0,61}$/u, "Invalid ephemeral QA project identity");
const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).max(200).optional(),
);
const providerBaseUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z
    .url()
    .max(500)
    .superRefine((value, context) => {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "api.openai.com" ||
        url.port.length > 0 ||
        url.username.length > 0 ||
        url.password.length > 0 ||
        url.search.length > 0 ||
        url.hash.length > 0 ||
        !["", "/", "/v1", "/v1/"].includes(url.pathname)
      ) {
        context.addIssue({
          code: "custom",
          message: "Model provider URL is outside the fixed HTTPS allowlist",
        });
      }
    })
    .optional(),
);

export const serverEnvironmentSchema = z
  .looseObject({
    AI_MODE: z.enum(["recorded", "live"]).default("recorded"),
    AI_API_KEY: z.preprocess(
      (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
      z.string().min(16).max(512).optional(),
    ),
    AI_BASE_URL: providerBaseUrl,
    AI_EMBEDDING_MODEL: optionalText,
    AI_GENERATOR_MODEL: optionalText,
    AI_JUDGE_MODEL: optionalText,
    AI_PROVIDER: z.preprocess(
      (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
      z.enum(["openai"]).optional(),
    ),
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
    SPOTTER_QA_PROJECT: optionalEnvironmentText.pipe(qaProjectSchema.optional()),
    SPOTTER_QA_RUN_ID: optionalEnvironmentText.pipe(qaRunIdSchema.optional()),
    SPOTTER_RATE_LIMIT_PROFILE: z.enum(["default", "load_test"]).default("default"),
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
    if (environment.AI_MODE === "live") {
      for (const key of [
        "AI_API_KEY",
        "AI_BASE_URL",
        "AI_GENERATOR_MODEL",
        "AI_JUDGE_MODEL",
        "AI_PROVIDER",
      ] as const) {
        if (environment[key] === undefined) {
          context.addIssue({
            code: "custom",
            message: `${key} is required in live model mode`,
            path: [key],
          });
        }
      }
      if (
        environment.AI_GENERATOR_MODEL !== undefined &&
        environment.AI_GENERATOR_MODEL === environment.AI_JUDGE_MODEL
      ) {
        context.addIssue({
          code: "custom",
          message: "Generator and judge model identifiers must differ",
          path: ["AI_JUDGE_MODEL"],
        });
      }
    }
    const loadProfileEnabled = environment.SPOTTER_RATE_LIMIT_PROFILE === "load_test";
    if (!loadProfileEnabled) {
      if (
        environment.SPOTTER_QA_PROJECT !== undefined ||
        environment.SPOTTER_QA_RUN_ID !== undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "Ephemeral QA identity is accepted only with the load-test rate-limit profile",
          path: ["SPOTTER_RATE_LIMIT_PROFILE"],
        });
      }
      return;
    }
    if (
      environment.APP_ENV !== "production" ||
      environment.AI_MODE !== "recorded" ||
      !environment.ALLOW_NO_AUTH_SYNTHETIC_DEMO ||
      environment.DATA_POLICY !== "synthetic_only" ||
      environment.SPOTTER_QA_RUN_ID === undefined ||
      environment.SPOTTER_QA_PROJECT !== `spotter-qa-${environment.SPOTTER_QA_RUN_ID}`
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Load-test limits require recorded, synthetic-only no-auth production and an exact ephemeral QA project/run binding",
        path: ["SPOTTER_RATE_LIMIT_PROFILE"],
      });
      return;
    }
    const timestamp = environment.SPOTTER_QA_RUN_ID.slice(0, 14);
    const startedAt = Date.UTC(
      Number(timestamp.slice(0, 4)),
      Number(timestamp.slice(4, 6)) - 1,
      Number(timestamp.slice(6, 8)),
      Number(timestamp.slice(8, 10)),
      Number(timestamp.slice(10, 12)),
      Number(timestamp.slice(12, 14)),
    );
    const ageMilliseconds = Date.now() - startedAt;
    if (
      !Number.isFinite(startedAt) ||
      new Date(startedAt)
        .toISOString()
        .replace(/[-:.TZ]/gu, "")
        .slice(0, 14) !== timestamp ||
      ageMilliseconds < -5 * 60 * 1_000 ||
      ageMilliseconds > 24 * 60 * 60 * 1_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Load-test QA identity is stale or future-dated",
        path: ["SPOTTER_QA_RUN_ID"],
      });
    }
  });

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(source);
}
