import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseServerEnvironment, type ServerEnvironment } from "@spotter/config";
import { z } from "zod";
import pino, { type Logger } from "pino";

import { demoSeedDataset } from "../../../fixtures/demo/index";
import { RunAccountabilityForClient } from "../application/accountability";
import {
  ApproveAdjustment,
  GenerateAdjustment,
  RejectAdjustment,
} from "../application/adjustments";
import {
  GetAccountabilityState,
  GetClientDetail,
  GetClientToday,
  GetContextTrace,
  GetProgrammeReview,
  GetScorecard,
  GetSession,
  ListAdjustments,
  ListClientMessages,
  ListDemoClients,
  ListProgrammes,
  ListSessions,
} from "../application/queries";
import {
  ApproveProgramme,
  EditProgrammeProposal,
  GenerateProgramme,
  OverrideBlockedProgramme,
  RejectProgramme,
} from "../application/programmes";
import { CompleteSession, CreateCheckIn, LogSessionWork } from "../application/sessions";
import {
  DrizzleAccountabilityRepository,
  DrizzleAdjustmentRepository,
  DrizzleAdjustmentTriggerRepository,
  DrizzleApplicationIdempotencyRepository,
  DrizzleCheckInRepository,
  DrizzleClientReadRepository,
  DrizzleJobRepository,
  DrizzleProgrammeApplicationRepository,
  DrizzleScorecardRepository,
  DrizzleSessionRepository,
  DrizzleTraceRepository,
  BufferedAgentAuditRepository,
} from "../infrastructure/database/repositories/application-repositories";
import {
  PgliteDatabaseAdapter,
  PostgresDatabaseAdapter,
  migratePgliteDatabase,
  migratePostgresDatabase,
  seedDemoDatabase,
  type DatabaseAdapter,
} from "../infrastructure/database/index";
import { RunDailyAccountabilityJob } from "../jobs/daily-accountability";
import { RunWeeklyPlanJob } from "../jobs/weekly-plan";
import {
  ProductionBackendFacade,
  type BackendFacade,
  type BackendUseCases,
} from "./backend-facade";
import {
  ApplicationModelGateway,
  DatabaseContextAssembler,
  DeterministicEvaluationAdapter,
  DeterministicRedFlagAdapter,
  Sha256Fingerprint,
} from "./runtime-adapters";

const recordingFileSchema = z
  .object({ recordings: z.array(z.unknown()), schemaVersion: z.literal(1) })
  .strict();

export interface BackendRuntime {
  readonly adapter: DatabaseAdapter;
  readonly facade: BackendFacade;
  readonly environment: ServerEnvironment;
}

export interface CreateBackendOptions {
  readonly adapter?: DatabaseAdapter;
  readonly environment?: ServerEnvironment;
  readonly logger?: Logger;
  readonly migrationsFolder?: string;
  readonly recordings?: readonly unknown[];
  readonly seed?: boolean;
}

function defaultLogger(environment: ServerEnvironment): Logger {
  return pino({
    level: environment.LOG_LEVEL,
    redact: {
      censor: "[REDACTED]",
      paths: [
        "authorization",
        "cronSecret",
        "request.headers.authorization",
        "request.headers.cookie",
        "checkInText",
        "notes",
        "prompt",
      ],
    },
  });
}

async function recordingsFromDisk(): Promise<readonly unknown[]> {
  const location = fileURLToPath(
    new URL("../../../fixtures/recordings/recordings.json", import.meta.url),
  );
  const parsed = recordingFileSchema.parse(JSON.parse(await readFile(location, "utf8")));
  return parsed.recordings;
}

async function createAdapter(
  environment: ServerEnvironment,
  migrationsFolder: string,
): Promise<DatabaseAdapter> {
  if (environment.DATABASE_MODE === "pglite") {
    const adapter = await PgliteDatabaseAdapter.create(environment.PGLITE_DATA_DIR);
    await migratePgliteDatabase(adapter, migrationsFolder);
    return adapter;
  }
  return PostgresDatabaseAdapter.connect(environment.DATABASE_URL);
}

export async function createBackend(options: CreateBackendOptions = {}): Promise<BackendRuntime> {
  const environment = options.environment ?? parseServerEnvironment(process.env);
  const logger = options.logger ?? defaultLogger(environment);
  const migrationsFolder = options.migrationsFolder ?? environment.MIGRATIONS_DIR;
  const adapter = options.adapter ?? (await createAdapter(environment, migrationsFolder));
  if (options.adapter !== undefined) {
    if (adapter instanceof PgliteDatabaseAdapter) {
      await migratePgliteDatabase(adapter, migrationsFolder);
    } else if (adapter instanceof PostgresDatabaseAdapter) {
      await migratePostgresDatabase(adapter, migrationsFolder);
    }
  }
  const shouldSeed = options.seed ?? environment.DATABASE_MODE === "pglite";
  if (shouldSeed) await seedDemoDatabase(adapter.database, demoSeedDataset);

  const clientRepository = new DrizzleClientReadRepository(adapter.database);
  const activeNonSynthetic = await adapter.database.query.clients.findFirst({
    where: (client, operators) =>
      operators.and(
        operators.eq(client.status, "active"),
        operators.eq(client.dataClassification, "non_synthetic"),
      ),
  });
  if (activeNonSynthetic !== undefined) {
    await adapter.close();
    throw new Error("Synthetic-only startup refused active non-synthetic data.");
  }
  const coach = await adapter.database.query.coaches.findFirst({
    where: (row, operators) => operators.eq(row.handle, "coach_demo"),
  });
  if (coach === undefined) {
    await adapter.close();
    throw new Error("The seeded demo coach is unavailable.");
  }

  const audit = new BufferedAgentAuditRepository(adapter.database);
  const traces = new DrizzleTraceRepository(adapter.database);
  const programmes = new DrizzleProgrammeApplicationRepository(adapter, audit);
  const sessions = new DrizzleSessionRepository(adapter);
  const checkIns = new DrizzleCheckInRepository(adapter);
  const triggers = new DrizzleAdjustmentTriggerRepository(adapter.database);
  const adjustments = new DrizzleAdjustmentRepository(adapter, audit);
  const accountability = new DrizzleAccountabilityRepository(adapter, audit);
  const idempotency = new DrizzleApplicationIdempotencyRepository(adapter.database);
  const fingerprint = new Sha256Fingerprint();
  const assembler = new DatabaseContextAssembler(adapter.database);
  const gateway = new ApplicationModelGateway({
    mode: environment.AI_MODE,
    recordings: options.recordings ?? (await recordingsFromDisk()),
  });
  const evaluation = new DeterministicEvaluationAdapter();
  const redFlags = new DeterministicRedFlagAdapter();
  const scorecard = new DrizzleScorecardRepository(adapter.database);
  const jobs = new DrizzleJobRepository(adapter.database);

  const generationDependencies = {
    assembler,
    audit,
    evaluation,
    fingerprint,
    gateway,
    idempotency,
    programmes,
    traces,
  };
  const adjustmentDependencies = {
    adjustments,
    assembler,
    audit,
    evaluation,
    fingerprint,
    gateway,
    idempotency,
    traces,
  };
  const accountabilityDependencies = {
    accountability,
    assembler,
    audit,
    evaluation,
    fingerprint,
    gateway,
    idempotency,
    traces,
  };
  const generateProgramme = new GenerateProgramme(generationDependencies);
  const runAccountability = new RunAccountabilityForClient(accountabilityDependencies);
  const useCases: BackendUseCases = {
    approveAdjustment: new ApproveAdjustment(adjustments, { fingerprint, idempotency }),
    approveProgramme: new ApproveProgramme(programmes, { fingerprint, idempotency }),
    completeSession: new CompleteSession(sessions, triggers, { fingerprint, idempotency }),
    createCheckIn: new CreateCheckIn(checkIns, redFlags, triggers, { fingerprint, idempotency }),
    dailyAccountabilityJob: new RunDailyAccountabilityJob(
      clientRepository,
      runAccountability,
      jobs,
    ),
    editProgramme: new EditProgrammeProposal({ evaluation, programmes, traces }),
    generateAdjustment: new GenerateAdjustment(adjustmentDependencies),
    generateProgramme,
    getAccountability: new GetAccountabilityState(accountability),
    getClientDetail: new GetClientDetail(clientRepository),
    getClientToday: new GetClientToday(clientRepository),
    getProgrammeReview: new GetProgrammeReview(programmes),
    getScorecard: new GetScorecard(scorecard),
    getSession: new GetSession(sessions),
    getTrace: new GetContextTrace(traces),
    listAdjustments: new ListAdjustments(adjustments),
    listClientMessages: new ListClientMessages(clientRepository),
    listClients: new ListDemoClients(clientRepository),
    listProgrammes: new ListProgrammes(programmes),
    listSessions: new ListSessions(sessions),
    logSession: new LogSessionWork(sessions, { fingerprint, idempotency }),
    overrideProgramme: new OverrideBlockedProgramme(programmes, { fingerprint, idempotency }),
    rejectAdjustment: new RejectAdjustment(adjustments, { fingerprint, idempotency }),
    rejectProgramme: new RejectProgramme(programmes, { fingerprint, idempotency }),
    runAccountability,
    weeklyPlanJob: new RunWeeklyPlanJob(clientRepository, generateProgramme, jobs),
  };
  const facade = new ProductionBackendFacade(useCases, coach.id, logger);
  logger.info(
    {
      aiMode: environment.AI_MODE,
      databaseMode: environment.DATABASE_MODE,
      event: "backend_ready",
      syntheticOnly: environment.DATA_POLICY === "synthetic_only",
    },
    "backend composition ready",
  );
  return { adapter, environment, facade };
}
