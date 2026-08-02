# API, Use Cases, and Error Contract

## 1. Boundary rules

- All product HTTP endpoints are JSON REST under `/api/v1`.
- Next.js route handlers in `frontend` are adapters: parse, validate, call exactly one backend use
  case, and map its result. They contain no business rule, SQL, or model call.
- Requests and responses use shared versioned Zod contracts.
- Every response has `{ data, error, meta }`; exactly one of `data` or `error` is non-null.
- `meta.requestId` is always present. List responses also include pagination/filter metadata when
  applicable.
- Mutations require or accept a documented `Idempotency-Key`; job routes additionally use stable run
  keys. Identical retries return the original status and body. Reusing a key with a different
  normalized payload returns `409 IDEMPOTENCY_KEY_REUSED`.
- IDs are UUIDs. Times are ISO-8601 UTC instants; client-local dates are `YYYY-MM-DD` plus an IANA
  timezone in the relevant state.
- The server resolves the seeded coach. Coach IDs supplied by a caller are rejected or ignored by
  contract rather than trusted.

## 2. Endpoint and use-case inventory

### Clients and context

| Endpoint                                 | Backend use case     | Product result                                                                    |
| ---------------------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| `GET /api/v1/clients`                    | `ListDemoClients`    | Active synthetic demo clients for coach/selector views.                           |
| `GET /api/v1/clients/:clientId`          | `GetClientDetail`    | Profile, active constraints, adherence, sessions, programme, check-ins, messages. |
| `GET /api/v1/clients/:clientId/today`    | `GetClientToday`     | Only current published programme/session and allowed outstanding message.         |
| `GET /api/v1/clients/:clientId/messages` | `ListClientMessages` | In-app outbox items visible to the selected client.                               |

### Programmes

| Endpoint                                         | Backend use case           | Product result                                                      |
| ------------------------------------------------ | -------------------------- | ------------------------------------------------------------------- |
| `GET /api/v1/programmes?clientId=&status=&band=` | `ListProgrammes`           | Validated, bounded review/history query.                            |
| `GET /api/v1/programmes/:programmeId`            | `GetProgrammeReview`       | Payload, lifecycle, gates, judges, actions, run and trace link.     |
| `POST /api/v1/programmes/generate`               | `GenerateProgramme`        | Idempotently assemble, trace, generate, evaluate, and queue.        |
| `PATCH /api/v1/programmes/:programmeId`          | `EditProgrammeProposal`    | Record diff and revalidate/re-gate an editable proposal.            |
| `POST /api/v1/programmes/:programmeId/approve`   | `ApproveProgramme`         | Publish a non-blocked current proposal transactionally.             |
| `POST /api/v1/programmes/:programmeId/reject`    | `RejectProgramme`          | Record rejection; proposal remains historical and client-invisible. |
| `POST /api/v1/programmes/:programmeId/override`  | `OverrideBlockedProgramme` | Require reason, record override, publish transactionally.           |

Generation input identifies client and target week/date. It cannot accept caller-provided context,
gate outcomes, band, model output, approver, or publication state.

### Sessions and check-ins

| Endpoint                                    | Backend use case  | Product result                                                         |
| ------------------------------------------- | ----------------- | ---------------------------------------------------------------------- |
| `GET /api/v1/sessions?clientId=&from=&to=`  | `ListSessions`    | Bounded client/date query in stable chronological order.               |
| `GET /api/v1/sessions/:sessionId`           | `GetSession`      | Approved planned work and stored actual work.                          |
| `POST /api/v1/sessions/:sessionId/log`      | `LogSessionWork`  | Idempotently store validated set-by-set actual work/notes.             |
| `POST /api/v1/sessions/:sessionId/complete` | `CompleteSession` | Idempotently mark performed time/RPE and evaluate adjustment trigger.  |
| `POST /api/v1/check-ins`                    | `CreateCheckIn`   | Store readiness/text, red-flag route, and evaluate adjustment trigger. |

Logging/completion is permitted only for a session belonging to the selected client context and a
published programme version. Completion may not be moved backward by an ordinary retry.

### Adjustments and accountability

| Endpoint                                          | Backend use case             | Product result                                                           |
| ------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `POST /api/v1/adjustments/generate`               | `GenerateAdjustment`         | Idempotently draft/evaluate a proposal against current context.          |
| `GET /api/v1/adjustments?clientId=&status=`       | `ListAdjustments`            | Bounded proposal/history query.                                          |
| `PATCH /api/v1/adjustments/:adjustmentId`         | `EditAdjustmentProposal`     | Version and audit an allowed pending operation list without applying it. |
| `POST /api/v1/adjustments/:adjustmentId/approve`  | `ApproveAdjustment`          | Publish a safe new coach-approved programme version.                     |
| `POST /api/v1/adjustments/:adjustmentId/override` | `OverrideBlockedAdjustment`  | Require a reason and publish only an explicitly blocked adjustment.      |
| `POST /api/v1/adjustments/:adjustmentId/reject`   | `RejectAdjustment`           | Record rejection without changing the current programme.                 |
| `GET /api/v1/accountability/:clientId`            | `GetAccountabilityState`     | Latest score evidence, tier, owner, messages/tasks, history summary.     |
| `POST /api/v1/accountability/run`                 | `RunAccountabilityForClient` | Idempotently score, transition, suppress/send/draft as policy requires.  |

Approval fails if the adjustment was generated from a programme that is no longer current. Ordinary
approval also fails closed for a blocked review band; only the explicit reasoned override endpoint
may publish it. There is no `autoApply` input or endpoint in V1.

### Traces and jobs

| Endpoint                                 | Backend use case            | Product result                                                  |
| ---------------------------------------- | --------------------------- | --------------------------------------------------------------- |
| `GET /api/v1/traces/:traceId`            | `GetContextTrace`           | Exact safe trace, selected sections, budget and run metadata.   |
| `POST /api/v1/jobs/weekly-plan`          | `RunWeeklyPlanJob`          | One idempotent programme-generation run per active client/week. |
| `POST /api/v1/jobs/daily-accountability` | `RunDailyAccountabilityJob` | One idempotent daily sweep per client-local date/run key.       |

Outside demo mode, job routes require a valid `CRON_SECRET`. This protects infrastructure triggers;
it is not user authentication. A missing/mismatched secret returns a generic error without revealing
whether another submitted value was close.

## 3. Error envelope and status mapping

```json
{
  "data": null,
  "error": {
    "code": "PROGRAMME_BLOCKED",
    "message": "This programme requires an override before publication.",
    "details": { "failedGateIds": ["..."] }
  },
  "meta": { "requestId": "..." }
}
```

`details` is optional, structured, bounded, and safe for the caller. It never includes stack traces,
SQL, secrets, full prompt content, hidden model reasoning, or provider response bodies.

| HTTP | Error category                                                   | Example codes                                                            |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 400  | Malformed or schema-invalid input/query                          | `VALIDATION_FAILED`, `INVALID_DATE_RANGE`                                |
| 401  | Invalid cron infrastructure secret only                          | `INVALID_CRON_SECRET`                                                    |
| 404  | Resource does not exist in demo scope                            | `CLIENT_NOT_FOUND`, `PROGRAMME_NOT_FOUND`                                |
| 409  | Idempotency, concurrency, stale reference, or lifecycle conflict | `IDEMPOTENCY_KEY_REUSED`, `STALE_PROGRAMME`, `INVALID_TRANSITION`        |
| 422  | Valid command rejected by a domain/safety rule                   | `PROGRAMME_BLOCKED`, `CONTEXT_BUDGET_EXCEEDED`, `UNSUPPORTED_ADJUSTMENT` |
| 429  | Explicit bounded-resource protection                             | `RATE_LIMITED`                                                           |
| 500  | Unexpected internal failure with sanitized response              | `INTERNAL_ERROR`                                                         |
| 503  | Required database/model/provider temporarily unavailable         | `DEPENDENCY_UNAVAILABLE`, `MODEL_RUN_FAILED`                             |

Recorded-mode missing recordings are deterministic configuration/test failures. In the UI they map
to a clear service failure; they may not silently fall back to a live provider.

## 4. Edge and error-state catalogue

### Identity and selection

- Unknown/malformed client ID: `400` for malformed UUID, `404` for absent UUID.
- Paused/churned client: readable in coach history but cannot receive a new programme/message; the
  client selector returns to a valid active selection.
- Caller supplies coach attribution: server uses seeded actor and does not accept spoofing.

### Time and temporal data

- Constraint at `valid_from`: active inclusively.
- Constraint at `valid_until`: expired at that instant; use half-open `[valid_from, valid_until)`.
- Superseded record with high relevance: excluded before ranking.
- Future session: never missed.
- DST gap/fold: due-date policy uses IANA timezone/date semantics, not a fixed offset.
- Client timezone missing/invalid: seed/contract validation fails; no silent server-time fallback.

### Context and models

- Hard constraints exceed budget: persist assembly failure/trace evidence and do not call model.
- Optional context exceeds budget: evict only according to canonical priority, deterministically.
- Missing or malformed recorded response: fail visibly; do not invent or use live mode.
- Model timeout/provider error: retain pre-call trace and failed agent run; no proposal publication.
- Invalid structured output/citation: reject or band per evaluation contract; never coerce arbitrary
  prose into a valid plan.
- Generator and judge model identifiers equal in live mode: fail before calls.

### Programme lifecycle

- Generate retry: one logical proposal/run result.
- Two concurrent generations for client/week: idempotency/uniqueness prevents duplicate current
  actionable versions.
- Approve blocked through normal endpoint: `422 PROGRAMME_BLOCKED`.
- Override blank/whitespace reason: `400 VALIDATION_FAILED`.
- Approve rejected/superseded/already stale proposal: `409 INVALID_TRANSITION`.
- Concurrent approvals: at most one current published client/week programme.
- Edit published programme: create a new proposal/version; never mutate historical payload.
- Failure during publish/supersede/session creation: entire transaction rolls back.

### Sessions and check-ins

- Out-of-range/NaN/infinite/negative set, rep, load, readiness, or RPE values: validation failure.
- Oversized notes/check-in text or collections: bounded validation failure.
- Session log retry: no duplicate actual sets/events.
- Complete retry: performed timestamp is stable and trigger is not duplicated.
- Session from non-published/stale programme: conflict; preserve client-side draft.
- Red-flag check-in: coach escalation, no coaching model call, no diagnosis in response.
- Sparse check-in history: latency trend signal omitted, not fabricated.

### Adjustments

- Proposed increase, unknown operation, or undocumented swap: blocked/rejected.
- Safe-looking reduction contradicts hard constraint: blocked.
- Duplicate trigger event: reuse the existing proposal.
- Base programme superseded before approval: stale conflict and regenerate.
- Approval transaction fails: current programme remains unchanged.

### Accountability and messages

- Multiple triggers: highest tier wins.
- Multiple sweeps/retries: one score/state/message outcome for the stable run key.
- Message at 47:59:59 since last automated send: suppressed.
- Message at exactly 48:00:00: allowed if current tier permits.
- Simultaneous signals: transaction/constraint permits at most one automated send in window.
- Tier 3/4 with queued automated draft: cancel/suppress it; no delivery.
- Lower computed tier after human ownership: do not auto-release ownership.
- No missed sessions/history: Tier 0 unless an independent valid trigger exists.

### UI and network

- Empty data sets produce explicit empty states, never crashes or misleading zero metrics.
- Request timeout/offline: retryable message with request ID when available; forms keep entered
  data.
- Double-click/repeated tap: disabled in flight and safe server idempotency.
- Stale client cache after publication: invalidate/refetch current programme and Today.
- Direct navigation to missing/stale ID: accessible not-found state with safe navigation.

### Privacy and operations

- Logs redact authorization/cron secrets, API keys, check-in text, session notes, prompts, and
  contact identity; use handles and trace/request IDs.
- Trace responses exclude identity/contact data even if malformed source data contains it.
- Database errors do not return SQL/schema details.
- Docker tests use only project-scoped database/container resources.
- Jobs recover from partial prior runs using stable run records, without duplicating side effects.
