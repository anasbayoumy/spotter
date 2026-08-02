CREATE TYPE session_status AS ENUM ('scheduled', 'completed', 'missed');

ALTER TABLE sessions
  ADD COLUMN status session_status NOT NULL DEFAULT 'scheduled';
UPDATE sessions SET status = 'completed' WHERE performed_at IS NOT NULL;

ALTER TABLE check_ins
  ADD COLUMN requires_human_escalation boolean NOT NULL DEFAULT false;

ALTER TYPE adjustment_status ADD VALUE IF NOT EXISTS 'stale';
ALTER TABLE adjustments ADD COLUMN trigger jsonb;
UPDATE adjustments AS adjustment
SET trigger = jsonb_build_object('type', 'explicit_coach', 'coachId', client.coach_id::text)
FROM clients AS client
WHERE client.id = adjustment.client_id AND adjustment.trigger IS NULL;
ALTER TABLE adjustments ALTER COLUMN trigger SET NOT NULL;
ALTER TABLE adjustments ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE adjustments
  ADD CONSTRAINT adjustments_version_ck CHECK (version > 0);

CREATE TABLE adjustment_triggers (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  source_event_key text NOT NULL,
  trigger jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX adjustment_triggers_source_uq
  ON adjustment_triggers(client_id, source_event_key);
CREATE INDEX adjustment_triggers_client_created_idx
  ON adjustment_triggers(client_id, created_at);

ALTER TABLE accountability_states
  ADD COLUMN automation_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN churn_flagged boolean NOT NULL DEFAULT false;
UPDATE accountability_states
SET automation_paused = tier >= 3,
    churn_flagged = tier = 4;
ALTER TABLE accountability_states
  ADD CONSTRAINT accountability_states_escalation_ck CHECK (
    (tier < 3 OR automation_paused) AND (tier <> 4 OR churn_flagged)
  );
