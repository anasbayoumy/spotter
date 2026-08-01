# Atomic V1 Requirements

Normative terms **must**, **must not**, and **may** have their usual specification meaning. Every
requirement below is independently testable. IDs are stable and must be referenced by code-facing
acceptance tests or the traceability matrix.

## Scope and architecture

- **SCP-001** — The implementation must live entirely under `/Users/anas/franz-agents/app`.
- **SCP-002** — V1 must provide `frontend`, server-only modular `backend`, and `client-frontend`
  boundaries in one pnpm TypeScript workspace.
- **SCP-003** — V1 must have no login, signup, user session, password, role, permission, organisation,
  billing, or production-notification feature.
- **SCP-004** — The coach web/API must remain one deployable; the backend modules must not become a
  separately networked service.
- **SCP-005** — Frontends must call versioned REST contracts and must not query the database or call
  a model directly.
- **SCP-006** — Domain logic must remain independent of React, Next.js, Expo, database drivers, and
  model SDKs.
- **SCP-007** — Thin HTTP adapters must validate, invoke one use case, and map its result without
  containing business rules.

## Demo actors and data

- **DEM-001** — The server must resolve one seeded coach from `DEMO_COACH_ID` for every coach action.
- **DEM-002** — The client selector must expose only seeded synthetic active clients and must be
  described as demo selection, not authentication.
- **DEM-003** — Committed fixtures, traces, recordings, logs, screenshots, and databases must contain
  no real client identity, contact, health, or training data.
- **DEM-004** — `pnpm demo` must migrate, idempotently seed, and run the functional system with
  PGlite, recorded AI, no Docker, and no model key.
- **DEM-005** — Recorded and live model modes must implement the same structured gateway contract;
  recorded mode must never silently call a live provider.
- **DEM-006** — Seed data must cover healthy, active-hard-constraint, expired-constraint,
  superseded-record, sparse-history, disengaged, and adjustment-trigger scenarios.
- **DEM-007** — Repeated seed execution must preserve stable logical state without duplicate active
  rows.

## Data and time invariants

- **DAT-001** — All persisted identifiers must be UUIDs, all instants UTC `timestamptz`, and local
  scheduling must use the client's validated IANA timezone.
- **DAT-002** — Validity windows must use half-open semantics: active at `valid_from` and inactive at
  `valid_until`.
- **DAT-003** — Current retrieval must exclude expired and superseded records before relevance or
  recency ranking.
- **DAT-004** — Programme, note, score, trace, run, evaluation, coach-action, and job evidence must be
  versioned/append-only or superseded, not destructively overwritten.
- **DAT-005** — Database constraints/transactions must enforce one current published programme per
  client/week and human approval on every published programme.
- **DAT-006** — Publishing must atomically approve the new version, supersede the prior current
  version, create non-duplicate sessions, and record the coach action.
- **DAT-007** — Mutations and jobs must be idempotent; a key replay with a different payload must be
  rejected.
- **DAT-008** — Concurrent generation, approval, message, and job attempts must not duplicate their
  single logical side effects.

## Context and agent runtime

- **CTX-001** — Intent selection and context assembly must be deterministic code, never a model.
- **CTX-002** — Context order must be active hard constraints; goal/profile/equipment/schedule;
  current programme; recent sessions/adherence; check-ins/metrics; valid ranked notes; then optional
  soft/older material.
- **CTX-003** — Every active hard constraint must be pinned and exempt from ordinary token eviction.
- **CTX-004** — If pinned constraints alone exceed the budget, generation must fail visibly without
  a model call.
- **CTX-005** — Context selection/rendering must be deterministic for the same records, instant,
  configuration, and intent.
- **CTX-006** — A context trace must be committed before every attempted model call and must capture
  selected record IDs/versions, exact rendered input, token estimate, budget, intent, and client.
- **CTX-007** — The programme agent must return a schema-valid weekly programme with citations to
  real context sections.
- **CTX-008** — The adjustment agent must return only enumerated operations supported by the V1
  contract.
- **CTX-009** — The accountability agent may draft copy or a brief but must not select tier,
  ownership, recipient, suppression, or delivery.
- **CTX-010** — Each attempted agent run must record agent, model, prompt version hash, trace ID,
  usage, cost, latency, output or sanitized error.
- **CTX-011** — Live configuration must reject identical generator and judge model identifiers
  before either model is called.

## Safety and review

- **SAF-001** — Deterministic binary gates must cover forbidden movement family/aliases, unknown
  family, volume spike, intensity ceiling, frequency breach, adjustment operation scope, 48-hour
  nudge rate, and deterministic medical-language patterns.
- **SAF-002** — Unknown movement families must fail closed.
- **SAF-003** — Any blocking gate failure must set review band `blocked`; no judge may weaken it.
- **SAF-004** — A proposal may be `clear` only when all gates pass and every required judge score is
  at least 4; other valid output must be `attention`.
- **SAF-005** — Grounding, coherence, consistency, and intervention judges must have independent
  rubrics and see output, trace, and fixture but not hidden generator reasoning.
- **SAF-006** — A normal approval must reject a blocked programme; override must require a non-blank
  written reason and record it.
- **SAF-007** — Red-flag input must create human escalation without invoking a programme or
  adjustment coaching agent.
- **SAF-008** — Outputs that diagnose, name a condition as fact, or advise on medication must be
  blocked.
- **SAF-009** — Inferred constraints must remain soft until explicit coach promotion; an agent must
  not create or expire a hard constraint.
- **SAF-010** — Safety fixtures pass when expected-safe output passes or expected-unsafe output is
  correctly blocked; adversarial blocks must not be reported as suite failures.

## Plan loop

- **PLN-001** — A valid demo command/job must generate one idempotent programme proposal for
  an active client/target week through trace, model, validation, gates, judges, band, and queue.
- **PLN-002** — Queue ordering must be blocked, attention, clear; within a band it must be oldest
  queued first with a stable tie-breaker.
- **PLN-003** — Programme review must show payload, lifecycle, gate results, judge results, citations,
  run metadata, and a trace link.
- **PLN-004** — Editing a proposal must record a structured diff and rerun structured validation and
  deterministic gates before approval.
- **PLN-005** — Rejecting a programme must record the action, make the proposal non-actionable, and
  never expose it to the client.
- **PLN-006** — Approving a non-blocked proposal must publish it transactionally and attribute it to
  the seeded coach.
- **PLN-007** — Overriding a blocked proposal must record the written reason and otherwise use the
  same publication transaction.
- **PLN-008** — Editing already-published content must create a new proposal/version rather than
  changing historical content in place.
- **PLN-009** — Failed assembly, generation, validation, evaluation, or publication must leave the
  prior published programme unchanged and expose no incomplete version to the client.

## Session, check-in, and adjustment loop

- **ADJ-001** — The client must be able to idempotently log structured sets/reps/load/notes and
  complete a published-programme session with validated RPE.
- **ADJ-002** — The client must be able to idempotently submit readiness 1–5 and bounded free text.
- **ADJ-003** — Completed logs and check-ins must appear in coach detail and the next assembled
  context.
- **ADJ-004** — A deterministic adjustment candidate must trigger for readiness at most 2, RPE at
  least 9, or completed working sets at most 70% of planned sets.
- **ADJ-005** — One source event must create at most one active adjustment proposal.
- **ADJ-006** — V1 adjustment operations must be limited to load reduction, volume reduction, or a
  swap to a documented equivalent; increases and unknown operations must be blocked.
- **ADJ-007** — Every adjustment must remain client-invisible and unapplied until coach approval.
- **ADJ-008** — Approval must reject an adjustment whose base programme is no longer current.
- **ADJ-009** — Safe adjustment approval must create and publish a new programme version through the
  same human-approval and safety invariants as Plan.
- **ADJ-010** — Retried logs, completions, check-ins, generation, and approval must not duplicate
  actual work, events, proposals, versions, or actions.

## Accountability loop

- **ACC-001** — A daily/idempotent run must append deterministic score inputs and calculate the
  highest matching accountability tier for every active client in scope.
- **ACC-002** — Tier 0 must produce no message or task.
- **ACC-003** — Tier 1 must require exactly one missed due session in seven days and must create a
  contextual in-app nudge only when suppression permits.
- **ACC-004** — Tier 2 must require at least two missed due sessions in 14 days or check-in latency at
  least twice a valid baseline and must create a reduced-plan offer for coach approval.
- **ACC-005** — Tier 3 must require at least seven full days silent or adherence below 50% over 14
  days with at least two due sessions; it must assign coach ownership and pause automation.
- **ACC-006** — Tier 4 must require at least 21 full days silent; it must create a churn flag and
  prohibit automated contact.
- **ACC-007** — Automated contact must be suppressed when the prior automated send was less than 48
  elapsed hours earlier and may resume at exactly 48 hours if the tier permits.
- **ACC-008** — Suppression attempts must be stored with reason/time for audit.
- **ACC-009** — A coach-owned escalation must not return to automated ownership without a recorded
  coach action.
- **ACC-010** — Sparse app/check-in/session history must omit unavailable signals rather than invent
  inputs or escalating solely because data is absent.

## Coach frontend

- **CUI-001** — `/` must redirect to `/queue`; the frontend must contain no login route or auth
  prompt and must clearly label demo mode.
- **CUI-002** — Queue must present accessible, counted, priority-ordered blocked/attention/clear
  groups and specific findings, including useful empty/loading/error states.
- **CUI-003** — Client detail must show goals, profile, active constraints, adherence, current
  programme, sessions, check-ins, and messages without treating expired constraints as active.
- **CUI-004** — Programme review must implement edit, approve, reject, and reason-required override
  with disabled/in-flight/conflict states and retained input on recoverable failure.
- **CUI-005** — A plan must link to a trace in no more than two navigation actions, and trace view
  must identify pinned constraints and exact rendered input without PII/secrets.
- **CUI-006** — Scorecard must distinguish unavailable, recorded, and live measurements and show the
  documented safety, judge, calibration, band accuracy, cost, and latency dimensions.
- **CUI-007** — Coach pages must support keyboard operation, visible focus, semantic structure,
  accessible status communication, and responsive narrow/desktop layouts.

## Client frontend

- **MUI-001** — Demo client selection must persist locally, recover from an invalid selection, and
  never imply authenticated identity.
- **MUI-002** — Today must derive exclusively from the selected client's current published programme
  and local date; no other lifecycle state may be rendered.
- **MUI-003** — Today must distinguish no programme, rest day, upcoming session, completed session,
  loading, and failure states.
- **MUI-004** — Session logging must validate ranges, prevent accidental duplicate submission,
  preserve input on conflict/failure, and show completed work in History.
- **MUI-005** — History must order completed/missed sessions deterministically and never mark a
  future session missed.
- **MUI-006** — Check-in must validate readiness/text, handle idempotent retry, avoid promises of
  automatic change, and route red flags without medical advice.
- **MUI-007** — Client messaging must show only currently allowed in-app outbox content and no
  automated message while Tier 3/4 or churn state prohibits it.
- **MUI-008** — Client screens must provide accessible loading, empty, validation, conflict, and
  server/offline error states.

## API, observability, security, and operations

- **OPS-001** — Every API endpoint listed in `api-and-errors.md` must exist and use shared validated
  input/output contracts and the common `{data,error,meta}` envelope.
- **OPS-002** — Every response must include a request ID; safe UI errors must expose it where useful.
- **OPS-003** — API errors must use the documented status/code categories and must not leak stacks,
  SQL, prompt internals, hidden reasoning, provider bodies, or secrets.
- **OPS-004** — Job endpoints must require `CRON_SECRET` outside demo mode and must be idempotent by
  stable run key.
- **OPS-005** — Logs must be structured and redact API/cron secrets, identity/contact data,
  check-in/session free text, and prompt bodies; logs should use handles and request/trace IDs.
- **OPS-006** — Scorecard aggregation must calculate safety rate by gate, judge distributions,
  calibration, band accuracy, cost per published plan, and p50/p95 latency without presenting absent
  data as zero.
- **OPS-007** — PGlite and Docker PostgreSQL 16/pgvector must apply the same committed migrations and
  preserve equivalent domain invariants.
- **OPS-008** — Environment variables must be parsed once through a strict schema and server secrets
  must never be exported through public-prefixed variables.
- **OPS-009** — All bounded text, numeric, array, pagination, and date-range inputs must reject
  invalid or resource-exhausting values before domain execution.
- **OPS-010** — The final implementation must provide executable commands for install, demo,
  migrate, seed, format, lint, typecheck, unit/integration tests, safety tests, web/mobile acceptance,
  evaluation/calibration, and builds.
