\set ON_ERROR_STOP on

BEGIN;

-- The runner proves every reserved prefix is empty before this transaction. The fixture therefore
-- only inserts performance-owned rows; it never deletes an unknown row, message guard, or existing
-- client state. Fresh release execution applies migrations without demo seed data, so all fifty
-- identities are temporary release-load clients removed by the ownership-aware cleanup.

INSERT INTO coaches (id, handle)
VALUES ('00000000-0000-4000-8000-000000000001', 'coach_demo')
ON CONFLICT DO NOTHING;

INSERT INTO clients (
  id, handle, synthetic_label, status, timezone, data_classification, goals, profile, coach_id,
  created_at
)
SELECT
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  'c_' || lpad(client_number::text, 3, '0'),
  'Synthetic performance client ' || lpad(client_number::text, 3, '0'),
  'active'::client_status,
  'Africa/Cairo',
  'synthetic'::data_classification,
  jsonb_build_object(
    'primary', 'Complete a synthetic training block',
    'secondary', jsonb_build_array('Build repeatable habits'),
    'targetDate', NULL
  ),
  jsonb_build_object(
    'ageBand', '25_34',
    'equipment', jsonb_build_array('dumbbell', 'rower'),
    'sessionsPerWeek', 3,
    'sex', 'not_specified',
    'trainingAgeMonths', 18
  ),
  '00000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01T00:00:00Z'::timestamptz + client_number * interval '1 second'
FROM generate_series(1, 50) AS corpus(client_number)
ON CONFLICT DO NOTHING;

INSERT INTO client_notes (id, client_id, body, valid_from, created_at)
SELECT
  ('56000000-0000-4000-8000-' || lpad((client_number * 10 + 2)::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  'Current synthetic performance preference: consistent weekday training.',
  '2026-01-15T00:00:00Z'::timestamptz,
  '2026-01-15T00:00:00Z'::timestamptz
FROM generate_series(1, 50) AS corpus(client_number)
ON CONFLICT DO NOTHING;

INSERT INTO client_notes (
  id, client_id, body, valid_from, valid_until, superseded_by, created_at
)
SELECT
  ('56000000-0000-4000-8000-' || lpad((client_number * 10 + 1)::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  'Superseded synthetic performance preference.',
  '2025-11-01T00:00:00Z'::timestamptz,
  '2026-01-15T00:00:00Z'::timestamptz,
  ('56000000-0000-4000-8000-' || lpad((client_number * 10 + 2)::text, 12, '0'))::uuid,
  '2025-11-01T00:00:00Z'::timestamptz
FROM generate_series(1, 50) AS corpus(client_number)
ON CONFLICT DO NOTHING;

INSERT INTO client_constraints (
  id, client_id, kind, severity, detail, source, valid_from, created_at
)
SELECT
  ('57000000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  CASE WHEN client_number % 3 = 0 THEN 'injury'::constraint_kind ELSE 'preference'::constraint_kind END,
  CASE WHEN client_number % 3 = 0 THEN 'hard'::constraint_severity ELSE 'soft'::constraint_severity END,
  CASE
    WHEN client_number % 3 = 0 THEN jsonb_build_object('forbids', jsonb_build_array('overhead_press'), 'region', 'shoulder')
    ELSE jsonb_build_object(
      'forbids', jsonb_build_array(),
      'note', 'Prefers consistent weekday training.'
    )
  END,
  'coach_entered'::constraint_source,
  '2026-01-01T00:00:00Z'::timestamptz,
  '2026-01-01T00:00:00Z'::timestamptz + client_number * interval '1 second'
FROM generate_series(1, 50) AS corpus(client_number)
ON CONFLICT DO NOTHING;

INSERT INTO context_traces (
  id, client_id, turn_id, intent, effective_at, selected, rendered, token_count, budget, created_at
)
SELECT
  ('51000000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  ('51100000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid,
  'programme',
  '2026-07-27T06:00:00Z'::timestamptz,
  jsonb_build_object('sections', jsonb_build_array()),
  'Synthetic deterministic performance context for c_' || lpad(client_number::text, 3, '0'),
  24,
  12000,
  '2026-07-27T06:00:00Z'::timestamptz + client_number * interval '1 second'
FROM generate_series(1, 50) AS corpus(client_number)
ON CONFLICT DO NOTHING;

INSERT INTO agent_runs (
  id, attempt_key, agent, status, prompt_version, model, trace_id, input_tokens, output_tokens,
  cost_usd, latency_ms, output, created_at
)
SELECT
  ('52000000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid,
  'performance-corpus-programme-' || client_number,
  'programme'::agent_name,
  'succeeded'::agent_run_status,
  'performance-corpus-v1',
  'recorded/performance-v1',
  ('51000000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid,
  320,
  120,
  0,
  20 + client_number % 7,
  jsonb_build_object('fixture', 'synthetic-performance', 'clientNumber', client_number),
  '2026-07-27T06:00:01Z'::timestamptz + client_number * interval '1 second'
FROM generate_series(1, 50) AS corpus(client_number)
ON CONFLICT DO NOTHING;

INSERT INTO eval_results (
  id, agent_run_id, kind, name, passed, rationale, created_at
)
SELECT
  ('53000000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid,
  ('52000000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid,
  'gate'::evaluation_kind,
  'forbidden_movement',
  client_number % 3 <> 0,
  'Synthetic deterministic performance evaluation.',
  '2026-07-27T06:00:02Z'::timestamptz + client_number * interval '1 second'
FROM generate_series(1, 50) AS corpus(client_number)
ON CONFLICT DO NOTHING;

-- Twelve programme weeks per client provide the history. The last week becomes current only after
-- all rows exist, allowing the older versions to point at it as their supersession target.
INSERT INTO programmes (
  id, client_id, version, mesocycle, week, week_start, payload, status, review_band,
  generated_by, created_at
)
SELECT
  ('54000000-0000-4000-8000-' || lpad((client_number * 100 + week_number)::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  1,
  1,
  week_number,
  ('2026-05-11'::date + (week_number - 1) * 7),
  jsonb_build_object(
    'summary', 'Synthetic performance programme week ' || week_number,
    'days', jsonb_build_array(jsonb_build_object(
      'dayIndex', 1,
      'scheduledDate', to_char('2026-05-11'::date + (week_number - 1) * 7, 'YYYY-MM-DD'),
      'focus', 'Synthetic aerobic conditioning',
      'exercises', jsonb_build_array(jsonb_build_object(
        'id', '58000000-0000-4000-8000-000000000001',
        'name', 'Synthetic row intervals',
        'family', 'horizontal_pull',
        'muscleGroups', jsonb_build_array('back'),
        'sets', 4,
        'reps', 8,
        'rpe', 7,
        'restSeconds', 90,
        'notes', 'Synthetic performance fixture.'
      ))
    ))
  ),
  'draft'::programme_status,
  CASE client_number % 3
    WHEN 0 THEN 'blocked'::review_band
    WHEN 1 THEN 'attention'::review_band
    ELSE 'clear'::review_band
  END,
  ('52000000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid,
  '2026-05-11T06:00:00Z'::timestamptz + (week_number - 1) * interval '7 days' + client_number * interval '1 second'
FROM generate_series(1, 50) AS clients(client_number)
CROSS JOIN generate_series(1, 12) AS weeks(week_number)
ON CONFLICT DO NOTHING;

UPDATE programmes AS programme
SET
  status = 'published',
  approved_by = '00000000-0000-4000-8000-000000000001'::uuid,
  approved_at = '2026-07-27T06:30:00Z'::timestamptz,
  approval_kind = CASE WHEN programme.review_band = 'blocked' THEN 'override'::approval_kind ELSE 'standard'::approval_kind END,
  valid_from = '2026-07-27T06:30:00Z'::timestamptz
WHERE programme.id IN (
  SELECT ('54000000-0000-4000-8000-' || lpad((client_number * 100 + 12)::text, 12, '0'))::uuid
  FROM generate_series(1, 50) AS clients(client_number)
)
AND programme.status = 'draft';

UPDATE programmes AS programme
SET
  status = 'superseded',
  superseded_by = ('54000000-0000-4000-8000-' || lpad((client_number * 100 + 12)::text, 12, '0'))::uuid
FROM generate_series(1, 50) AS clients(client_number)
WHERE programme.client_id = ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid
  AND programme.id IN (
    SELECT ('54000000-0000-4000-8000-' || lpad((client_number * 100 + week_number)::text, 12, '0'))::uuid
    FROM generate_series(1, 11) AS weeks(week_number)
  )
  AND programme.status = 'draft';

INSERT INTO programmes (
  id, client_id, version, mesocycle, week, week_start, payload, status, review_band,
  generated_by, created_at
)
SELECT
  ('54000000-0000-4000-8000-' || lpad((client_number * 100 + 99)::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  100,
  1,
  13,
  '2026-08-03'::date,
  jsonb_build_object(
    'summary', 'Synthetic queued performance programme',
    'days', jsonb_build_array(jsonb_build_object(
      'dayIndex', 1,
      'scheduledDate', '2026-08-03',
      'focus', 'Synthetic queued review',
      'exercises', jsonb_build_array(jsonb_build_object(
        'id', '58000000-0000-4000-8000-000000000001',
        'name', 'Synthetic row intervals',
        'family', 'horizontal_pull',
        'muscleGroups', jsonb_build_array('back'),
        'sets', 4,
        'reps', 8,
        'rpe', 7,
        'restSeconds', 90,
        'notes', 'Synthetic performance fixture.'
      ))
    ))
  ),
  'queued'::programme_status,
  CASE client_number % 3
    WHEN 0 THEN 'blocked'::review_band
    WHEN 1 THEN 'attention'::review_band
    ELSE 'clear'::review_band
  END,
  ('52000000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid,
  '2026-08-01T06:00:00Z'::timestamptz + client_number * interval '1 second'
FROM generate_series(1, 50) AS clients(client_number)
ON CONFLICT DO NOTHING;

-- Three sessions in each of twelve calendar weeks gives 1,800 bounded historical/session rows.
INSERT INTO sessions (
  id, client_id, programme_id, session_key, scheduled_for, status, planned, actual,
  performed_at, rpe, notes, version, created_at
)
SELECT
  ('55000000-0000-4000-8000-' || lpad((client_number * 1000 + week_number * 10 + day_number)::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  ('54000000-0000-4000-8000-' || lpad((client_number * 100 + week_number)::text, 12, '0'))::uuid,
  'day-' || day_number,
  ('2026-05-11'::date + (week_number - 1) * 7 + (day_number - 1) * 2),
  CASE WHEN week_number < 12 THEN 'completed'::session_status ELSE 'scheduled'::session_status END,
  jsonb_build_array(jsonb_build_object(
    'id', '58000000-0000-4000-8000-000000000001',
    'name', 'Synthetic row intervals',
    'family', 'horizontal_pull',
    'muscleGroups', jsonb_build_array('back'),
    'sets', 4,
    'reps', 8,
    'rpe', 7,
    'restSeconds', 90,
    'notes', 'Synthetic performance fixture.'
  )),
  CASE WHEN week_number < 12 THEN jsonb_build_array(jsonb_build_object(
    'exerciseId', '58000000-0000-4000-8000-000000000001',
    'sets', jsonb_build_array(jsonb_build_object(
      'setIndex', 1, 'reps', 8, 'loadKg', 20, 'rpe', 7, 'completed', true
    ))
  )) ELSE NULL END,
  CASE WHEN week_number < 12
    THEN ('2026-05-11T08:00:00Z'::timestamptz + (week_number - 1) * interval '7 days' + (day_number - 1) * interval '2 days')
    ELSE NULL
  END,
  CASE WHEN week_number < 12 THEN 7 ELSE NULL END,
  'Synthetic performance session.',
  1,
  '2026-05-11T06:30:00Z'::timestamptz + (week_number - 1) * interval '7 days' + client_number * interval '1 second'
FROM generate_series(1, 50) AS clients(client_number)
CROSS JOIN generate_series(1, 12) AS weeks(week_number)
CROSS JOIN generate_series(1, 3) AS days(day_number)
ON CONFLICT DO NOTHING;

INSERT INTO check_ins (
  id, client_id, readiness, body, sentiment, responded_at, latency_hours,
  requires_human_escalation, created_at
)
SELECT
  ('59000000-0000-4000-8000-' || lpad((client_number * 100 + week_number)::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  3 + (week_number % 3),
  'Synthetic weekly performance check-in.',
  0.25,
  '2026-05-11T12:00:00Z'::timestamptz + (week_number - 1) * interval '7 days',
  4,
  false,
  '2026-05-11T12:00:00Z'::timestamptz + (week_number - 1) * interval '7 days' + client_number * interval '1 second'
FROM generate_series(1, 50) AS clients(client_number)
CROSS JOIN generate_series(1, 12) AS weeks(week_number)
ON CONFLICT DO NOTHING;

INSERT INTO app_events (id, client_id, kind, occurred_at, created_at)
SELECT
  ('5a000000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  'synthetic_app_open',
  '2026-07-31T08:00:00Z'::timestamptz,
  '2026-07-31T08:00:00Z'::timestamptz + client_number * interval '1 second'
FROM generate_series(1, 50) AS clients(client_number)
ON CONFLICT DO NOTHING;

INSERT INTO engagement_scores (
  id, client_id, computation_key, policy_version, inputs, adherence_7d, adherence_14d,
  checkin_latency_trend, days_since_open, score, tier, computed_at, created_at
)
SELECT
  ('5b000000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  'performance-corpus-score-v1',
  'engagement-v1',
  jsonb_build_object(
    'plannedDue7d', 3,
    'completedDue7d', 2,
    'plannedDue14d', 6,
    'completedDue14d', 5,
    'missedDue7d', 1,
    'missedDue14d', 1,
    'currentCheckInLatencyHours', 4,
    'baselineCheckInLatencyHours', 6,
    'baselineCheckInCount', 12,
    'daysSinceOpen', 1,
    'rpeDrift', 0
  ),
  0.67,
  0.83,
  -2,
  1,
  82,
  1,
  '2026-08-01T08:00:00Z'::timestamptz,
  '2026-08-01T08:00:00Z'::timestamptz + client_number * interval '1 second'
FROM generate_series(1, 50) AS clients(client_number)
ON CONFLICT DO NOTHING;

INSERT INTO accountability_states (
  client_id, tier, owner, latest_score_id, automation_paused, churn_flagged, transitioned_at, version
)
SELECT
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  1,
  'automation'::accountability_owner,
  ('5b000000-0000-4000-8000-' || lpad(client_number::text, 12, '0'))::uuid,
  false,
  false,
  '2026-08-01T08:00:00Z'::timestamptz,
  1
FROM generate_series(1, 50) AS clients(client_number)
ON CONFLICT DO NOTHING;

INSERT INTO message_guards (client_id, version)
SELECT
  ('00000000-0000-4000-8000-' || lpad((100 + client_number)::text, 12, '0'))::uuid,
  1
FROM generate_series(1, 50) AS clients(client_number)
ON CONFLICT DO NOTHING;

COMMIT;

SELECT jsonb_pretty(jsonb_build_object(
  'schemaVersion', 1,
  'classification', 'synthetic_only',
  'coaches', (SELECT count(*) FROM coaches),
  'clients', (SELECT count(*) FROM clients WHERE status = 'active' AND data_classification = 'synthetic'),
  'nonSyntheticClients', (SELECT count(*) FROM clients WHERE data_classification <> 'synthetic'),
  'programmeRows', (SELECT count(*) FROM programmes),
  'standardSessions', (
    SELECT count(*) FROM sessions WHERE id::text LIKE '55000000-0000-4000-8000-%'
  ),
  'minimumSessionsPerClient', (
    SELECT min(total) FROM (
      SELECT client_id, count(*) AS total
      FROM sessions
      WHERE id::text LIKE '55000000-0000-4000-8000-%'
      GROUP BY client_id
    ) AS per_client
  ),
  'queueDistinctClients', (
    SELECT count(DISTINCT client_id) FROM programmes
    WHERE id::text LIKE '54000000-0000-4000-8000-%' AND status = 'queued'
  ),
  'reviewBands', (
    SELECT jsonb_object_agg(review_band, total) FROM (
      SELECT review_band::text, count(*) AS total
      FROM programmes
      WHERE id::text LIKE '54000000-0000-4000-8000-%' AND status = 'queued'
      GROUP BY review_band
    ) AS bands
  ),
  'traces', (SELECT count(*) FROM context_traces),
  'agentRuns', (SELECT count(*) FROM agent_runs),
  'evaluations', (SELECT count(*) FROM eval_results),
  'notes', (SELECT count(*) FROM client_notes),
  'constraints', (SELECT count(*) FROM client_constraints)
));
