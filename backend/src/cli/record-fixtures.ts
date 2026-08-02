import { rename, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  accountabilityModelOutputSchema,
  adjustmentModelOutputSchema,
  programmeModelOutputSchema,
} from "@spotter/contracts";
import { z } from "zod";

import { DEMO_ANCHOR, demoSeedDataset } from "../../resources/demo/index.js";
import { LiveModelGateway } from "../agents/gateway/live-gateway.js";
import { agentOutputDescription } from "../agents/gateway/openai-compatible-gateway.js";
import { OpenAICompatibleTransport } from "../agents/gateway/openai-compatible-transport.js";
import { PromptRegistry } from "../agents/prompts/registry.js";
import { DatabaseContextAssembler } from "../composition/runtime-adapters.js";
import {
  PgliteDatabaseAdapter,
  migratePgliteDatabase,
  seedDemoDatabase,
} from "../infrastructure/database/index.js";

const recordingCasesSchema = z
  .object({
    recordings: z.array(
      z
        .object({
          id: z.string().trim().min(1),
          intent: z.enum(["programme", "adjustment", "accountability"]),
          key: z.string().trim().min(1),
        })
        .loose(),
    ),
    schemaVersion: z.literal(1),
  })
  .loose();

const recordingEnvironmentSchema = z.object({
  SPOTTER_GENERATOR_MODEL: z.string().trim().min(1),
  SPOTTER_MODEL_API_KEY: z.string().trim().min(1),
  SPOTTER_MODEL_BASE_URL: z.url().transform((value) => value.replace(/\/+$/u, "")),
  SPOTTER_MODEL_MODE: z.literal("live"),
});

interface RecordingCaseConfiguration {
  readonly clientId: string;
  readonly contextSuffix?: string;
}

const caseConfiguration: Readonly<Record<string, RecordingCaseConfiguration>> = {
  "accountability.tier-1": {
    clientId: "00000000-0000-4000-8000-000000000106",
    contextSuffix: "Deterministic accountability tier selected by code: 1.",
  },
  "accountability.tier-2": {
    clientId: "00000000-0000-4000-8000-000000000106",
    contextSuffix: "Deterministic accountability tier selected by code: 2.",
  },
  "accountability.tier-3": {
    clientId: "00000000-0000-4000-8000-000000000106",
    contextSuffix: "Deterministic accountability tier selected by code: 3.",
  },
  "adjustment.low-readiness": { clientId: "00000000-0000-4000-8000-000000000107" },
  "programme.baseline": { clientId: "00000000-0000-4000-8000-000000000101" },
};

const schemaByIntent = {
  accountability: accountabilityModelOutputSchema,
  adjustment: adjustmentModelOutputSchema,
  programme: programmeModelOutputSchema,
} as const;

const applicationRoot = path.resolve(import.meta.dirname, "../../..");
const recordingsPath = path.join(applicationRoot, "backend/resources/recordings/recordings.json");
const temporaryPath = `${recordingsPath}.next`;
const environment = recordingEnvironmentSchema.parse(process.env);
const current = recordingCasesSchema.parse(
  JSON.parse(await readFile(recordingsPath, "utf8")) as unknown,
);
const expectedKeys = Object.keys(caseConfiguration).sort();
const actualKeys = current.recordings.map((recording) => recording.key).sort();
if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
  throw new Error("The recording manifest does not match the complete model fixture case list.");
}

const adapter = await PgliteDatabaseAdapter.create("memory://");
try {
  await migratePgliteDatabase(adapter, path.join(applicationRoot, "backend/migrations"));
  await seedDemoDatabase(adapter.database, demoSeedDataset);
  const assembler = new DatabaseContextAssembler(adapter.database);
  const prompts = new PromptRegistry();
  const recordings = [];

  for (const fixture of current.recordings) {
    const configuration = caseConfiguration[fixture.key];
    if (configuration === undefined) {
      throw new Error(`Fixture ${fixture.key} has no recording configuration.`);
    }
    const assembled = await assembler.assemble({
      clientId: configuration.clientId,
      effectiveAt: DEMO_ANCHOR,
      kind: fixture.intent,
      ...(fixture.intent === "programme" ? { targetWeekStart: "2026-08-03" } : {}),
    });
    if (assembled.status !== "ready") {
      throw new Error(`Fixture ${fixture.key} exceeded the hard-constraint context budget.`);
    }
    const prompt = prompts.get(fixture.intent);
    let rawResponse = "";
    const gateway = new LiveModelGateway(
      new OpenAICompatibleTransport({
        apiKey: environment.SPOTTER_MODEL_API_KEY,
        baseUrl: environment.SPOTTER_MODEL_BASE_URL,
        onRawResponse: (raw) => {
          rawResponse = raw;
        },
        outputDescription: agentOutputDescription(fixture.intent),
        outputSchema: schemaByIntent[fixture.intent],
        schemaName: `${fixture.intent} model output`,
      }),
      { modelId: environment.SPOTTER_GENERATOR_MODEL },
    );
    try {
      const response = await gateway.generate({
        context: [assembled.trace.rendered, configuration.contextSuffix ?? ""]
          .filter(Boolean)
          .join("\n\n"),
        intent: fixture.intent,
        promptVersion: prompt.version,
        recordingKey: fixture.key,
        signal: AbortSignal.timeout(300_000),
        system: prompt.system,
        traceId: assembled.trace.id,
      });
      if (rawResponse.length === 0 || response.usage === null) {
        throw new Error(`Fixture ${fixture.key} did not return a recordable response.`);
      }
      recordings.push({
        id: fixture.id,
        intent: fixture.intent,
        key: fixture.key,
        model: environment.SPOTTER_GENERATOR_MODEL,
        output: response.output,
        promptVersion: prompt.version,
        rawResponse,
        recordedAt: new Date().toISOString(),
        schemaVersion: 1,
        usage: response.usage,
      });
      process.stdout.write(`recorded ${fixture.key}\n`);
    } catch (error) {
      throw new Error(
        `Live fixture recording failed for ${fixture.key} at ${environment.SPOTTER_MODEL_BASE_URL}; existing recordings were not replaced.`,
        { cause: error },
      );
    }
  }

  await writeFile(temporaryPath, `${JSON.stringify({ schemaVersion: 1, recordings }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, recordingsPath);
  process.stdout.write(
    `recorded ${String(recordings.length)} real model fixtures to ${recordingsPath}\n`,
  );
} finally {
  await adapter.close();
}
