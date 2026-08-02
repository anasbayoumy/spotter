# System Architecture

## Purpose

Spotter lets one coach supervise a larger client cohort by reviewing exceptions instead of manually
authoring every plan. AI prepares structured drafts; deterministic systems enforce safety and
temporal correctness; the coach retains publication authority.

The V1 architecture optimizes for five outcomes:

1. **Safety:** hard constraints cannot disappear through retrieval or token pressure.
2. **Trust:** every generated item has gates, judge evidence, a review band, and a trace.
3. **Auditability:** the exact inputs, prompt version, output, usage, evaluation, and coach action
   are reconstructable.
4. **Review economics:** blocked and attention work is prioritized; trustworthy clear work is fast.
5. **Operational simplicity:** one server deployable, one database, one repository, and no broker.

## Context diagram

```text
                         ┌──────────────────────────┐
                         │ Coach                    │
                         │ Next.js coach console    │
                         └────────────┬─────────────┘
                                      │ same-origin REST
┌──────────────────────────┐          ▼
│ Client                    │  HTTPS  ┌────────────────────────────────────┐
│ Expo app                  ├────────►│ frontend/                         │
└──────────────────────────┘          │ Next.js UI + /api/v1 adapters     │
                                      └─────────────────┬──────────────────┘
                                                        │ in-process import
                                      ┌─────────────────▼──────────────────┐
                                      │ backend/                          │
                                      │ domain + use cases + adapters     │
                                      │ context + agents + evals + jobs   │
                                      └──────────────┬───────────┬────────┘
                                                     │           │
                              ┌──────────────────────▼──┐   ┌────▼──────────┐
                              │ PostgreSQL + pgvector  │   │ Model provider │
                              │ authoritative state    │   │ or recordings  │
                              └─────────────────────────┘   └───────────────┘
```

The Next.js process is a composition boundary, not a place for business logic. REST adapters obtain
the backend facade from the server-only composition root and translate between HTTP and typed
application results. The backend package never listens on a port and never imports Next.js request
or response types (`SYS-003`, `SYS-004`, `BND-002`).

## Runtime surfaces

### Coach console

- `/queue`: ordered `blocked`, `attention`, then `clear` review groups.
- `/clients/[clientId]`: goals, current constraints, adherence, sessions, programme, and messages.
- `/programmes/[programmeId]`: plan, gates, judges, citations, edit, reject, approve, and override.
- `/traces/[traceId]`: selected records and the exact rendered model context.
- `/scorecard`: safety, calibration, review-band accuracy, cost, and latency.

There is no login route. Server mutations attribute actions to the configured seeded coach, never to
a coach identifier supplied by the browser (`PRV-001`).

### Client application

- `select-client`: explicit demo-only client selection.
- `today`: current approved session and eligible in-app message.
- `session/[sessionId]`: set logging, notes, completion, and RPE.
- `history`: completed/missed sessions and approved programme history.
- `check-in`: readiness and free-text response.

The Expo app talks only to REST. It receives no direct database configuration and no AI/model key.

### REST API

The public API remains JSON REST under `/api/v1`. The URL belongs to the Next.js deployment even
though its behavior is implemented in `backend/`. Versioning is explicit so the Expo binary and web
deployments can evolve independently.

All endpoints return:

```ts
type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  meta: { requestId: string };
};
```

Error details are allow-listed for the public contract. Raw database/model errors remain in redacted
server logs. Mutation request IDs, idempotency keys, actor identity, and clock are passed in an
application `ExecutionContext`; use cases never read them from framework globals.

## Architectural layers

### Domain

Pure TypeScript holds entities, value objects, transition rules, temporal predicates, movement
taxonomy, scoring functions, and safety decisions. It receives time as a value and has no I/O.

Use classes when identity and invariants must remain encapsulated, for example `Programme`,
`AccountabilityState`, and `ConstraintWindow`. Use pure functions for deterministic calculations,
for example `calculateEngagementTier`, `isConstraintActive`, and individual safety gates. “Clean
code” does not mean turning stateless rules into stateful classes.

### Application

One use-case class owns each command/query. It coordinates domain behavior through ports, defines
the transaction boundary, and returns typed results. It does not know HTTP, Drizzle, AI SDK, or
Next.js.

Representative commands are:

- `GenerateProgramme`
- `EditProgrammeProposal`
- `ApproveProgramme`
- `OverrideBlockedProgramme`
- `CompleteSession`
- `GenerateAdjustment`
- `RunAccountabilityForClient`

### Infrastructure

Drizzle repositories, PostgreSQL/PGlite clients, model gateways, prompt storage, structured logger,
and recorded response loader implement application ports. Provider-specific model code exists only
behind `ModelGateway`.

### Delivery

Ultra-thin Next route adapters and scheduled job adapters are the delivery mechanism. They validate
Zod input, construct `ExecutionContext`, call one facade/use case, and map known errors. They
contain no SQL, transactions, prompts, gates, or review-band logic.

## Composition and lifecycle

`backend/src/composition/create-backend.ts` is the only production composition root. It:

1. accepts already validated server configuration;
2. creates database/model/logging adapters;
3. wires ports to use cases;
4. exposes a narrow `BackendFacade`; and
5. owns graceful resource disposal for tests and process shutdown.

The Next runtime memoizes one production facade per server process. Tests create isolated facades
with injected clocks, ID generators, gateways, and databases. No module may create an implicit
database pool or model client at import time.

## Quality attributes

### Correctness before availability

- Unknown movement families fail closed.
- An oversized hard-constraint context fails visibly without invoking a model.
- Invalid model output does not create a reviewable draft.
- Concurrency conflicts return a typed retry/conflict result instead of last-write-wins behavior.

### Performance

- Queue, current-plan, active-constraint, recent-session, message-outbox, and job-run reads use
  explicit indexed query paths.
- List endpoints use bounded cursor pagination; route adapters reject unbounded limits.
- Application use cases avoid N+1 repository calls through purpose-built read models.
- Connection pools are process-bounded and shared through the composition root.
- Large traces are not returned in queue/list responses; they are loaded by trace ID on demand.
- Model work is never performed inside a database transaction.

### Reliability

- Transactions are short and encompass only state that must change atomically.
- Stable idempotency/job keys make retries safe.
- Model timeouts and retry policy are explicit and bounded.
- Automated-message and publication races are decided by PostgreSQL, not memory locks.

### Observability

Structured Pino logs include request/job ID, client handle, use case, duration, outcome, and trace
ID. They exclude contact identity, free-text context, secrets, and raw model prompts. Exact model
context is stored in the protected trace table and displayed through a deliberate trace endpoint.

Every model attempt records prompt version hash, model ID, trace ID, token usage, cost, latency, and
failure. Every evaluation refers to its agent run, and every coach action refers to the affected
version.

## Explicit non-goals

- No login, user sessions, roles, permissions, organizations, tenancy, or billing.
- No public deployment with real health-adjacent data.
- No push, email, SMS, WhatsApp, or wearable integrations.
- No medical diagnosis, medication advice, or biomarker interpretation.
- No autonomous plan publication or V1 adjustment auto-application.
- No general autonomous multi-agent runtime; intent is known from the command/event.
- No independently deployed backend, queue, broker, or worker.
