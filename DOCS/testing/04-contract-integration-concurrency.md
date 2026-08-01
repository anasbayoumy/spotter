# Contract, integration, and concurrency gates

## HTTP contract

All `/api/v1` adapters are ultra-thin Next.js handlers. Shared Zod contracts own request, domain
payload, response, and error shapes. Every response is `{ data, error, meta }`; `meta.requestId` is
always present. Mutations require an idempotency key. Unknown input fields are rejected unless a
schema explicitly declares forward-compatible passthrough.

`pnpm test:contract` exercises the following endpoint inventory through real route adapters:

- `GET /clients`, `/clients/:id`, `/clients/:id/today`, `/clients/:id/messages`
- `GET /programmes`, `/programmes/:id`; `POST /programmes/generate`
- `PATCH /programmes/:id`; `POST /programmes/:id/{approve,reject,override}`
- `GET /sessions`, `/sessions/:id`; `POST /sessions/:id/{log,complete}`
- `POST /check-ins`
- `POST /adjustments/generate`; `GET /adjustments`; `POST /adjustments/:id/{approve,reject}`
- `GET /accountability/:clientId`; `POST /accountability/run`
- `GET /traces/:id`; `POST /jobs/{weekly-plan,daily-accountability}`
- `/health/live` and `/health/ready`

| ID | Blocking contract | Command |
|---|---|---|
| `QA-API-001` | Every endpoint validates path, query, headers, and body at runtime. | `pnpm test:contract` |
| `QA-API-002` | Every success and error matches the shared envelope and response schema. | `pnpm test:contract` |
| `QA-API-003` | Status mapping distinguishes 400, 404, 409, 422, 429, 503, and unexpected 500. | `pnpm test:contract` |
| `QA-API-004` | Error responses expose stable codes/request IDs, never stack traces or secrets. | `pnpm test:contract && pnpm test:security` |
| `QA-API-005` | Consumer tests prove coach and client API clients decode the provider contract. | `pnpm test:contract` |
| `QA-API-006` | Invalid UUID, enum, date, timezone, numeric boundary, extra field, and oversized payload cases fail safely. | `pnpm test:contract` |
| `QA-API-007` | Idempotency replays return the original logical result; key reuse with different input is 409. | `pnpm test:contract` |
| `QA-API-008` | Request IDs propagate through logs, use cases, traces, actions, and job records. | `pnpm test:integration` |
| `QA-API-009` | Blocked approval returns conflict; override requires a nonblank reason. | `pnpm test:contract` |
| `QA-API-010` | The client Today/messages APIs expose only approved/current/eligible records. | `pnpm test:contract` |
| `QA-API-011` | Cursor/filter behavior is deterministic, bounded, and stable under equal timestamps. | `pnpm test:contract` |
| `QA-API-012` | Cron routes reject missing/wrong secret outside demo and accept constant-time verified secret. | `pnpm test:contract && pnpm test:security` |
| `QA-API-013` | Health liveness does not depend on DB; readiness fails when required dependencies are unavailable. | `pnpm test:resilience` |
| `QA-API-014` | OpenAPI/contract snapshot generation is reproducible and contains every endpoint. | `pnpm verify:generated` |

## Database and repository integration

The same repository conformance suite runs against PGlite and Docker PostgreSQL. PostgreSQL owns
the release verdict; known PGlite deviations must be explicit and may not cover Tier A behavior.

| ID | Blocking invariant | Command |
|---|---|---|
| `QA-DB-001` | Fresh committed migrations apply to empty PostgreSQL 16 + pgvector. | `pnpm test:integration` |
| `QA-DB-002` | Seed is synthetic, deterministic, and idempotent. | `pnpm test:integration` |
| `QA-DB-003` | Required FKs, checks, enums, partial unique indexes, and timestamps are enforced by DB. | `pnpm test:integration` |
| `QA-DB-004` | Published programme requires approver/approval time; blocked publish requires override reason. | `pnpm test:integration` |
| `QA-DB-005` | One current published programme exists per client/week and supersession is atomic. | `pnpm test:integration` |
| `QA-DB-006` | Published edits create versions; history is never changed in place. | `pnpm test:integration` |
| `QA-DB-007` | Active-window semantics are `valid_from <= asOf` and `valid_until IS NULL OR > asOf`. | `pnpm test:integration` |
| `QA-DB-008` | Superseded records are excluded before note/vector ranking. | `pnpm test:integration` |
| `QA-DB-009` | Context trace commits before model invocation and survives model failure. | `pnpm test:integration` |
| `QA-DB-010` | Agent/eval/action/job audit records are complete and reference valid traces/runs. | `pnpm test:integration` |
| `QA-DB-011` | UTC storage plus IANA scheduling works across midnight and DST transitions. | `pnpm test:integration` |
| `QA-DB-012` | pgvector extension/index exists and retrieval remains client-scoped. | `pnpm test:integration` |
| `QA-DB-013` | Engagement scores are append-only; accountability state transitions follow ownership rules. | `pnpm test:integration` |
| `QA-DB-014` | Message suppression is enforced transactionally, not only by a pre-check. | `pnpm test:integration` |
| `QA-DB-015` | PGlite and PostgreSQL return conformant domain results for the shared parity corpus. | `pnpm test:integration:pglite && pnpm test:integration` |
| `QA-DB-016` | Failed application transactions leave no partial programme, action, message, or supersession. | `pnpm test:integration` |

## Concurrency and replay

Tests use barriers so requests reach the critical section together; sequential duplicate calls are
not sufficient proof. PostgreSQL tests repeat each race enough to expose timing defects and report
all transaction outcomes.

| ID | Race/replay scenario | Required result | Command |
|---|---|---|---|
| `QA-CON-001` | Two approvals of the same draft | One publication/action; other returns idempotent result/conflict | `pnpm test:concurrency` |
| `QA-CON-002` | Two different drafts publish for same client/week | One current programme; loser rolls back cleanly | `pnpm test:concurrency` |
| `QA-CON-003` | Edit races with approval using stale version | Optimistic conflict; no lost update | `pnpm test:concurrency` |
| `QA-CON-004` | Same generation idempotency key concurrently | One trace/run/draft logical result | `pnpm test:concurrency` |
| `QA-CON-005` | Same weekly/daily job run key concurrently | One job execution and stable replay response | `pnpm test:concurrency` |
| `QA-CON-006` | Multiple accountability signals create nudges | At most one automated message per 48-hour window | `pnpm test:concurrency` |
| `QA-CON-007` | Session completion/log retry | No duplicated sets, completion, or adjustment trigger | `pnpm test:concurrency` |
| `QA-CON-008` | Coach escalation races automated tier processing | Human ownership wins; automation cannot lower/re-engage | `pnpm test:concurrency` |
| `QA-CON-009` | Override request replays after connection loss | Same published version and one reasoned action | `pnpm test:concurrency` |

## Failure assertions

Tests assert both response and durable state. A correct 409 with corrupted rows is a failure. For
every transaction fault, verify affected rows, current programme, outbox/messages, action log,
trace/run records, and retry outcome. Integration logs must contain request/trace handles but no raw
check-in text, client identity, secret, or stack trace in the HTTP response.
