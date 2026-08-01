CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE client_status AS ENUM ('active', 'paused', 'churned');
CREATE TYPE data_classification AS ENUM ('synthetic', 'non_synthetic');
CREATE TYPE constraint_kind AS ENUM ('injury', 'allergy', 'equipment', 'schedule', 'medical', 'preference');
CREATE TYPE constraint_severity AS ENUM ('hard', 'soft');
CREATE TYPE constraint_source AS ENUM ('client_reported', 'coach_entered', 'inferred');
CREATE TYPE programme_status AS ENUM ('draft', 'queued', 'published', 'rejected', 'superseded');
CREATE TYPE review_band AS ENUM ('blocked', 'attention', 'clear');
CREATE TYPE approval_kind AS ENUM ('standard', 'override');
CREATE TYPE adjustment_status AS ENUM ('draft', 'queued', 'approved', 'rejected', 'applied', 'superseded');
CREATE TYPE accountability_owner AS ENUM ('none', 'automation', 'coach');
CREATE TYPE message_actor AS ENUM ('automation', 'coach');
CREATE TYPE message_status AS ENUM ('drafted', 'sent', 'suppressed', 'cancelled');
CREATE TYPE agent_name AS ENUM ('programme', 'adjustment', 'accountability');
CREATE TYPE agent_run_status AS ENUM ('succeeded', 'failed');
CREATE TYPE evaluation_kind AS ENUM ('gate', 'judge');
CREATE TYPE coach_action AS ENUM ('approved', 'edited', 'rejected', 'overrode_block', 'released_ownership');
CREATE TYPE idempotency_state AS ENUM ('in_progress', 'completed', 'failed');
CREATE TYPE job_status AS ENUM ('running', 'completed', 'failed');

CREATE TABLE coaches (
  id uuid PRIMARY KEY, handle text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE clients (
  id uuid PRIMARY KEY, handle text NOT NULL, synthetic_label text NOT NULL,
  status client_status NOT NULL DEFAULT 'active', timezone text NOT NULL,
  data_classification data_classification NOT NULL DEFAULT 'non_synthetic',
  goals jsonb NOT NULL, profile jsonb NOT NULL,
  coach_id uuid NOT NULL REFERENCES coaches(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_handle_format_ck CHECK (handle ~ '^c_[0-9]{3}$'),
  CONSTRAINT clients_timezone_nonempty_ck CHECK (length(btrim(timezone)) > 0)
);
CREATE UNIQUE INDEX clients_handle_uq ON clients(handle);
CREATE INDEX clients_active_classification_idx ON clients(status, data_classification);

CREATE TABLE client_constraints (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  kind constraint_kind NOT NULL, severity constraint_severity NOT NULL, detail jsonb NOT NULL,
  source constraint_source NOT NULL, valid_from timestamptz NOT NULL, valid_until timestamptz,
  superseded_by uuid REFERENCES client_constraints(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_constraints_valid_window_ck CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT client_constraints_inferred_soft_ck CHECK (NOT (source = 'inferred' AND severity = 'hard')),
  CONSTRAINT client_constraints_not_self_superseded_ck CHECK (superseded_by IS NULL OR superseded_by <> id)
);
CREATE INDEX client_constraints_active_idx ON client_constraints(client_id, severity, valid_from, valid_until);

CREATE TABLE client_notes (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  body text NOT NULL, embedding vector(1536), valid_from timestamptz NOT NULL,
  valid_until timestamptz, superseded_by uuid REFERENCES client_notes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_notes_body_nonempty_ck CHECK (length(btrim(body)) > 0),
  CONSTRAINT client_notes_body_bounded_ck CHECK (length(body) <= 10000),
  CONSTRAINT client_notes_valid_window_ck CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT client_notes_not_self_superseded_ck CHECK (superseded_by IS NULL OR superseded_by <> id)
);
CREATE INDEX client_notes_current_idx ON client_notes(client_id, superseded_by, valid_from, valid_until);
CREATE INDEX client_notes_embedding_hnsw_idx ON client_notes USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL AND superseded_by IS NULL;

CREATE TABLE context_traces (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  turn_id uuid NOT NULL, intent text NOT NULL, effective_at timestamptz NOT NULL,
  selected jsonb NOT NULL, rendered text NOT NULL, token_count integer NOT NULL, budget integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_traces_tokens_ck CHECK (token_count >= 0 AND budget > 0)
);
CREATE UNIQUE INDEX context_traces_turn_uq ON context_traces(turn_id);
CREATE INDEX context_traces_client_created_idx ON context_traces(client_id, created_at);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY, attempt_key text NOT NULL, agent agent_name NOT NULL,
  status agent_run_status NOT NULL, prompt_version text NOT NULL, model text NOT NULL,
  trace_id uuid NOT NULL REFERENCES context_traces(id) ON DELETE RESTRICT,
  input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
  cost_usd real NOT NULL DEFAULT 0, latency_ms integer NOT NULL,
  output jsonb, error_code text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_runs_outcome_ck CHECK (
    (status = 'succeeded' AND output IS NOT NULL AND error_code IS NULL)
    OR (status = 'failed' AND error_code IS NOT NULL)
  ),
  CONSTRAINT agent_runs_usage_ck CHECK (
    input_tokens >= 0 AND output_tokens >= 0 AND cost_usd >= 0 AND latency_ms >= 0
  )
);
CREATE UNIQUE INDEX agent_runs_attempt_uq ON agent_runs(attempt_key);
CREATE INDEX agent_runs_trace_created_idx ON agent_runs(trace_id, created_at);

CREATE TABLE programmes (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  version integer NOT NULL, mesocycle integer NOT NULL, week integer NOT NULL, week_start date NOT NULL,
  payload jsonb NOT NULL, status programme_status NOT NULL DEFAULT 'draft', review_band review_band,
  generated_by uuid REFERENCES agent_runs(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES coaches(id) ON DELETE RESTRICT, approved_at timestamptz,
  approval_kind approval_kind, valid_from timestamptz,
  superseded_by uuid REFERENCES programmes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT programmes_version_ck CHECK (version > 0 AND mesocycle > 0 AND week > 0),
  CONSTRAINT programmes_reviewed_lifecycle_ck CHECK (status NOT IN ('queued', 'published') OR review_band IS NOT NULL),
  CONSTRAINT programmes_published_approval_ck CHECK (
    status <> 'published' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approval_kind IS NOT NULL AND valid_from IS NOT NULL)
  ),
  CONSTRAINT programmes_blocked_override_ck CHECK (
    NOT (status = 'published' AND review_band = 'blocked') OR approval_kind = 'override'
  ),
  CONSTRAINT programmes_override_only_blocked_ck CHECK (
    approval_kind <> 'override' OR (status = 'published' AND review_band = 'blocked')
  ),
  CONSTRAINT programmes_not_self_superseded_ck CHECK (superseded_by IS NULL OR superseded_by <> id)
);
CREATE UNIQUE INDEX programmes_client_version_uq ON programmes(client_id, week_start, version);
CREATE UNIQUE INDEX programmes_current_published_uq ON programmes(client_id, week_start)
  WHERE status = 'published' AND superseded_by IS NULL;
CREATE INDEX programmes_review_queue_idx ON programmes(status, review_band, created_at, id);
CREATE INDEX programmes_client_history_idx ON programmes(client_id, week_start, version);

CREATE TABLE sessions (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  programme_id uuid NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  session_key text NOT NULL, scheduled_for date NOT NULL, planned jsonb NOT NULL, actual jsonb,
  performed_at timestamptz, rpe real, notes text, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_rpe_ck CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  CONSTRAINT sessions_version_ck CHECK (version > 0),
  CONSTRAINT sessions_notes_bounded_ck CHECK (notes IS NULL OR length(notes) <= 4000)
);
CREATE UNIQUE INDEX sessions_programme_key_uq ON sessions(programme_id, session_key);
CREATE INDEX sessions_client_scheduled_idx ON sessions(client_id, scheduled_for, id);

CREATE TABLE check_ins (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  readiness smallint NOT NULL, body text, sentiment real, responded_at timestamptz NOT NULL,
  latency_hours real, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_ins_readiness_ck CHECK (readiness BETWEEN 1 AND 5),
  CONSTRAINT check_ins_body_bounded_ck CHECK (body IS NULL OR length(body) <= 4000),
  CONSTRAINT check_ins_sentiment_ck CHECK (sentiment IS NULL OR sentiment BETWEEN -1 AND 1),
  CONSTRAINT check_ins_latency_ck CHECK (latency_hours IS NULL OR latency_hours >= 0)
);
CREATE INDEX check_ins_client_created_idx ON check_ins(client_id, created_at);

CREATE TABLE metrics (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  kind text NOT NULL, value real NOT NULL, source text NOT NULL, measured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX metrics_client_kind_time_idx ON metrics(client_id, kind, measured_at);
CREATE TABLE app_events (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  kind text NOT NULL, occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_events_client_time_idx ON app_events(client_id, occurred_at);

CREATE TABLE adjustments (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  base_programme_id uuid NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  source_event_key text NOT NULL, operations jsonb NOT NULL,
  status adjustment_status NOT NULL DEFAULT 'draft', review_band review_band,
  generated_by uuid REFERENCES agent_runs(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES coaches(id) ON DELETE RESTRICT, approved_at timestamptz,
  applied_programme_id uuid REFERENCES programmes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adjustments_operations_nonempty_ck CHECK (jsonb_typeof(operations) = 'array' AND jsonb_array_length(operations) > 0),
  CONSTRAINT adjustments_approval_ck CHECK (
    status NOT IN ('approved', 'applied') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CONSTRAINT adjustments_applied_programme_ck CHECK (status <> 'applied' OR applied_programme_id IS NOT NULL)
);
CREATE UNIQUE INDEX adjustments_source_event_uq ON adjustments(client_id, source_event_key);
CREATE INDEX adjustments_client_status_idx ON adjustments(client_id, status, created_at);

CREATE TABLE engagement_scores (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  computation_key text NOT NULL, policy_version text NOT NULL, inputs jsonb NOT NULL,
  adherence_7d real, adherence_14d real, checkin_latency_trend real, days_since_open integer,
  score real NOT NULL, tier smallint NOT NULL, computed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_scores_tier_ck CHECK (tier BETWEEN 0 AND 4),
  CONSTRAINT engagement_scores_adherence_ck CHECK (
    (adherence_7d IS NULL OR adherence_7d BETWEEN 0 AND 1)
    AND (adherence_14d IS NULL OR adherence_14d BETWEEN 0 AND 1)
  )
);
CREATE UNIQUE INDEX engagement_scores_computation_uq ON engagement_scores(client_id, computation_key);
CREATE INDEX engagement_scores_client_computed_idx ON engagement_scores(client_id, computed_at);
CREATE TABLE accountability_states (
  client_id uuid PRIMARY KEY REFERENCES clients(id) ON DELETE RESTRICT,
  tier smallint NOT NULL DEFAULT 0, owner accountability_owner NOT NULL DEFAULT 'none',
  latest_score_id uuid REFERENCES engagement_scores(id) ON DELETE RESTRICT,
  transitioned_at timestamptz NOT NULL, version integer NOT NULL DEFAULT 1,
  CONSTRAINT accountability_states_tier_ck CHECK (tier BETWEEN 0 AND 4),
  CONSTRAINT accountability_states_version_ck CHECK (version > 0),
  CONSTRAINT accountability_states_owner_ck CHECK (tier < 3 OR owner = 'coach')
);
CREATE TABLE message_guards (
  client_id uuid PRIMARY KEY REFERENCES clients(id) ON DELETE RESTRICT,
  last_automated_sent_at timestamptz, version integer NOT NULL DEFAULT 1
);
CREATE TABLE messages (
  id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  engagement_score_id uuid REFERENCES engagement_scores(id) ON DELETE RESTRICT,
  actor message_actor NOT NULL, tier smallint NOT NULL, status message_status NOT NULL,
  body text, suppression_reason text, sent_at timestamptz, suppressed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_tier_ck CHECK (tier BETWEEN 0 AND 4),
  CONSTRAINT messages_body_bounded_ck CHECK (body IS NULL OR length(body) <= 4000),
  CONSTRAINT messages_sent_ck CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CONSTRAINT messages_suppressed_ck CHECK (
    status <> 'suppressed' OR (suppressed_at IS NOT NULL AND suppression_reason IS NOT NULL AND length(btrim(suppression_reason)) > 0)
  ),
  CONSTRAINT messages_automated_tier_ck CHECK (actor <> 'automation' OR tier < 3)
);
CREATE INDEX messages_client_created_idx ON messages(client_id, created_at);
CREATE INDEX messages_outbox_idx ON messages(status, created_at);
CREATE INDEX messages_latest_automated_idx ON messages(client_id, actor, sent_at);

CREATE TABLE eval_results (
  id uuid PRIMARY KEY, agent_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT,
  kind evaluation_kind NOT NULL, name text NOT NULL, passed boolean, score smallint,
  rationale text NOT NULL, judge_model text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eval_results_shape_ck CHECK (
    (kind = 'gate' AND passed IS NOT NULL AND score IS NULL)
    OR (kind = 'judge' AND score BETWEEN 1 AND 5 AND passed IS NULL)
  ),
  CONSTRAINT eval_results_rationale_nonempty_ck CHECK (length(btrim(rationale)) > 0)
);
CREATE UNIQUE INDEX eval_results_run_kind_name_uq ON eval_results(agent_run_id, kind, name);

CREATE TABLE coach_actions (
  id uuid PRIMARY KEY, coach_id uuid NOT NULL REFERENCES coaches(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  programme_id uuid REFERENCES programmes(id) ON DELETE RESTRICT,
  adjustment_id uuid REFERENCES adjustments(id) ON DELETE RESTRICT,
  action coach_action NOT NULL, diff jsonb, reason text, request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_actions_target_ck CHECK (
    programme_id IS NOT NULL OR adjustment_id IS NOT NULL OR action = 'released_ownership'
  ),
  CONSTRAINT coach_actions_override_reason_ck CHECK (
    action <> 'overrode_block' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)
  )
);
CREATE INDEX coach_actions_programme_created_idx ON coach_actions(programme_id, created_at);

CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY, operation_scope text NOT NULL, actor_scope text NOT NULL,
  key text NOT NULL, request_hash text NOT NULL,
  state idempotency_state NOT NULL DEFAULT 'in_progress', response_status integer,
  response jsonb, error_code text, locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  CONSTRAINT idempotency_key_nonempty_ck CHECK (length(btrim(key)) > 0),
  CONSTRAINT idempotency_hash_nonempty_ck CHECK (length(btrim(request_hash)) > 0),
  CONSTRAINT idempotency_completed_ck CHECK (
    state <> 'completed' OR (response_status IS NOT NULL AND response IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX idempotency_scope_key_uq ON idempotency_records(operation_scope, actor_scope, key);
CREATE INDEX idempotency_state_lock_idx ON idempotency_records(state, locked_until);
CREATE TABLE job_runs (
  id uuid PRIMARY KEY, stable_key text NOT NULL, job_type text NOT NULL,
  status job_status NOT NULL DEFAULT 'running', attempt integer NOT NULL DEFAULT 1,
  lease_until timestamptz, summary jsonb, error_code text, request_id text NOT NULL,
  started_at timestamptz NOT NULL, completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_runs_attempt_ck CHECK (attempt > 0),
  CONSTRAINT job_runs_completed_ck CHECK (
    status <> 'completed' OR (summary IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX job_runs_stable_key_uq ON job_runs(stable_key);
CREATE INDEX job_runs_status_lease_idx ON job_runs(status, lease_until);

CREATE OR REPLACE FUNCTION spotter_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000'; END;
$$;
CREATE TRIGGER context_traces_append_only BEFORE UPDATE OR DELETE ON context_traces FOR EACH ROW EXECUTE FUNCTION spotter_reject_append_only_mutation();
CREATE TRIGGER agent_runs_append_only BEFORE UPDATE OR DELETE ON agent_runs FOR EACH ROW EXECUTE FUNCTION spotter_reject_append_only_mutation();
CREATE TRIGGER eval_results_append_only BEFORE UPDATE OR DELETE ON eval_results FOR EACH ROW EXECUTE FUNCTION spotter_reject_append_only_mutation();
CREATE TRIGGER coach_actions_append_only BEFORE UPDATE OR DELETE ON coach_actions FOR EACH ROW EXECUTE FUNCTION spotter_reject_append_only_mutation();
CREATE TRIGGER engagement_scores_append_only BEFORE UPDATE OR DELETE ON engagement_scores FOR EACH ROW EXECUTE FUNCTION spotter_reject_append_only_mutation();
CREATE TRIGGER check_ins_append_only BEFORE UPDATE OR DELETE ON check_ins FOR EACH ROW EXECUTE FUNCTION spotter_reject_append_only_mutation();
CREATE TRIGGER app_events_append_only BEFORE UPDATE OR DELETE ON app_events FOR EACH ROW EXECUTE FUNCTION spotter_reject_append_only_mutation();

CREATE OR REPLACE FUNCTION spotter_validate_programme_supersession()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'superseded' AND NEW.superseded_by IS NULL THEN
    RAISE EXCEPTION 'superseded programme requires superseded_by' USING ERRCODE = '23514';
  END IF;
  IF NEW.superseded_by IS NOT NULL AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'superseded_by requires superseded lifecycle' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER programmes_supersession_guard BEFORE INSERT OR UPDATE ON programmes
  FOR EACH ROW EXECUTE FUNCTION spotter_validate_programme_supersession();
