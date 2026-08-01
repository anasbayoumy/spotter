# Runtime Flows and Failure Semantics

## Common command pipeline

Every API command follows the same outer sequence:

```text
HTTP request
  -> Next route adapter validates path/query/body/headers
  -> request ID + configured actor + clock become ExecutionContext
  -> one backend facade method
  -> application use case
  -> domain decisions + ports
  -> typed application result
  -> adapter validates response schema
  -> { data, error, meta }
```

Validation failures return stable `4xx` codes. Known domain conflicts return a typed `409` or `422`.
Unexpected failures return a redacted `500` with the request ID. Internal errors preserve the same
correlation ID in structured logs (`BND-005`, `OPS-001`).

## Loop A: weekly planning

```text
scheduled job/manual generate
  -> claim stable job/idempotency key
  -> select active synthetic-scoped client
  -> assemble deterministic context at one effectiveAt
  -> commit context trace
  -> programme gateway (recorded or live)
  -> validate structured output and citations
  -> deterministic safety gates
  -> independent graded judges
  -> calculate review band
  -> persist run + evals + queued programme
  -> coach queue
  -> edit/reject/approve/override
  -> atomic publish + supersede + sessions + coach action
  -> client Today endpoint can observe it
```

### Context assembly order

1. All active hard constraints, pinned and never budgeted away.
2. Goals, profile, equipment, and schedule.
3. Current published programme.
4. Recent sessions and deterministic adherence summary.
5. Current check-ins and metrics.
6. Eligible notes ranked after temporal/supersession filtering.
7. Soft constraints and older summaries while budget remains.

The assembler assigns stable section/citation IDs. Generated factual claims cite these IDs; a
fabricated or missing citation affects grounding evaluation. If hard constraints alone exceed the
model budget, the operation returns a visible `context_hard_constraints_exceed_budget` failure and
does not call the gateway (`AI-002`).

### Pipeline outcomes

- **Gate failure:** persist the item as `blocked`; show the exact failed gates; ordinary approval is
  unavailable.
- **All gates pass, all required judges >= 4:** `clear`.
- **All other valid/evaluated output:** `attention`, including judge score 3 or a new inferred soft
  constraint.
- **Invalid model output:** persist failure evidence, queue nothing.
- **Gateway failure/timeout:** retain the pre-call trace and failed run; retry only according to the
  bounded gateway policy.
- **Persistence failure after generation:** return failure; never publish or partially expose draft
  state. A retry uses the idempotency key/attempt identity.

### Publication states

```text
draft -> queued -> published -> superseded
          └──────-> rejected
```

Only a coach action crosses `queued -> published`. `blocked` is a review band, not a lifecycle state;
it crosses only through override with a reason. Client reads require `status=published`, approval
fields, current/non-superseded state, and effective validity (`FLOW-001`, `FLOW-006`).

## Loop B: daily adjustment

Triggers are a committed session log/check-in plus a deterministic threshold evaluation, or an
explicit coach request.

```text
event/command
  -> determine whether adjustment is warranted (code)
  -> assemble + commit trace
  -> adjustment gateway returns enumerated operations
  -> validate operations
  -> safety gates + judges
  -> queue adjustment
  -> coach edits/approves/rejects/overrides
  -> approval applies operations to a new programme version atomically
```

Allowed structured operations may include `reduce_load`, `reduce_volume`, and
`swap_documented_equivalent`, but **none auto-apply in V1**. Increases and non-enumerated operations
remain blocked. The legacy `auto-apply-scope` gate remains as defense in depth: any V1 output marked
for auto-application fails closed (`FLOW-002`).

An adjustment captures the exact base programme version. If that programme changes before approval,
approval returns `409 stale_adjustment`; it is never silently rebased.

## Loop C: accountability

### Deterministic signal

The daily job derives the score from stored, explicit inputs:

- planned versus completed sessions over 7 and 14 days;
- check-in response latency trend;
- days since a synthetic app-open event; and
- RPE drift where sufficient data exists.

The exact formula, thresholds, missing-data behavior, and version are pure domain configuration and
are captured with each score. The agent cannot choose the score or tier.

### State machine

| Tier | Deterministic trigger | Action | Owner |
|---|---|---|---|
| 0 | On track | Silence | none |
| 1 | One missed session | Contextual in-app nudge when cap permits | automation |
| 2 | Two misses or check-in latency doubling | Draft reduced-plan offer for approval | coach review |
| 3 | Adherence below 50% over 14 days or 7 days silent | Coach brief, plan pause, automated silence | coach |
| 4 | 21 days silent | Churn flag; no automated contact | coach |

Transitions are monotonic toward human ownership. New better signals may change the computed tier,
but a coach-owned state does not return to automation without an explicit coach action. Missing or
sparse inputs degrade conservatively and never invent engagement evidence (`FLOW-004`).

### Message suppression

The 48-hour window is rolling and uses the attempted send time from the injected clock. Exactly 48
hours after the prior automated send is eligible; any earlier instant is suppressed. Concurrent
signals lock the same per-client guard, so only one message can win. Suppression is recorded with its
reason for scorecard/diagnostic use (`FLOW-005`).

The accountability agent may draft:

- a tier-1 contextual message referencing a real missed session and stored goal;
- a tier-2 reduced-plan offer; or
- a tier-3 coach context brief.

It cannot send, select/lower tiers, resume automation, or contact tier-4 clients.

## Session and check-in flow

### Incremental session logging

- Accept bounded structured set entries, notes, and RPE through Zod contracts.
- Require the selected session to belong to the requested client and an approved programme.
- Use optimistic versioning/idempotency to prevent duplicate or lost writes.
- Completion is monotonic; a duplicate completion returns the stable existing result.
- Corrections, if supported, are explicit audited revisions rather than invisible overwrites.

### Check-in submission

- Store readiness plus optional bounded free text.
- Red-flag symptom rules route to coach escalation and prohibit an agent coaching response.
- Any inferred constraint remains soft until the coach promotes it.
- The committed check-in becomes eligible for the next context; no asynchronous cache may hide it.

## Trace and scorecard reads

Queue responses carry trace/run IDs and concise findings, not full rendered contexts. The plan page
links to the trace; the trace endpoint returns the selected sections and rendered input after output
validation and redaction. This preserves the two-click audit path without slowing queue reads.

The scorecard aggregates:

- safety pass/block rate by gate;
- judge distributions and calibration metrics;
- clear-band coach edit rate;
- cost per plan; and
- p50/p95 latency by agent and prompt version.

Aggregation never rewrites source runs/evaluations. Derived artifacts record the input run range and
generation version.

## Recorded and live model behavior

### Recorded mode

- Default for `demo`, deterministic tests, and CI.
- Selects a committed recording using stable scenario/input identity.
- Performs the same output validation, gates, judges/recorded judge results, persistence, and review
  behavior as live mode.
- Does not fall back to live calls when a recording is missing.
- Reports missing/mismatched recordings as a deterministic error.

### Live mode

- Enabled only through validated server configuration.
- Generator and judge identifiers must differ.
- Provider SDKs remain inside the live gateway adapter.
- Calls use explicit deadline/abort behavior and bounded retry for retry-safe transport/rate-limit
  failures only.
- Each attempt records trace, prompt hash, provider/model, usage, estimated cost, latency, and error.
- Live evaluation is never silently substituted for deterministic acceptance.

## Job invocation

Next job routes expose:

- `POST /api/v1/jobs/weekly-plan`
- `POST /api/v1/jobs/daily-accountability`

Outside local/demo mode, adapters require `CRON_SECRET` using constant-time comparison. The body and
logical schedule window are validated before invoking the backend job facade. The secret authorizes
infrastructure invocation only and does not establish a user identity (`PRV-006`).

## Failure taxonomy

Stable application error codes include at least:

- `validation_failed`
- `not_found`
- `version_conflict`
- `idempotency_key_reused`
- `operation_in_progress`
- `invalid_state_transition`
- `blocked_requires_override`
- `override_reason_required`
- `stale_adjustment`
- `context_hard_constraints_exceed_budget`
- `model_timeout`
- `model_output_invalid`
- `recording_not_found`
- `non_synthetic_data_prohibited`
- `dependency_unavailable`

Messages are safe and actionable; raw provider/database errors and stack traces never enter the API
envelope (`PRV-004`).

