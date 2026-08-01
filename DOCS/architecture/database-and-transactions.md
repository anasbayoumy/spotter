# Database and Transaction Architecture

## Storage authority

PostgreSQL 16 with pgvector is the authoritative V1 database. Drizzle defines typed access and
generates SQL migrations, but committed SQL and actual PostgreSQL behavior are the acceptance
authority (`DAT-001`).

PGlite implements the same repository ports for the keyless demo and fast isolated tests. It must
pass a parity suite covering schema, temporal filtering, lifecycle transitions, and representative
queries. Features that cannot be proven in PGlite—concurrency, row locking, partial unique indexes,
advisory locks, and production vector behavior—must pass against Docker PostgreSQL (`DAT-002`).

All identifiers are UUIDs. Stored instants are UTC `timestamptz`; scheduled local dates resolve with
the client's IANA timezone through an injected `Clock` (`DAT-011`).

## Data ownership

### Coaching state

- `coaches`: the seeded V1 audit actor.
- `clients`: handle, status, timezone, goals, profile, owning coach, and explicit data
  classification.
- `client_constraints`: temporal hard/soft constraints with provenance.
- `client_notes`: temporal/superseded notes with optional vector embedding.
- `programmes`: immutable versioned programme payload and review lifecycle.
- `sessions`: scheduled plan materialization, actual work, completion, notes, and RPE.
- `check_ins`: readiness, text response, sentiment, and response timing.
- `app_events`: synthetic/demo activity signals for engagement scoring.
- `adjustments`: immutable proposed operations with review and application lifecycle.

### Accountability

- `engagement_scores`: append-only deterministic score inputs and output tier.
- `accountability_states`: current tier, current actor ownership, transition time, and version.
- `messages`: drafted/sent/suppressed in-app messages and their tier/actor.

### AI, review, and operations

- `context_traces`: selected record references/snapshots, exact rendered context, budget, and count.
- `agent_runs`: prompt hash, model, trace, output, usage, cost, latency, and failure.
- `eval_results`: gate outcomes and judge scores/rationales.
- `coach_actions`: append-only approvals, edits, rejections, and overrides.
- `idempotency_records`: operation scope, key, request hash, state, and stable response reference.
- `job_runs`: stable job key, type, status, counts, lease/attempt metadata, and error.

Identity/contact details are unnecessary for simulated V1 messaging. If an isolated
`client_identity` table is retained for forward compatibility, no V1 query, trace assembler, logger,
fixture, or message adapter may read it.

## Required database invariants

Database constraints complement—not replace—domain validation.

### Enumerations and row validity

- Client status is one of `active | paused | churned`.
- Constraint severity is `hard | soft`; source is `client_reported | coach_entered | inferred`.
- Inferred constraints cannot be persisted as `hard`.
- A validity window must have `valid_until IS NULL OR valid_until > valid_from`.
- Programme status is `draft | queued | published | rejected | superseded`.
- Review band is `blocked | attention | clear` once evaluation completes.
- Published programmes require non-null `approved_by`, `approved_at`, and `valid_from`.
- Non-override approval is prohibited when `review_band=blocked`.
- Overrides require a trimmed non-empty reason in the associated coach action.
- RPE/readiness, sets, repetitions, load, tier, and judge scores use bounded checks.
- Accountability owner is compatible with tier: automation cannot own tier 3 or 4.

Cross-row/business conditions that PostgreSQL cannot express safely as a simple `CHECK` are enforced
by application use cases plus transaction locking and verified with integration tests.

### Uniqueness and concurrency

At minimum, migrations create:

- a unique client handle;
- a partial unique current-published-programme key for client and programme week;
- unique idempotency key within operation/actor scope;
- unique stable job run key;
- unique agent/evaluation identity appropriate to one pipeline attempt;
- a uniqueness key preventing duplicate accountability transitions for the same computed score; and
- an automated-message window key/locking strategy that makes concurrent 48-hour decisions safe.

The message cap is evaluated by locking the client's accountability state (or a dedicated message
guard row), selecting the latest automated send, and inserting/suppressing in the same transaction.
A pre-insert read without a lock is not sufficient (`DAT-010`, `FLOW-005`).

### Indexes aligned with read paths

Required indexed access paths include:

- review queue by lifecycle status, band priority, and creation time;
- active clients by status;
- current programme by client/week;
- sessions by client and scheduled date;
- active constraints by client and temporal window;
- current/superseded notes by client;
- unsent messages and latest automated send by client;
- latest engagement score/state by client;
- traces and runs by programme/client/created time;
- idempotency and job stable keys; and
- HNSW vector search for eligible client notes.

The retrieval query applies client, supersession, and temporal predicates before vector/recency
ranking. An index is useful only if query-plan tests show it supports the intended predicate; index
names alone are not performance evidence.

## Temporal selection contract

All queries that assemble state receive a single explicit `effectiveAt` value. A record is active
when:

```text
valid_from <= effectiveAt
AND (valid_until IS NULL OR valid_until > effectiveAt)
AND superseded_by IS NULL, where applicable
```

The lower bound is inclusive and the upper bound is exclusive. This removes ambiguity at exact
expiry instants. Repository methods are named to reveal temporal intent, for example
`findActiveHardConstraints(clientId, effectiveAt)` rather than `findConstraints(clientId)`.

Filter order is a correctness contract:

1. scope to the client;
2. exclude superseded rows;
3. apply the validity window;
4. enforce classification/surface visibility;
5. rank the eligible set by relevance and recency; and
6. apply a bounded limit.

## Transaction boundaries

### Generate and queue a programme

Model I/O never occurs inside a database transaction.

1. Read a consistent context at `effectiveAt` and assemble it deterministically.
2. In a short transaction, insert/commit the context trace.
3. Call the gateway with the committed trace ID.
4. Validate output, run gates, and run required judges.
5. In a short transaction, insert the agent run, evaluations, programme draft/queue record, and
   linkage. If persistence fails, none of these review artifacts becomes partially visible.

When a gateway fails after step 2, write an `agent_runs` failure referencing the trace in a separate
short transaction. The trace remains evidence of the attempted call (`DAT-009`). If output schema
validation fails, store a redacted failure record but do not create a queued programme (`AI-003`).

### Approve and publish

The approval use case opens one transaction and:

1. claims/validates the idempotency record;
2. locks the candidate programme and current programme slot;
3. verifies status, band, actor, and unchanged version;
4. rejects ordinary approval for `blocked`;
5. supersedes the prior current published programme, if present;
6. marks the candidate published with configured coach actor and approval time;
7. materializes/reconciles its sessions without duplicating completed history;
8. inserts the append-only coach action; and
9. completes the idempotency record with the stable response reference.

Any failure rolls back all nine operations. A concurrent publisher receives the existing
idempotent result or a typed conflict; it cannot create two current programmes (`DAT-005`,
`DAT-006`).

Override uses the same transaction after requiring `review_band=blocked` and a trimmed non-empty
reason. The reason and failed gates remain visible; override does not rewrite evaluation history.

### Edit

- Editing a draft creates a new immutable programme version or a formally versioned replacement;
  it never destroys the generated payload used by its trace/evaluations.
- Editing a published programme always creates a new candidate version, evaluates it where required,
  and sends it through approval. The currently published version remains client-visible until the
  replacement transaction commits (`DAT-008`).
- The coach action stores a machine-readable diff plus optional reason.

### Approve an adjustment

An adjustment is a structured list of allowed operations against a specific programme version. The
transaction:

1. locks and verifies the pending adjustment and referenced current programme version;
2. fails on stale base version rather than applying against a changed plan;
3. produces a new programme version by applying enumerated operations;
4. records the coach approval and adjustment application;
5. supersedes/publishes atomically using the normal publication invariant; and
6. materializes only future/unperformed session changes.

V1 has no transaction path callable by an agent or event that auto-applies the adjustment
(`FLOW-002`).

### Complete a session or submit a check-in

Session logging supports safe retries and optimistic version checks. Completing a session changes
the session once, preserves the final actual payload, and records the idempotent result. Check-in
submission inserts one immutable response. Once committed, both are visible to the next context
assembly (`FLOW-003`).

### Accountability sweep

For each client, one short transaction locks the accountability state, stores the append-only score,
applies allowed state-machine transitions, and decides whether a message is inserted or suppressed.
Model-generated wording, when needed, is created outside that transaction and validated before the
final message transaction. Tier selection is never supplied by model output.

Tier 3 transfers ownership to the coach and prohibits automated sends. Tier 4 creates the churn flag
and prohibits further automated contact. Automatic code cannot demote coach ownership; a recorded
coach action is required (`FLOW-004`).

### Scheduled jobs

The stable run key includes job type and logical schedule window, not request ID. A transaction
inserts or locks `job_runs`; a completed key returns its stored summary. A running key is leased or
reported in progress. PostgreSQL advisory locking may coordinate the overall window, while
per-client idempotency ensures recovery after partial process failure (`FLOW-007`).

## Idempotency policy

- The caller supplies `Idempotency-Key` for retryable public mutations.
- The server stores a hash of the normalized request with the scoped key.
- Reusing a key with a different request returns `409 idempotency_key_reused`.
- Reusing a completed identical request returns the original status and response reference.
- An in-progress identical request returns a deterministic in-progress/conflict response.
- Expiration/cleanup is an explicit operations policy; deletion must not remove audit records.

## Data classification and public-demo guard

Every client is explicitly classified `synthetic | non_synthetic`; the safe database default is
`non_synthetic`. Demo seed scripts explicitly set `synthetic`. In production no-auth mode:

- startup requires `ALLOW_NO_AUTH_SYNTHETIC_DEMO=true` and `DATA_POLICY=synthetic_only`;
- bootstrap scans/rejects any active non-synthetic client;
- client/coach queries and jobs include the synthetic scope as defense in depth; and
- fixtures/recordings/traces are scanned for prohibited identity fields.

The system fails closed rather than hiding individual rows after a mixed-data database is detected
(`PRV-002`, `PRV-003`).

## Deletion and retention

“Nothing is deleted; it is superseded” applies to coaching decision history, not an unlimited legal
right to retain personal data. V1 public deployments are synthetic-only. A future real-data release
must add a documented privacy deletion/redaction design before changing that guard. Operational
cleanup may remove expired idempotency payload caches or disposable local/test databases, but not
the audit references required to reconstruct coaching decisions.

