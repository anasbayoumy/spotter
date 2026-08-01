import { createHash, randomUUID } from "node:crypto";

import {
  accountabilityModelOutputSchema,
  adjustmentModelOutputSchema,
  contextTraceSchema,
  gateResultSchema,
  judgeResultSchema,
  programmeModelOutputSchema,
  type AccountabilityModelOutput,
  type AdjustmentModelOutput,
  type ContextTrace,
  type ProgrammeModelOutput,
} from "@spotter/contracts";
import { desc, eq } from "drizzle-orm";

import { DeterministicContextAssembler } from "../agents/context/assemble";
import type { ContextRecord, ContextSourceInput } from "../agents/context/types";
import { AgentRuntimeError } from "../agents/errors";
import type { ModelGateway } from "../agents/gateway/model-gateway";
import { RecordedModelGateway } from "../agents/gateway/recorded-gateway";
import { PromptRegistry } from "../agents/prompts/registry";
import { ApplicationError, type FingerprintPort } from "../application/core";
import type {
  AgentKind,
  ContextAssemblerPort,
  EvaluationPort,
  EvaluatedOutput,
  ModelGatewayPort,
  RedFlagPort,
} from "../application/ports";
import { runRecordedJudges } from "../evals/judges/run-judges";
import { detectRedFlags } from "../evals/safety/red-flags";
import { runDeterministicSafety } from "../evals/safety/run-gates";
import type { SafetyExercise } from "../evals/safety/contracts";
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
  ): Promise<{ readonly trace: ContextTrace }> {
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
    if (assembled.status === "hard_constraint_overflow") {
      throw new ApplicationError(
        "context_hard_constraints_exceed_budget",
        "Active hard constraints exceed the context budget.",
      );
    }
    return {
      trace: contextTraceSchema.parse({
        budget: assembled.trace.budget,
        clientId: assembled.trace.clientId,
        createdAt: assembled.trace.createdAt,
        id: assembled.trace.id,
        intent: assembled.trace.intent,
        rendered: assembled.trace.rendered,
        sections: assembled.trace.sections,
        tokenCount: assembled.trace.tokenCount,
        turnId: assembled.trace.turnId,
      }),
    };
  }
}

interface ApplicationModelGatewayOptions {
  readonly mode: "recorded" | "live";
  readonly recordings: readonly unknown[];
}

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

  public constructor(options: ApplicationModelGatewayOptions) {
    this.#gateway =
      options.mode === "recorded"
        ? new RecordedModelGateway(options.recordings)
        : new UnavailableLiveGateway();
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
      (await this.generate("accountability", `accountability.tier-${String(tier)}`, trace)).output,
    );
  }

  private generate(
    intent: AgentKind,
    recordingKey: string,
    trace: ContextTrace,
  ): ReturnType<ModelGateway["generate"]> {
    const prompt = this.#prompts.get(intent);
    return this.#gateway.generate({
      context: trace.rendered,
      intent,
      promptVersion: prompt.version,
      recordingKey,
      signal: new AbortController().signal,
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

function outputExercises(output: EvaluatedOutput): readonly SafetyExercise[] {
  if (!("payload" in output)) return [];
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

export class DeterministicEvaluationAdapter implements EvaluationPort {
  public runGates(
    kind: AgentKind,
    trace: ContextTrace,
    output: EvaluatedOutput,
  ): Promise<readonly ReturnType<typeof gateResultSchema.parse>[]> {
    const adjustment = "operations" in output ? output.operations : null;
    const evaluation = runDeterministicSafety({
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
      constraints: [],
      exercises: outputExercises(output),
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
      outputText: "body" in output ? output.body : "",
      plannedSessions: "payload" in output ? output.payload.days.length : 0,
      volumeChanges: [],
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
    const results = await runRecordedJudges(kind, {
      citations: citations.map((citation) => citation.sectionId),
      claims: citations.map((citation) => citation.claim),
      fixtureId: trace.id,
      intent: kind,
      sectionIds: trace.sections.map((section) => section.id),
    });
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
