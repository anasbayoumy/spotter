import { sql, type HasDefault, type NotNull } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
  type PgTimestampBuilderInitial,
} from "drizzle-orm/pg-core";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = Readonly<Record<string, JsonValue>>;

type CreatedAtColumn = NotNull<HasDefault<PgTimestampBuilderInitial<"created_at">>>;

const createdAt = (): CreatedAtColumn =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull();

export const clientStatusEnum = pgEnum("client_status", ["active", "paused", "churned"]);
export const dataClassificationEnum = pgEnum("data_classification", ["synthetic", "non_synthetic"]);
export const constraintKindEnum = pgEnum("constraint_kind", [
  "injury",
  "allergy",
  "equipment",
  "schedule",
  "medical",
  "preference",
]);
export const constraintSeverityEnum = pgEnum("constraint_severity", ["hard", "soft"]);
export const constraintSourceEnum = pgEnum("constraint_source", [
  "client_reported",
  "coach_entered",
  "inferred",
]);
export const programmeStatusEnum = pgEnum("programme_status", [
  "draft",
  "queued",
  "published",
  "rejected",
  "superseded",
]);
export const reviewBandEnum = pgEnum("review_band", ["blocked", "attention", "clear"]);
export const approvalKindEnum = pgEnum("approval_kind", ["standard", "override"]);
export const adjustmentStatusEnum = pgEnum("adjustment_status", [
  "draft",
  "queued",
  "approved",
  "rejected",
  "applied",
  "superseded",
]);
export const accountabilityOwnerEnum = pgEnum("accountability_owner", [
  "none",
  "automation",
  "coach",
]);
export const messageActorEnum = pgEnum("message_actor", ["automation", "coach"]);
export const messageStatusEnum = pgEnum("message_status", [
  "drafted",
  "sent",
  "suppressed",
  "cancelled",
]);
export const agentNameEnum = pgEnum("agent_name", ["programme", "adjustment", "accountability"]);
export const agentRunStatusEnum = pgEnum("agent_run_status", ["succeeded", "failed"]);
export const evaluationKindEnum = pgEnum("evaluation_kind", ["gate", "judge"]);
export const coachActionEnum = pgEnum("coach_action", [
  "approved",
  "edited",
  "rejected",
  "overrode_block",
  "released_ownership",
]);
export const idempotencyStateEnum = pgEnum("idempotency_state", [
  "in_progress",
  "completed",
  "failed",
]);
export const jobStatusEnum = pgEnum("job_status", ["running", "completed", "failed"]);

export const coaches = pgTable("coaches", {
  id: uuid("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  createdAt: createdAt(),
});

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey(),
    handle: text("handle").notNull(),
    syntheticLabel: text("synthetic_label").notNull(),
    status: clientStatusEnum("status").notNull().default("active"),
    timezone: text("timezone").notNull(),
    dataClassification: dataClassificationEnum("data_classification")
      .notNull()
      .default("non_synthetic"),
    goals: jsonb("goals").$type<JsonObject>().notNull(),
    profile: jsonb("profile").$type<JsonObject>().notNull(),
    coachId: uuid("coach_id")
      .notNull()
      .references(() => coaches.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("clients_handle_uq").on(table.handle),
    index("clients_active_classification_idx").on(table.status, table.dataClassification),
    check("clients_handle_format_ck", sql`${table.handle} ~ '^c_[0-9]{3}$'`),
    check("clients_timezone_nonempty_ck", sql`length(btrim(${table.timezone})) > 0`),
  ],
);

export const clientConstraints = pgTable(
  "client_constraints",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    kind: constraintKindEnum("kind").notNull(),
    severity: constraintSeverityEnum("severity").notNull(),
    detail: jsonb("detail").$type<JsonObject>().notNull(),
    source: constraintSourceEnum("source").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true, mode: "date" }),
    supersededBy: uuid("superseded_by").references((): AnyPgColumn => clientConstraints.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index("client_constraints_active_idx").on(
      table.clientId,
      table.severity,
      table.validFrom,
      table.validUntil,
    ),
    check(
      "client_constraints_valid_window_ck",
      sql`${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom}`,
    ),
    check(
      "client_constraints_inferred_soft_ck",
      sql`NOT (${table.source} = 'inferred' AND ${table.severity} = 'hard')`,
    ),
    check(
      "client_constraints_not_self_superseded_ck",
      sql`${table.supersededBy} IS NULL OR ${table.supersededBy} <> ${table.id}`,
    ),
  ],
);

export const clientNotes = pgTable(
  "client_notes",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true, mode: "date" }),
    supersededBy: uuid("superseded_by").references((): AnyPgColumn => clientNotes.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index("client_notes_current_idx").on(
      table.clientId,
      table.supersededBy,
      table.validFrom,
      table.validUntil,
    ),
    check("client_notes_body_nonempty_ck", sql`length(btrim(${table.body})) > 0`),
    check("client_notes_body_bounded_ck", sql`length(${table.body}) <= 10000`),
    check(
      "client_notes_valid_window_ck",
      sql`${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom}`,
    ),
    check(
      "client_notes_not_self_superseded_ck",
      sql`${table.supersededBy} IS NULL OR ${table.supersededBy} <> ${table.id}`,
    ),
  ],
);

export const contextTraces = pgTable(
  "context_traces",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    turnId: uuid("turn_id").notNull(),
    intent: text("intent").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }).notNull(),
    selected: jsonb("selected").$type<JsonObject>().notNull(),
    rendered: text("rendered").notNull(),
    tokenCount: integer("token_count").notNull(),
    budget: integer("budget").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("context_traces_turn_uq").on(table.turnId),
    index("context_traces_client_created_idx").on(table.clientId, table.createdAt),
    check("context_traces_tokens_ck", sql`${table.tokenCount} >= 0 AND ${table.budget} > 0`),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey(),
    attemptKey: text("attempt_key").notNull(),
    agent: agentNameEnum("agent").notNull(),
    status: agentRunStatusEnum("status").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    traceId: uuid("trace_id")
      .notNull()
      .references(() => contextTraces.id, { onDelete: "restrict" }),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    latencyMs: integer("latency_ms").notNull(),
    output: jsonb("output").$type<JsonObject>(),
    errorCode: text("error_code"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("agent_runs_attempt_uq").on(table.attemptKey),
    index("agent_runs_trace_created_idx").on(table.traceId, table.createdAt),
    check(
      "agent_runs_outcome_ck",
      sql`(${table.status} = 'succeeded' AND ${table.output} IS NOT NULL AND ${table.errorCode} IS NULL)
          OR (${table.status} = 'failed' AND ${table.errorCode} IS NOT NULL)`,
    ),
    check(
      "agent_runs_usage_ck",
      sql`${table.inputTokens} >= 0 AND ${table.outputTokens} >= 0 AND ${table.costUsd} >= 0 AND ${table.latencyMs} >= 0`,
    ),
  ],
);

export const programmes = pgTable(
  "programmes",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    mesocycle: integer("mesocycle").notNull(),
    week: integer("week").notNull(),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    payload: jsonb("payload").$type<JsonObject>().notNull(),
    status: programmeStatusEnum("status").notNull().default("draft"),
    reviewBand: reviewBandEnum("review_band"),
    generatedBy: uuid("generated_by").references(() => agentRuns.id, { onDelete: "restrict" }),
    approvedBy: uuid("approved_by").references(() => coaches.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    approvalKind: approvalKindEnum("approval_kind"),
    validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }),
    supersededBy: uuid("superseded_by").references((): AnyPgColumn => programmes.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("programmes_client_version_uq").on(table.clientId, table.weekStart, table.version),
    uniqueIndex("programmes_current_published_uq")
      .on(table.clientId, table.weekStart)
      .where(sql`${table.status} = 'published' AND ${table.supersededBy} IS NULL`),
    index("programmes_review_queue_idx").on(
      table.status,
      table.reviewBand,
      table.createdAt,
      table.id,
    ),
    index("programmes_client_history_idx").on(table.clientId, table.weekStart, table.version),
    check(
      "programmes_version_ck",
      sql`${table.version} > 0 AND ${table.mesocycle} > 0 AND ${table.week} > 0`,
    ),
    check(
      "programmes_reviewed_lifecycle_ck",
      sql`${table.status} NOT IN ('queued', 'published') OR ${table.reviewBand} IS NOT NULL`,
    ),
    check(
      "programmes_published_approval_ck",
      sql`${table.status} <> 'published' OR (
        ${table.approvedBy} IS NOT NULL AND ${table.approvedAt} IS NOT NULL AND
        ${table.approvalKind} IS NOT NULL AND ${table.validFrom} IS NOT NULL
      )`,
    ),
    check(
      "programmes_blocked_override_ck",
      sql`NOT (${table.status} = 'published' AND ${table.reviewBand} = 'blocked') OR ${table.approvalKind} = 'override'`,
    ),
    check(
      "programmes_override_only_blocked_ck",
      sql`${table.approvalKind} <> 'override' OR (${table.status} = 'published' AND ${table.reviewBand} = 'blocked')`,
    ),
    check(
      "programmes_not_self_superseded_ck",
      sql`${table.supersededBy} IS NULL OR ${table.supersededBy} <> ${table.id}`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    programmeId: uuid("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "restrict" }),
    sessionKey: text("session_key").notNull(),
    scheduledFor: date("scheduled_for", { mode: "string" }).notNull(),
    planned: jsonb("planned").$type<JsonObject>().notNull(),
    actual: jsonb("actual").$type<JsonObject>(),
    performedAt: timestamp("performed_at", { withTimezone: true, mode: "date" }),
    rpe: real("rpe"),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("sessions_programme_key_uq").on(table.programmeId, table.sessionKey),
    index("sessions_client_scheduled_idx").on(table.clientId, table.scheduledFor, table.id),
    check(
      "sessions_rpe_ck",
      sql`${table.rpe} IS NULL OR (${table.rpe} >= 1 AND ${table.rpe} <= 10)`,
    ),
    check("sessions_version_ck", sql`${table.version} > 0`),
    check(
      "sessions_notes_bounded_ck",
      sql`${table.notes} IS NULL OR length(${table.notes}) <= 4000`,
    ),
  ],
);

export const checkIns = pgTable(
  "check_ins",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    readiness: smallint("readiness").notNull(),
    body: text("body"),
    sentiment: real("sentiment"),
    respondedAt: timestamp("responded_at", { withTimezone: true, mode: "date" }).notNull(),
    latencyHours: real("latency_hours"),
    createdAt: createdAt(),
  },
  (table) => [
    index("check_ins_client_created_idx").on(table.clientId, table.createdAt),
    check("check_ins_readiness_ck", sql`${table.readiness} BETWEEN 1 AND 5`),
    check("check_ins_body_bounded_ck", sql`${table.body} IS NULL OR length(${table.body}) <= 4000`),
    check(
      "check_ins_sentiment_ck",
      sql`${table.sentiment} IS NULL OR ${table.sentiment} BETWEEN -1 AND 1`,
    ),
    check("check_ins_latency_ck", sql`${table.latencyHours} IS NULL OR ${table.latencyHours} >= 0`),
  ],
);

export const metrics = pgTable(
  "metrics",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    value: real("value").notNull(),
    source: text("source").notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("metrics_client_kind_time_idx").on(table.clientId, table.kind, table.measuredAt),
  ],
);

export const appEvents = pgTable(
  "app_events",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("app_events_client_time_idx").on(table.clientId, table.occurredAt)],
);

export const adjustments = pgTable(
  "adjustments",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    baseProgrammeId: uuid("base_programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "restrict" }),
    sourceEventKey: text("source_event_key").notNull(),
    operations: jsonb("operations").$type<JsonValue[]>().notNull(),
    status: adjustmentStatusEnum("status").notNull().default("draft"),
    reviewBand: reviewBandEnum("review_band"),
    generatedBy: uuid("generated_by").references(() => agentRuns.id, { onDelete: "restrict" }),
    approvedBy: uuid("approved_by").references(() => coaches.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    appliedProgrammeId: uuid("applied_programme_id").references(() => programmes.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("adjustments_source_event_uq").on(table.clientId, table.sourceEventKey),
    index("adjustments_client_status_idx").on(table.clientId, table.status, table.createdAt),
    check(
      "adjustments_operations_nonempty_ck",
      sql`jsonb_typeof(${table.operations}) = 'array' AND jsonb_array_length(${table.operations}) > 0`,
    ),
    check(
      "adjustments_approval_ck",
      sql`${table.status} NOT IN ('approved', 'applied') OR (${table.approvedBy} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`,
    ),
    check(
      "adjustments_applied_programme_ck",
      sql`${table.status} <> 'applied' OR ${table.appliedProgrammeId} IS NOT NULL`,
    ),
  ],
);

export const engagementScores = pgTable(
  "engagement_scores",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    computationKey: text("computation_key").notNull(),
    policyVersion: text("policy_version").notNull(),
    inputs: jsonb("inputs").$type<JsonObject>().notNull(),
    adherence7d: real("adherence_7d"),
    adherence14d: real("adherence_14d"),
    checkinLatencyTrend: real("checkin_latency_trend"),
    daysSinceOpen: integer("days_since_open"),
    score: real("score").notNull(),
    tier: smallint("tier").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("engagement_scores_computation_uq").on(table.clientId, table.computationKey),
    index("engagement_scores_client_computed_idx").on(table.clientId, table.computedAt),
    check("engagement_scores_tier_ck", sql`${table.tier} BETWEEN 0 AND 4`),
    check(
      "engagement_scores_adherence_ck",
      sql`(${table.adherence7d} IS NULL OR ${table.adherence7d} BETWEEN 0 AND 1)
          AND (${table.adherence14d} IS NULL OR ${table.adherence14d} BETWEEN 0 AND 1)`,
    ),
  ],
);

export const accountabilityStates = pgTable(
  "accountability_states",
  {
    clientId: uuid("client_id")
      .primaryKey()
      .references(() => clients.id, { onDelete: "restrict" }),
    tier: smallint("tier").notNull().default(0),
    owner: accountabilityOwnerEnum("owner").notNull().default("none"),
    latestScoreId: uuid("latest_score_id").references(() => engagementScores.id, {
      onDelete: "restrict",
    }),
    transitionedAt: timestamp("transitioned_at", { withTimezone: true, mode: "date" }).notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    check("accountability_states_tier_ck", sql`${table.tier} BETWEEN 0 AND 4`),
    check("accountability_states_version_ck", sql`${table.version} > 0`),
    check("accountability_states_owner_ck", sql`(${table.tier} < 3) OR ${table.owner} = 'coach'`),
  ],
);

export const messageGuards = pgTable("message_guards", {
  clientId: uuid("client_id")
    .primaryKey()
    .references(() => clients.id, { onDelete: "restrict" }),
  lastAutomatedSentAt: timestamp("last_automated_sent_at", { withTimezone: true, mode: "date" }),
  version: integer("version").notNull().default(1),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    engagementScoreId: uuid("engagement_score_id").references(() => engagementScores.id, {
      onDelete: "restrict",
    }),
    actor: messageActorEnum("actor").notNull(),
    tier: smallint("tier").notNull(),
    status: messageStatusEnum("status").notNull(),
    body: text("body"),
    suppressionReason: text("suppression_reason"),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    suppressedAt: timestamp("suppressed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("messages_client_created_idx").on(table.clientId, table.createdAt),
    index("messages_outbox_idx").on(table.status, table.createdAt),
    index("messages_latest_automated_idx").on(table.clientId, table.actor, table.sentAt),
    check("messages_tier_ck", sql`${table.tier} BETWEEN 0 AND 4`),
    check("messages_body_bounded_ck", sql`${table.body} IS NULL OR length(${table.body}) <= 4000`),
    check("messages_sent_ck", sql`${table.status} <> 'sent' OR ${table.sentAt} IS NOT NULL`),
    check(
      "messages_suppressed_ck",
      sql`${table.status} <> 'suppressed' OR (
        ${table.suppressedAt} IS NOT NULL AND ${table.suppressionReason} IS NOT NULL AND
        length(btrim(${table.suppressionReason})) > 0
      )`,
    ),
    check("messages_automated_tier_ck", sql`${table.actor} <> 'automation' OR ${table.tier} < 3`),
  ],
);

export const evalResults = pgTable(
  "eval_results",
  {
    id: uuid("id").primaryKey(),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "restrict" }),
    kind: evaluationKindEnum("kind").notNull(),
    name: text("name").notNull(),
    passed: boolean("passed"),
    score: smallint("score"),
    rationale: text("rationale").notNull(),
    judgeModel: text("judge_model"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("eval_results_run_kind_name_uq").on(table.agentRunId, table.kind, table.name),
    check(
      "eval_results_shape_ck",
      sql`(${table.kind} = 'gate' AND ${table.passed} IS NOT NULL AND ${table.score} IS NULL)
          OR (${table.kind} = 'judge' AND ${table.score} BETWEEN 1 AND 5 AND ${table.passed} IS NULL)`,
    ),
    check("eval_results_rationale_nonempty_ck", sql`length(btrim(${table.rationale})) > 0`),
  ],
);

export const coachActions = pgTable(
  "coach_actions",
  {
    id: uuid("id").primaryKey(),
    coachId: uuid("coach_id")
      .notNull()
      .references(() => coaches.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    programmeId: uuid("programme_id").references(() => programmes.id, { onDelete: "restrict" }),
    adjustmentId: uuid("adjustment_id").references(() => adjustments.id, { onDelete: "restrict" }),
    action: coachActionEnum("action").notNull(),
    diff: jsonb("diff").$type<JsonObject>(),
    reason: text("reason"),
    requestId: text("request_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("coach_actions_programme_created_idx").on(table.programmeId, table.createdAt),
    check(
      "coach_actions_target_ck",
      sql`${table.programmeId} IS NOT NULL OR ${table.adjustmentId} IS NOT NULL OR ${table.action} = 'released_ownership'`,
    ),
    check(
      "coach_actions_override_reason_ck",
      sql`${table.action} <> 'overrode_block' OR (${table.reason} IS NOT NULL AND length(btrim(${table.reason})) > 0)`,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey(),
    operationScope: text("operation_scope").notNull(),
    actorScope: text("actor_scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    state: idempotencyStateEnum("state").notNull().default("in_progress"),
    responseStatus: integer("response_status"),
    response: jsonb("response").$type<JsonObject>(),
    errorCode: text("error_code"),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("idempotency_scope_key_uq").on(table.operationScope, table.actorScope, table.key),
    index("idempotency_state_lock_idx").on(table.state, table.lockedUntil),
    check("idempotency_key_nonempty_ck", sql`length(btrim(${table.key})) > 0`),
    check("idempotency_hash_nonempty_ck", sql`length(btrim(${table.requestHash})) > 0`),
    check(
      "idempotency_completed_ck",
      sql`${table.state} <> 'completed' OR (${table.responseStatus} IS NOT NULL AND ${table.response} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`,
    ),
  ],
);

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey(),
    stableKey: text("stable_key").notNull(),
    jobType: text("job_type").notNull(),
    status: jobStatusEnum("status").notNull().default("running"),
    attempt: integer("attempt").notNull().default(1),
    leaseUntil: timestamp("lease_until", { withTimezone: true, mode: "date" }),
    summary: jsonb("summary").$type<JsonObject>(),
    errorCode: text("error_code"),
    requestId: text("request_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("job_runs_stable_key_uq").on(table.stableKey),
    index("job_runs_status_lease_idx").on(table.status, table.leaseUntil),
    check("job_runs_attempt_ck", sql`${table.attempt} > 0`),
    check(
      "job_runs_completed_ck",
      sql`${table.status} <> 'completed' OR (${table.summary} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`,
    ),
  ],
);

export const schema = {
  accountabilityStates,
  adjustments,
  agentRuns,
  appEvents,
  checkIns,
  clientConstraints,
  clientNotes,
  clients,
  coachActions,
  coaches,
  contextTraces,
  engagementScores,
  evalResults,
  idempotencyRecords,
  jobRuns,
  messageGuards,
  messages,
  metrics,
  programmes,
  sessions,
};

export type Schema = typeof schema;
