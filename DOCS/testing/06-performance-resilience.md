# Performance and resilience gates

## Performance method

Performance tests run against production builds and authoritative Docker PostgreSQL after one
warm-up. The evidence records CPU/memory allocation, Docker/Node versions, seed cardinalities,
scenario, duration, and raw percentiles. Three runs are executed; the median run decides the gate.
HTTP budgets exclude external live-model latency and use recorded mode.

The standard load corpus contains 1 coach, 50 clients, 12 weeks of sessions/client, current and
historical programmes, notes/constraints, traces/runs/evals, and all review bands.

| ID             | Blocking budget                                                                               | Workload                                            | Command                 |
| -------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------- |
| `NFR-PERF-001` | Read APIs p95 <=250 ms, p99 <=750 ms, error <1%.                                              | 25 VUs, 5 min, mixed queue/client/today/trace reads | `pnpm test:performance` |
| `NFR-PERF-002` | Non-model mutation APIs p95 <=500 ms, p99 <=1 s, error <1%.                                   | 10 VUs, idempotent logs/check-ins/reviews           | `pnpm test:performance` |
| `NFR-PERF-003` | Recorded single-plan pipeline p95 <=2 s.                                                      | 50 sequential/mixed clients                         | `pnpm test:performance` |
| `NFR-PERF-004` | Fifty-client weekly recorded batch <=90 s with exactly 50 logical outcomes.                   | One scheduled batch plus safe retry                 | `pnpm test:performance` |
| `NFR-PERF-005` | Queue API p95 <=500 ms and uses bounded query count; no per-row N+1.                          | Full 50-client queue                                | `pnpm test:performance` |
| `NFR-PERF-006` | Critical DB queries p95 <=100 ms on the standard corpus.                                      | Explain/analyze + repeated repository calls         | `pnpm test:performance` |
| `NFR-PERF-007` | Coach pages: desktop Lighthouse performance >=90, accessibility >=95, LCP <=2.5 s, CLS <=0.1. | Queue, detail, review, trace                        | `pnpm test:performance` |
| `NFR-PERF-008` | Expo-web client: Lighthouse performance >=85, accessibility >=95, LCP <=2.5 s, CLS <=0.1.     | Today/session/check-in                              | `pnpm test:performance` |
| `NFR-PERF-009` | Five steady-state 50-client batches show no monotonic unbounded heap/handle growth or OOM.    | Backend resource soak                               | `pnpm test:performance` |
| `NFR-PERF-010` | New result does not regress any accepted p95/duration by >10% without approved explanation.   | Baseline comparison                                 | `pnpm test:performance` |

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
