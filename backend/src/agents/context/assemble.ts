import { contextSectionSchema } from "@spotter/contracts";

import { AgentRuntimeError } from "../errors.js";
import { filterCurrentRecords, rankEligibleNotes } from "./filter-rank.js";
import { renderContext } from "./render.js";
import { stableStringify } from "./stable-json.js";
import { Utf8TokenEstimator, type TokenEstimator } from "./token-estimator.js";
import {
  contextAssemblyRequestSchema,
  type ContextAssemblyRequest,
  type ContextAssemblyResult,
  type ContextEviction,
  type ContextRecord,
  type ContextSection,
  type ContextTraceAttempt,
} from "./types.js";

const sectionDefinitions = [
  ["hardConstraints", "hard_constraints", "ctx-01-hard-constraints", true],
  [
    "goalProfileEquipmentSchedule",
    "goal_profile_equipment_schedule",
    "ctx-02-goal-profile-equipment-schedule",
    false,
  ],
  ["currentProgramme", "current_programme", "ctx-03-current-programme", false],
  [
    "recentSessionsAdherence",
    "recent_sessions_adherence",
    "ctx-04-recent-sessions-adherence",
    false,
  ],
  ["checkInsMetrics", "check_ins_metrics", "ctx-05-check-ins-metrics", false],
  ["notes", "valid_notes", "ctx-06-valid-notes", false],
  [
    "softConstraintsOlderSummaries",
    "soft_constraints_older_summaries",
    "ctx-07-soft-constraints-older-summaries",
    false,
  ],
] as const;

function renderRecords(records: readonly ContextRecord[]): string {
  return records
    .map(
      (record) =>
        `[record=${record.recordId}; source=${record.source}; version=${record.recordVersion === null ? "none" : String(record.recordVersion)}]\n${stableStringify(record.content)}`,
    )
    .join("\n");
}

function makeSection(
  id: string,
  kind: ContextSection["kind"],
  pinned: boolean,
  records: readonly ContextRecord[],
  estimator: TokenEstimator,
): ContextSection {
  const rendered = renderRecords(records);
  return contextSectionSchema.parse({
    id,
    kind,
    pinned,
    tokenEstimate: estimator.estimate(rendered),
    records: records.map((record) => ({
      recordId: record.recordId,
      recordVersion: record.recordVersion,
      source: record.source,
    })),
    rendered,
  });
}

export class DeterministicContextAssembler {
  public constructor(private readonly estimator: TokenEstimator = new Utf8TokenEstimator()) {}

  public assemble(unvalidated: ContextAssemblyRequest): ContextAssemblyResult {
    const source = contextAssemblyRequestSchema.safeParse(unvalidated);
    if (!source.success) {
      throw new AgentRuntimeError("validation_failed", "Context source input is invalid", false);
    }

    const selectedSections: ContextSection[] = [];
    const evictions: ContextEviction[] = [];

    for (const [property, kind, id, pinned] of sectionDefinitions) {
      const filtered = filterCurrentRecords(source.data[property], source.data.effectiveAt, kind);
      evictions.push(...filtered.evictions);
      const ordered =
        property === "notes"
          ? rankEligibleNotes(filtered.records, source.data.effectiveAt)
          : filtered.records;

      if (pinned) {
        if (ordered.length > 0)
          selectedSections.push(makeSection(id, kind, true, ordered, this.estimator));
        continue;
      }

      const accepted: ContextRecord[] = [];
      for (const record of ordered) {
        const candidate = makeSection(id, kind, false, [...accepted, record], this.estimator);
        const otherSections = selectedSections.filter((section) => section.kind !== kind);
        const candidateSections = [...otherSections, candidate];
        if (this.estimator.estimate(renderContext(candidateSections)) <= source.data.budget) {
          accepted.push(record);
          const priorIndex = selectedSections.findIndex((section) => section.kind === kind);
          if (priorIndex === -1) selectedSections.push(candidate);
          else selectedSections[priorIndex] = candidate;
        } else {
          evictions.push({ recordId: record.recordId, sectionKind: kind, reason: "token_budget" });
        }
      }
    }

    const rendered = renderContext(selectedSections);
    const trace: ContextTraceAttempt = Object.freeze({
      id: source.data.traceId,
      clientId: source.data.clientId,
      turnId: source.data.turnId,
      intent: source.data.intent,
      effectiveAt: source.data.effectiveAt,
      sections: Object.freeze([...selectedSections]),
      rendered,
      tokenCount: this.estimator.estimate(rendered),
      budget: source.data.budget,
      evictions: Object.freeze([...evictions]),
      createdAt: source.data.createdAt,
    });

    return trace.tokenCount > trace.budget
      ? { status: "hard_constraint_overflow", trace }
      : { status: "ready", trace };
  }
}
