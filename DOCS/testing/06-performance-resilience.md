# Performance and resilience gates

## Performance method

Performance tests run against production builds and authoritative Docker PostgreSQL after one
warm-up. Fresh execution builds all production artifacts, starts PostgreSQL, applies migrations,
inserts and validates the owned corpus, and only then starts the production web container. The
release database deliberately does not receive the demo seed; the standard corpus owns the complete
application dataset. The evidence records CPU/memory allocation, Docker/Node versions, corpus
cardinalities, exact configured/observed one-primary/two-worker topology, scenario, duration, and
raw percentiles. Worker topology is part of the baseline-compatible environment fingerprint. Three
runs are executed; the median run decides the gate. Mixed-load evidence also records latency,
status, transport-error, and validation-error distributions for each exact route, so an aggregate
regression remains attributable without retaining response bodies in memory. HTTP budgets exclude
external live-model latency and use recorded mode. The deciding run is always one real run; metrics
from different runs are never combined into a synthetic result. Timing uses the median run, while
correctness, idempotency, and resource-safety invariants must hold in every run.

The standard load corpus contains 1 coach, 50 clients, 12 weeks of sessions/client, current and
historical programmes, notes/constraints, traces/runs/evals, and all review bands. Before insertion,
the runner snapshots canonical client rows and message-guard ownership and proves every reserved
fixture prefix is empty. Corpus, run-key, and canonical-week cleanup authority are acquired
independently only after that namespace returns exact zero counts; a failed preflight never arms
deletion for the conflicting rows. The fixture is insert-only: it cannot delete message guards or
rewrite an existing client. After measurement, exact run-owned keys/rows and fixture prefixes are
removed, new temporary clients/guards are removed, all ownership counters must be zero, and the
pre-run canonical client and complete message-guard row snapshots must match byte-for-byte after
canonical JSON normalization. Because production evidence tables are append-only, the isolated QA
database cleanup uses the PostgreSQL administrator to disable only the named append-only user
triggers inside one rollback-safe transaction; foreign-key triggers remain active, application
requests never receive this authority, and zero-residue plus snapshot proofs are mandatory after it.
Global cardinalities must also equal the fixture cardinalities, including exactly 50 clients, 650
programmes, 50 queued programmes for 50 unique clients, and 1,800 sessions; reserved-prefix counts
alone cannot hide demo, foreign, or duplicate rows.

Production defaults retain the normal per-minute HTTP limits. Performance containers explicitly set
`SPOTTER_RATE_LIMIT_PROFILE=load_test`; configuration accepts this expansion only when
`APP_ENV=production`, AI is recorded, the no-auth data policy is synthetic-only, and a fresh
`SPOTTER_QA_RUN_ID` exactly matches `SPOTTER_QA_PROJECT=spotter-qa-<run-id>`. Missing, stale,
future-dated, mismatched, or stray QA activation fails startup/request processing closed. No request
header enables or bypasses the profile. The environment evidence records the active profile and QA
binding without making the ephemeral identity part of baseline compatibility. Release measurement
rejects Compose-project, base-URL, and web-port attachment overrides and always builds and owns a
fresh QA project. It requires a clean source tree before build and an exactly matching source
identity after all measurements before writing a candidate or report. Smoke mode may attach to an
explicit QA Compose project, but its execution evidence is labeled `attached-smoke-non-release` and
is never baseline-eligible. Promotion rechecks the current source identity against both recorded
source snapshots.

| ID             | Blocking budget                                                                               | Workload                                            | Command                 |
| -------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------- |
| `NFR-PERF-001` | Read APIs p95 <=250 ms, p99 <=750 ms, error <1%.                                              | 25 VUs, 5 min, mixed queue/client/today/trace reads | `pnpm test:performance` |
| `NFR-PERF-002` | Non-model mutation APIs p95 <=500 ms, p99 <=1 s, error <1%.                                   | 10 VUs, disposable initial writes + exact retries   | `pnpm test:performance` |
| `NFR-PERF-003` | Recorded single-plan pipeline p95 <=2 s.                                                      | 50 sequential/mixed clients                         | `pnpm test:performance` |
| `NFR-PERF-004` | Fifty-client weekly recorded batch <=90 s with exactly 50 logical outcomes.                   | One scheduled batch plus safe retry                 | `pnpm test:performance` |
| `NFR-PERF-005` | Queue API p95 <=500 ms and uses bounded query count; no per-row N+1.                          | Full 50-client queue                                | `pnpm test:performance` |
| `NFR-PERF-006` | Critical DB queries p95 <=100 ms on the standard corpus.                                      | Explain/analyze + repeated repository calls         | `pnpm test:performance` |
| `NFR-PERF-007` | Coach pages: desktop Lighthouse performance >=90, accessibility >=95, LCP <=2.5 s, CLS <=0.1. | Queue, detail, review, trace                        | `pnpm test:performance` |
| `NFR-PERF-008` | Expo-web client: Lighthouse performance >=85, accessibility >=95, LCP <=2.5 s, CLS <=0.1.     | Today/session/check-in                              | `pnpm test:performance` |
| `NFR-PERF-009` | Three five-batch 50-client sequences show bounded heap/resource growth and no OOM.            | Backend resource soak                               | `pnpm test:performance` |
| `NFR-PERF-010` | New result does not regress any accepted p95/duration by >10% without approved explanation.   | Baseline comparison                                 | `pnpm test:performance` |

Mutation evidence times 30 initial writes per run—ten session logs, check-ins, and programme
reviews—separately from one exact retry of each request. Run-scoped rows and keys are removed after
database assertions prove 30 completed idempotency records and exactly ten side effects of each
kind. Each mutation fixture's exact programme/session IDs are preflighted and cleanup authority is
armed before its insertion command can commit or lose transport; a final acquired-fixture sweep and
residue query include those programme IDs. Its disposable queued programme contains a contract-valid
day and prescribed exercise whose identity matches the session actual. Recorded generation uses the
committed recording's canonical week, `2026-08-03`; every single-plan and weekly request asks for
that exact week and proves both response payload dates and exact owned database rows use it.
Independent weekly repetitions remove their exact job/client keys between runs instead of creating
date-wide cleanup authority.

Immediately before weekly measurement, the global active synthetic client ID set must equal the 50
intended corpus identities—not merely contain them. Client and queue reads must contain exactly 50
rows and 50 unique intended identities; every queue row must have `queued` status. Every read,
mutation, single-plan, and weekly response is checked for envelope/schema and route-specific
business ownership; an HTTP 2xx with wrong data is an error. Every single-plan run also proves exact
programmes, clients, recorded agent runs, traces, evaluations, idempotency records, and
requested-week persistence. Weekly evidence requires every response/retry to match exactly one
completed job, 50 generated programmes, 50 recorded runs/traces/evaluated programmes, and 50
completed client idempotency records. Critical DB evidence retains raw `EXPLAIN ANALYZE` output and
validates every repeated production API/repository response.

Every measured Lighthouse navigation includes a custom gatherer/audit in that same report. It proves
the final path and route-specific visible heading/label marker; a separate preflight cannot satisfy
the gate. Each route runs three times and all metrics come from its one real median-performance run.
Resource evidence runs three independent five-batch sequences and samples before, continuously
during, and after every batch so transient peaks cannot disappear between endpoints. Every snapshot
collects unique reports sequentially from exactly one stable cluster primary and worker slots 1 and
2, retains per-process identity/detail, and sums heap, RSS, file descriptors, and active libuv
handles across all three processes. Heap and RSS retain hard ceilings derived from the unchanged
web-container memory allocation; file descriptors and active libuv handles retain explicit hard
caps. Missing/restarted workers, invalid report identity, final/peak/trend growth, failed batch
response/retry or database evidence, unhealthy container state, and OOM state all fail the gate.

`backend/tooling/performance/baseline.json` is only a small index to one canonical immutable
measurement at `DOCS/release/evidence/performance-baseline/measurement-<digest>.json`. The tracked
record contains measured metrics, source/report hashes, clean-tree identity,
approver/timestamp/reason, and a normalized compatible-environment value plus its hash. Every gate
re-reads the record bytes, checks their index hash and canonical serialization, recomputes the
record's environment hash, and compares the current compatible fingerprint. Compatibility is exact
for container CPU/memory allocation, Docker server OS/architecture and major/minor version, Compose
major/minor, Node/pnpm major, exact clustered primary/configured/observed worker topology,
rate-limit profile contract, and the complete corpus evidence. Release ceilings are never a
baseline. A first clean-tree run with all `NFR-PERF-001..009` gates passing writes
`baseline-candidate.json` but deliberately fails `NFR-PERF-010` until the reviewer promotes the
exact final report:

```bash
node backend/tooling/performance/promote-baseline.mjs \
  --report artifacts/verification/<run>/reports/performance/performance-report.json \
  --confirm-source-hash sha256:<reviewed-content-hash> \
  --approved-by <reviewer> \
  --approved-at <canonical-ISO-timestamp> \
  --approval-reason <reviewed-reason>
```

Promotion only accepts a release report beneath `artifacts/verification`, requires cleanup to have
completed, recomputes the candidate, verifies `NFR-PERF-001..009`, and binds the normalized tracked
measurement to the reviewed report/source hashes. The measurement write is create-only and only an
exact byte-for-byte retry may confirm an existing record; a conflicting record is rejected. The
mutable baseline index is replaced atomically, so an interruption after record creation is safely
retryable. Both the immutable record and updated index must be reviewed and committed before
rerunning the release gate.

The key product metric—one coach processing 50 plans in approximately 20 minutes—is reported using a
scripted synthetic review workflow and UI timing. It is observational until a real coach performs
the workflow; automation must not represent it as human validation.

## Resilience scenarios

Fault injection uses Toxiproxy or a purpose-built model gateway. Assertions cover HTTP response,
durable database state, audit evidence, retry result, logs, and recovery.

| ID            | Fault and required behavior                                                                      | Command                                     |
| ------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `NFR-RES-001` | DB unavailable: readiness fails; dependent API returns sanitized 503; no fake success.           | `pnpm test:resilience`                      |
| `NFR-RES-002` | DB latency/connection exhaustion: bounded timeout, no request leak, recovery without restart.    | `pnpm test:resilience`                      |
| `NFR-RES-003` | Model timeout/429/5xx: pre-call trace remains, run records error, no draft publishes.            | `pnpm test:resilience`                      |
| `NFR-RES-004` | Malformed/truncated/extra-field model output is rejected before domain/gates.                    | `pnpm test:resilience`                      |
| `NFR-RES-005` | Judge unavailable: deterministic gates remain authoritative; item cannot be falsely `clear`.     | `pnpm test:resilience`                      |
| `NFR-RES-006` | Fault between publish and supersede/action produces full rollback.                               | `pnpm test:resilience`                      |
| `NFR-RES-007` | Duplicate job after timeout/restart returns one logical run and resumes safely.                  | `pnpm test:resilience`                      |
| `NFR-RES-008` | Web container SIGTERM stops accepting work, drains bounded in-flight work, exits cleanly.        | `pnpm test:resilience`                      |
| `NFR-RES-009` | Web/Postgres restart preserves committed state; migrations are not rerun unsafely.               | `pnpm test:resilience`                      |
| `NFR-RES-010` | Message failure/retry never bypasses 48-hour cap or human ownership.                             | `pnpm test:resilience`                      |
| `NFR-RES-011` | Browser/client loses connection during mutation: input retained and same idempotency key reused. | `pnpm test:e2e:web && pnpm test:e2e:client` |
| `NFR-RES-012` | Corrupt/missing recorded fixture fails visibly; no fallback to live network.                     | `pnpm test:resilience`                      |
| `NFR-RES-013` | Health endpoints recover within 60 s after dependency restoration.                               | `pnpm test:resilience`                      |
| `NFR-RES-014` | Logs contain no unhandled rejection/panic and correlate all induced failures by request ID.      | `pnpm test:resilience`                      |

Automatic retries are bounded, jittered where appropriate, and limited to operations proven safe by
idempotency. Validation, invariant, and blocked-safety failures are never retried.
