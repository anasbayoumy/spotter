import { createHash, randomUUID } from "node:crypto";

import {
  accountabilityModelOutputSchema,
  adjustmentModelOutputSchema,
  clientProfileSchema,
  constraintDetailSchema,
  constraintKindSchema,
  contextTraceAttemptSchema,
  contextTraceSchema,
  gateResultSchema,
  isoDateSchema,
  judgeResultSchema,
  programmeModelOutputSchema,
  programmePayloadSchema,
  sessionStatusSchema,
  type AccountabilityModelOutput,
  type AdjustmentModelOutput,
  type ContextTrace,
  type ProgrammeModelOutput,
} from "@spotter/contracts";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { DeterministicContextAssembler } from "../agents/context/assemble";
import type { ContextRecord, ContextSourceInput } from "../agents/context/types";
import { AgentRuntimeError } from "../agents/errors";
import type { ModelGateway } from "../agents/gateway/model-gateway";
import { ModelRunTelemetryStore } from "../agents/gateway/model-run-telemetry";
import { OpenAICompatibleModelGateway } from "../agents/gateway/openai-compatible-gateway";
import { RecordedModelGateway } from "../agents/gateway/recorded-gateway";
import { PromptRegistry } from "../agents/prompts/registry";
import { ApplicationError, type FingerprintPort } from "../application/core";
import type {
  AgentKind,
  AssembledContext,
  ContextAssemblerPort,
  EvaluationPort,
  EvaluatedOutput,
  ModelGatewayPort,
  RedFlagPort,
} from "../application/ports";
import type { Judge } from "../evals/judges/judge";
import { createLiveJudges } from "../evals/judges/live-judges";
import { recordedJudges } from "../evals/judges/recorded-judges";
import { assertIndependentModels, runJudges } from "../evals/judges/run-judges";
import { detectRedFlags } from "../evals/safety/red-flags";
import { runDeterministicSafety } from "../evals/safety/run-gates";
import type { SafetyConstraint, SafetyExercise, SafetyInput } from "../evals/safety/contracts";
import type { DatabaseSession } from "../infrastructure/database/database-types";
import {
  appEvents,
  checkIns,
  clientConstraints,
  clientNotes,
  clients,
  programmes,
  sessions,
} from "../infrastructure/database/schema";

function content(value: unknown): ContextRecord["content"] {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(content);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, content(entry)]));
  }
  throw new ApplicationError("dependency_unavailable", "Context contains unsupported data.");
}

function record(input: {
  readonly id: string;
  readonly source: string;
  readonly value: unknown;
  readonly version?: number | null;
  readonly createdAt?: Date | null;
  readonly validFrom?: Date | null;
  readonly validUntil?: Date | null;
  readonly supersededBy?: string | null;
}): ContextRecord {
  return {
    content: content(input.value),
    createdAt: input.createdAt?.toISOString() ?? null,
    recordId: input.id,
    recordVersion: input.version ?? null,
    similarity: null,
    source: input.source,
    supersededBy: input.supersededBy ?? null,
    validFrom: input.validFrom?.toISOString() ?? null,
    validUntil: input.validUntil?.toISOString() ?? null,
  };
}

export class DatabaseContextAssembler implements ContextAssemblerPort {
  readonly #assembler = new DeterministicContextAssembler();

  public constructor(
    private readonly database: DatabaseSession,
    private readonly budget = 12_000,
  ) {}

  public async assemble(
    input: Parameters<ContextAssemblerPort["assemble"]>[0],
  ): Promise<AssembledContext> {
    const client = await this.database.query.clients.findFirst({
      where: eq(clients.id, input.clientId),
    });
    if (client?.dataClassification !== "synthetic") {
      throw new ApplicationError("client_not_found", "Client does not exist.");
    }
    const [constraints, programmeRows, sessionRows, checkInRows, noteRows, eventRows] =
      await Promise.all([
        this.database
          .select()
          .from(clientConstraints)
          .where(eq(clientConstraints.clientId, input.clientId)),
        this.database
          .select()
          .from(programmes)
          .where(eq(programmes.clientId, input.clientId))
          .orderBy(desc(programmes.createdAt))
          .limit(10),
        this.database
          .select()
          .from(sessions)
          .where(eq(sessions.clientId, input.clientId))
          .orderBy(desc(sessions.scheduledFor))
          .limit(30),
        this.database
          .select()
          .from(checkIns)
          .where(eq(checkIns.clientId, input.clientId))
          .orderBy(desc(checkIns.respondedAt))
          .limit(20),
        this.database
          .select()
          .from(clientNotes)
          .where(eq(clientNotes.clientId, input.clientId))
          .orderBy(desc(clientNotes.createdAt))
          .limit(100),
        this.database
          .select()
          .from(appEvents)
          .where(eq(appEvents.clientId, input.clientId))
          .orderBy(desc(appEvents.occurredAt))
          .limit(20),
      ]);
    const current = programmeRows.filter(
      (programme) => programme.status === "published" && programme.supersededBy === null,
    );
    const source: ContextSourceInput = {
      budget: this.budget,
      checkInsMetrics: [
        ...checkInRows.map((checkIn) =>
          record({
            createdAt: checkIn.createdAt,
            id: checkIn.id,
            source: "check_in",
            value: {
              body: checkIn.body,
              latencyHours: checkIn.latencyHours,
              readiness: checkIn.readiness,
              respondedAt: checkIn.respondedAt.toISOString(),
            },
          }),
        ),
        ...eventRows.map((event) =>
          record({
            createdAt: event.createdAt,
            id: event.id,
            source: "app_event",
            value: { kind: event.kind, occurredAt: event.occurredAt.toISOString() },
          }),
        ),
      ],
      clientId: input.clientId,
      currentProgramme: current.map((programme) =>
        record({
          createdAt: programme.createdAt,
          id: programme.id,
          source: "programme",
          value: programme.payload,
          version: programme.version,
        }),
      ),
      effectiveAt: input.effectiveAt.toISOString(),
      goalProfileEquipmentSchedule: [
        record({
          createdAt: client.createdAt,
          id: client.id,
          source: "client_profile",
          value: {
            goals: client.goals,
            profile: client.profile,
            targetWeekStart: input.targetWeekStart ?? null,
            timezone: client.timezone,
          },
          version: 1,
        }),
      ],
      hardConstraints: constraints
        .filter((constraint) => constraint.severity === "hard")
        .map((constraint) =>
          record({
            createdAt: constraint.createdAt,
            id: constraint.id,
            source: "client_constraint",
            supersededBy: constraint.supersededBy,
            validFrom: constraint.validFrom,
            validUntil: constraint.validUntil,
            value: {
              detail: constraint.detail,
              kind: constraint.kind,
              severity: constraint.severity,
            },
          }),
        ),
      notes: noteRows.map((note) =>
        record({
          createdAt: note.createdAt,
          id: note.id,
          source: "client_note",
          supersededBy: note.supersededBy,
          validFrom: note.validFrom,
          validUntil: note.validUntil,
          value: { body: note.body },
        }),
      ),
      recentSessionsAdherence: sessionRows.map((session) =>
        record({
          createdAt: session.createdAt,
          id: session.id,
          source: "session",
          value: {
            actual: session.actual,
            planned: session.planned,
            rpe: session.rpe,
            scheduledFor: session.scheduledFor,
            status: session.status,
          },
          version: session.version,
        }),
      ),
      softConstraintsOlderSummaries: constraints
        .filter((constraint) => constraint.severity === "soft")
        .map((constraint) =>
          record({
            createdAt: constraint.createdAt,
            id: constraint.id,
            source: "client_constraint",
            supersededBy: constraint.supersededBy,
            validFrom: constraint.validFrom,
            validUntil: constraint.validUntil,
            value: {
              detail: constraint.detail,
              kind: constraint.kind,
              severity: constraint.severity,
            },
          }),
        ),
    };
    const assembled = this.#assembler.assemble({
      ...source,
      createdAt: input.effectiveAt.toISOString(),
      intent: input.kind,
      traceId: randomUUID(),
      turnId: randomUUID(),
    });
    const attempt = contextTraceAttemptSchema.parse({
      budget: assembled.trace.budget,
      clientId: assembled.trace.clientId,
      createdAt: assembled.trace.createdAt,
      id: assembled.trace.id,
      intent: assembled.trace.intent,
      rendered: assembled.trace.rendered,
      sections: assembled.trace.sections,
      tokenCount: assembled.trace.tokenCount,
      turnId: assembled.trace.turnId,
    });
    return assembled.status === "hard_constraint_overflow"
      ? { status: "hard_constraint_overflow", trace: attempt }
      : { status: "ready", trace: contextTraceSchema.parse(attempt) };
  }
}

interface ApplicationModelGatewayOptions {
  readonly mode: "recorded" | "live";
  readonly recordings: readonly unknown[];
  readonly telemetry?: ModelRunTelemetryStore;
  readonly live?: Readonly<{
    apiKey: string;
    baseUrl: string;
    generatorModel: string;
    judgeModel: string;
  }>;
}

const liveModelDeadlineMilliseconds = 120_000;

class UnavailableLiveGateway implements ModelGateway {
  public readonly mode = "live" as const;
  public readonly modelId = "live-provider-unconfigured";

  public generate(): Promise<never> {
    return Promise.reject(
      new AgentRuntimeError(
        "dependency_unavailable",
        "Live mode requires an explicitly configured provider adapter.",
        false,
      ),
    );
  }
}

export class ApplicationModelGateway implements ModelGatewayPort {
  readonly #gateway: ModelGateway;
  readonly #prompts = new PromptRegistry();
  public readonly judges: readonly Judge[];
  public readonly telemetry: ModelRunTelemetryStore;

  public constructor(options: ApplicationModelGatewayOptions) {
    this.telemetry = options.telemetry ?? new ModelRunTelemetryStore();
    if (options.mode === "recorded") {
      this.#gateway = new RecordedModelGateway(options.recordings);
      this.judges = recordedJudges;
    } else if (options.live === undefined) {
      this.#gateway = new UnavailableLiveGateway();
      this.judges = [];
    } else {
      assertIndependentModels(options.live.generatorModel, options.live.judgeModel);
      this.#gateway = new OpenAICompatibleModelGateway({
        apiKey: options.live.apiKey,
        baseUrl: options.live.baseUrl,
        modelId: options.live.generatorModel,
        telemetry: this.telemetry,
      });
      this.judges = createLiveJudges({
        apiKey: options.live.apiKey,
        baseUrl: options.live.baseUrl,
        modelId: options.live.judgeModel,
      });
    }
  }

  public async generateProgramme(trace: ContextTrace): Promise<ProgrammeModelOutput> {
    return programmeModelOutputSchema.parse(
      (await this.generate("programme", "programme.baseline", trace)).output,
    );
  }

  public async generateAdjustment(trace: ContextTrace): Promise<AdjustmentModelOutput> {
    return adjustmentModelOutputSchema.parse(
      (await this.generate("adjustment", "adjustment.low-readiness", trace)).output,
    );
  }

  public async draftAccountability(
    trace: ContextTrace,
    tier: 1 | 2 | 3,
  ): Promise<AccountabilityModelOutput> {
    return accountabilityModelOutputSchema.parse(
      (
        await this.generate(
          "accountability",
          `accountability.tier-${String(tier)}`,
          trace,
          `Deterministic accountability tier selected by code: ${String(tier)}.`,
        )
      ).output,
    );
  }

  private generate(
    intent: AgentKind,
    recordingKey: string,
    trace: ContextTrace,
    contextSuffix?: string,
  ): ReturnType<ModelGateway["generate"]> {
    const prompt = this.#prompts.get(intent);
    this.telemetry.begin(trace.id, { mode: this.#gateway.mode, modelId: this.#gateway.modelId });
    return this.#gateway.generate({
      context:
        contextSuffix === undefined ? trace.rendered : `${trace.rendered}\n\n${contextSuffix}`,
      intent,
      promptVersion: prompt.version,
      recordingKey,
      signal:
        this.#gateway.mode === "live"
          ? AbortSignal.timeout(liveModelDeadlineMilliseconds)
          : new AbortController().signal,
      system: prompt.system,
      traceId: trace.id,
    });
  }
}

function outputCitations(
  output: EvaluatedOutput,
): readonly { readonly sectionId: string; readonly claim: string }[] {
  return output.citations.map((citation) => ({
    claim: citation.claim,
    sectionId: citation.sectionId,
  }));
}

interface SelectedTraceValue {
  readonly id: string;
  readonly value: unknown;
  readonly valid: boolean;
}

const traceRecordHeader = /^\[record=([^;]+); source=([^;]+); version=([^\]]+)\]$/u;
const hardConstraintContentSchema = z
  .object({
    detail: constraintDetailSchema,
    kind: constraintKindSchema,
    severity: z.literal("hard"),
  })
  .strict();
const profileContentSchema = z
  .object({ profile: clientProfileSchema, timezone: z.string().trim().min(1).max(100) })
  .loose();
const sessionContentSchema = z
  .object({ scheduledFor: isoDateSchema, status: sessionStatusSchema })
  .loose();

function selectedTraceValues(
  trace: ContextTrace,
  kind: ContextTrace["sections"][number]["kind"],
): readonly SelectedTraceValue[] {
  const section = trace.sections.find((candidate) => candidate.kind === kind);
  if (section === undefined) return [];
  const lines = section.rendered.split("\n");
  const values: SelectedTraceValue[] = [];
  let lineIndex = 0;
  for (const record of section.records) {
    const header = lines[lineIndex];
    const serialized = lines[lineIndex + 1];
    lineIndex += 2;
    const match = header === undefined ? null : traceRecordHeader.exec(header);
    const expectedVersion = record.recordVersion === null ? "none" : String(record.recordVersion);
    if (
      match?.[1] !== record.recordId ||
      match[2] !== record.source ||
      match[3] !== expectedVersion ||
      serialized === undefined
    ) {
      values.push({ id: record.recordId, valid: false, value: null });
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(serialized);
      values.push({ id: record.recordId, valid: true, value: parsed });
    } catch {
      values.push({ id: record.recordId, valid: false, value: null });
    }
  }
  return values;
}

function constraintsFromTrace(trace: ContextTrace): readonly SafetyConstraint[] {
  return selectedTraceValues(trace, "hard_constraints").map((record) => {
    const parsed = record.valid ? hardConstraintContentSchema.safeParse(record.value) : null;
    if (parsed?.success) {
      return {
        forbids: parsed.data.detail.forbids,
        id: record.id,
        kind: parsed.data.kind,
        severity: "hard" as const,
        supersededBy: null,
        validFrom: new Date(0),
        validUntil: null,
      };
    }
    return {
      forbids: [`unparseable_constraint_${record.id}`],
      id: record.id,
      kind: "medical" as const,
      severity: "hard" as const,
      supersededBy: null,
      validFrom: new Date(0),
      validUntil: null,
    };
  });
}

function profileFromTrace(trace: ContextTrace): z.infer<typeof profileContentSchema> | null {
  for (const record of selectedTraceValues(trace, "goal_profile_equipment_schedule")) {
    if (!record.valid) continue;
    const parsed = profileContentSchema.safeParse(record.value);
    if (parsed.success) return parsed.data;
  }
  return null;
}

function currentPayloadFromTrace(
  trace: ContextTrace,
): z.infer<typeof programmePayloadSchema> | null {
  for (const record of selectedTraceValues(trace, "current_programme")) {
    if (!record.valid) continue;
    const parsed = programmePayloadSchema.safeParse(record.value);
    if (parsed.success) return parsed.data;
  }
  return null;
}

function localDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function shiftIsoDate(value: string, days: number): string {
  const shifted = new Date(`${value}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function adherenceFromTrace(trace: ContextTrace, timezone: string): number | null {
  const end = localDate(new Date(trace.createdAt), timezone);
  const start = shiftIsoDate(end, -13);
  const due = selectedTraceValues(trace, "recent_sessions_adherence").flatMap((record) => {
    if (!record.valid) return [];
    const parsed = sessionContentSchema.safeParse(record.value);
    return parsed.success && parsed.data.scheduledFor >= start && parsed.data.scheduledFor <= end
      ? [parsed.data]
      : [];
  });
  if (due.length === 0) return null;
  return due.filter((session) => session.status === "completed").length / due.length;
}

function setsByMuscleGroup(
  payload: z.infer<typeof programmePayloadSchema>,
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const day of payload.days) {
    for (const exercise of day.exercises) {
      for (const muscleGroup of new Set(exercise.muscleGroups)) {
        result.set(muscleGroup, (result.get(muscleGroup) ?? 0) + exercise.sets);
      }
    }
  }
  return result;
}

function volumeChanges(trace: ContextTrace, output: EvaluatedOutput): SafetyInput["volumeChanges"] {
  if (!("payload" in output)) return [];
  const current = currentPayloadFromTrace(trace);
  if (current === null) return [];
  const previous = setsByMuscleGroup(current);
  const proposed = setsByMuscleGroup(output.payload);
  return [...new Set([...previous.keys(), ...proposed.keys()])]
    .sort((left, right) => left.localeCompare(right))
    .map((muscleGroup) => ({
      muscleGroup,
      previousSets: previous.get(muscleGroup) ?? 0,
      proposedSets: proposed.get(muscleGroup) ?? 0,
    }));
}

function outputExercises(trace: ContextTrace, output: EvaluatedOutput): readonly SafetyExercise[] {
  if ("payload" in output) {
    return output.payload.days.flatMap((day) =>
      day.exercises.map((exercise) => ({
        family: exercise.family,
        id: exercise.id,
        muscleGroups: exercise.muscleGroups,
        name: exercise.name,
        rpe: exercise.rpe,
        sets: exercise.sets,
      })),
    );
  }
  if (!("operations" in output)) return [];
  const current = currentPayloadFromTrace(trace);
  const byId = new Map(
    current?.days.flatMap((day) => day.exercises).map((exercise) => [exercise.id, exercise]),
  );
  return output.operations.flatMap((operation): readonly SafetyExercise[] => {
    if (operation.type === "swap_exercise") {
      return [
        {
          family: operation.replacementFamily,
          id: operation.exerciseId,
          muscleGroups: byId.get(operation.exerciseId)?.muscleGroups ?? [],
          name: operation.replacementName,
          rpe: byId.get(operation.exerciseId)?.rpe ?? 1,
          sets: byId.get(operation.exerciseId)?.sets ?? 1,
        },
      ];
    }
    const exercise = byId.get(operation.exerciseId);
    return exercise === undefined
      ? []
      : [
          {
            family: exercise.family,
            id: exercise.id,
            muscleGroups: exercise.muscleGroups,
            name: exercise.name,
            rpe: exercise.rpe,
            sets:
              operation.type === "reduce_volume"
                ? Math.max(1, exercise.sets - operation.setsToRemove)
                : exercise.sets,
          },
        ];
  });
}

function outputText(output: EvaluatedOutput): string {
  if ("body" in output) return output.body;
  if ("payload" in output) {
    return [
      output.payload.summary,
      ...output.payload.days.flatMap((day) => [
        day.focus,
        ...day.exercises.flatMap((exercise) => [exercise.name, exercise.notes ?? ""]),
      ]),
    ].join("\n");
  }
  return output.operations
    .flatMap((operation) => [
      operation.rationale,
      ...(operation.type === "swap_exercise" ? [operation.replacementName] : []),
    ])
    .join("\n");
}

export class DeterministicEvaluationAdapter implements EvaluationPort {
  public constructor(private readonly judges: readonly Judge[] = recordedJudges) {}

  public runGates(
    kind: AgentKind,
    trace: ContextTrace,
    output: EvaluatedOutput,
  ): Promise<readonly ReturnType<typeof gateResultSchema.parse>[]> {
    const adjustment = "operations" in output ? output.operations : null;
    const profile = profileFromTrace(trace);
    const evaluation = runDeterministicSafety({
      adherence14d: adherenceFromTrace(trace, profile?.timezone ?? "UTC"),
      adjustment:
        adjustment === null
          ? null
          : {
              autoApply: false,
              operations: adjustment.map((operation) => ({
                ...(operation.type === "reduce_load"
                  ? { direction: "decrease" as const, percent: operation.percent }
                  : {}),
                ...(operation.type === "reduce_volume"
                  ? { direction: "decrease" as const, setsToRemove: operation.setsToRemove }
                  : {}),
                ...(operation.type === "swap_exercise"
                  ? {
                      equivalenceId: operation.equivalenceId,
                      replacementFamily: operation.replacementFamily,
                    }
                  : {}),
                type: operation.type,
              })),
            },
      asOf: new Date(trace.createdAt),
      checkInText: "body" in output ? output.body : "",
      constraints: constraintsFromTrace(trace),
      exercises: outputExercises(trace, output),
      intent: kind,
      nudge:
        "tier" in output
          ? {
              attemptedAt: new Date(trace.createdAt),
              automated: output.tier === 1,
              concurrentAttempts: 1,
              lastAutomatedSentAt: null,
              owner: output.tier >= 3 ? "coach" : "automation",
              tier: output.tier,
            }
          : null,
      outputText: outputText(output),
      allowedSessions: profile?.profile.sessionsPerWeek ?? null,
      plannedSessions: "payload" in output ? output.payload.days.length : 0,
      volumeChanges: volumeChanges(trace, output),
    });
    return Promise.resolve(
      evaluation.gates.map((gate) =>
        gateResultSchema.parse({
          id: randomUUID(),
          name: gate.name,
          passed: gate.passed,
          rationale: gate.rationale,
        }),
      ),
    );
  }

  public async runJudges(
    kind: AgentKind,
    trace: ContextTrace,
    output: EvaluatedOutput,
  ): Promise<readonly ReturnType<typeof judgeResultSchema.parse>[]> {
    const citations = outputCitations(output);
    const results = await runJudges(
      kind,
      {
        agentOutput: output,
        citations: citations.map((citation) => citation.sectionId),
        clientFixture: {
          clientId: trace.clientId,
          sections: trace.sections,
        },
        claims: citations.map((citation) => citation.claim),
        fixtureId: trace.id,
        intent: kind,
        sectionIds: trace.sections.map((section) => section.id),
      },
      this.judges,
    );
    return results.map((result) =>
      judgeResultSchema.parse({
        id: randomUUID(),
        judgeModel: result.judgeModel,
        name: result.name,
        rationale: result.rationale,
        score: result.score,
      }),
    );
  }
}

export class DeterministicRedFlagAdapter implements RedFlagPort {
  public hasRedFlag(text: string): boolean {
    return detectRedFlags(text).length > 0;
  }

  public escalate(): Promise<void> {
    return Promise.resolve();
  }
}

export class Sha256Fingerprint implements FingerprintPort {
  public fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
}
