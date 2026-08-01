# Architectural Requirements

These IDs are stable acceptance criteria. Each `Verification` entry names the minimum evidence; the
testing specification may add broader coverage.

## System and deployment

| ID        | Requirement                                                                                                                                 | Verification                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `SYS-001` | All implementation, tests, infrastructure, fixtures, and canonical implementation documentation live under `/Users/anas/franz-agents/app`.  | Repository boundary test and CI working-directory check. |
| `SYS-002` | The only top-level application folders are `frontend/`, `backend/`, and `client-frontend/`.                                                 | Repository structure test.                               |
| `SYS-003` | `frontend/` is the single server deployable. It contains the coach console and `/api/v1` Next.js route adapters.                            | Build manifest and Docker topology test.                 |
| `SYS-004` | `backend/` is a server-only modular workspace package imported by Next.js route adapters; it exposes no listener and starts no HTTP server. | Dependency test and absence-of-listener test.            |
| `SYS-005` | `client-frontend/` is an Expo application that uses the same versioned JSON REST API as the coach console.                                  | Contract and mobile E2E tests.                           |
| `SYS-006` | V1 uses one PostgreSQL database and introduces no Redis, message broker, or independent worker service.                                     | Compose configuration test.                              |

## Boundaries and contracts

| ID        | Requirement                                                                                                                                                    | Verification                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `BND-001` | React/Next/Expo presentation code cannot import database, agent, evaluation, or backend infrastructure modules.                                                | ESLint/import-boundary test.                    |
| `BND-002` | Next route adapters only validate/normalize HTTP input, establish request metadata, invoke one backend facade/use case, and map the typed result to HTTP.      | Adapter unit tests and architecture lint.       |
| `BND-003` | Backend domain code imports no Next.js, React, Expo, database driver, model SDK, environment global, or wall clock.                                            | Dependency-cruiser or equivalent boundary test. |
| `BND-004` | Shared contracts are Zod schemas for JSON-safe requests, responses, model outputs, and error envelopes; contracts contain no persistence or business behavior. | Package dependency and schema tests.            |
| `BND-005` | Every REST response follows `{ data, error, meta }`; `meta` contains a request ID, and every input/output boundary is validated.                               | API contract tests.                             |
| `BND-006` | Retryable mutating endpoints require an idempotency key and return the original stable result for a completed duplicate.                                       | Concurrent integration tests.                   |
| `BND-007` | Backend server-only entry points fail a client-bundle build if imported into browser or Expo code.                                                             | Negative bundle/import test.                    |

## Data and temporal correctness

| ID        | Requirement                                                                                                                                                              | Verification                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `DAT-001` | PostgreSQL 16 with pgvector and committed Drizzle SQL migrations is the authoritative database behavior for integration and release acceptance.                          | Docker PostgreSQL migration/integration suite.       |
| `DAT-002` | PGlite supports the keyless demo and fast isolated tests, and must pass the defined parity suite; it cannot be the sole evidence for a release.                          | Cross-adapter parity tests.                          |
| `DAT-003` | Domain history is append-only or superseded. Published plans, coach actions, engagement scores, agent runs, traces, and evaluations are not updated destructively.       | Repository tests and database constraints.           |
| `DAT-004` | Active temporal data satisfies `valid_from <= effective_time` and (`valid_until IS NULL` or `valid_until > effective_time`). Superseded data is excluded before ranking. | Boundary-time and retrieval-order integration tests. |
| `DAT-005` | Publishing requires `approved_by` and `approved_at`; at most one current published programme exists for the applicable client/week.                                      | Check/partial-unique constraints and race test.      |
| `DAT-006` | Approve/override, previous-version supersession, session materialization, and coach-action audit insertion commit atomically.                                            | Rollback and concurrent publication tests.           |
| `DAT-007` | A blocked item cannot use ordinary approval. Override requires the server-configured seeded coach actor in context and a non-blank reason.                               | Use-case and DB integration tests.                   |
| `DAT-008` | Editing a published programme creates a new version and never mutates the published payload in place.                                                                    | Version-history integration test.                    |
| `DAT-009` | Context traces are committed before model invocation, including when the gateway later times out, returns invalid data, or fails.                                        | Fault-injected gateway tests.                        |
| `DAT-010` | Job run keys, idempotency keys, and automated-message suppression are enforced under concurrency by database uniqueness/locking, not process memory.                     | Multi-request race tests.                            |
| `DAT-011` | All stored instants use UTC `timestamptz`; client scheduling resolves through an injected clock and the client's IANA timezone.                                          | DST and timezone tests.                              |

## Agent, evaluation, and safety

| ID       | Requirement                                                                                                                                                                             | Verification                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `AI-001` | Intent selection and context assembly are deterministic code. Agents receive assembled inputs and cannot retrieve arbitrary records.                                                    | Unit tests and gateway contract tests.           |
| `AI-002` | Every active hard constraint is pinned ahead of budgeted context. If hard constraints exceed the budget, generation fails visibly before a model call; no hard constraint is truncated. | Budget-stress safety tests.                      |
| `AI-003` | Model outputs are accepted only after Zod validation. Invalid or partial outputs cannot create a reviewable or publishable item.                                                        | Malformed-recording tests.                       |
| `AI-004` | Deterministic safety gates run before graded judges. Any blocking gate failure sets `review_band=blocked`.                                                                              | Pipeline order and golden safety tests.          |
| `AI-005` | The generator and judge model identifiers differ in live mode. Judges receive output, trace, and rubric but not generator reasoning.                                                    | Configuration and judge-payload tests.           |
| `AI-006` | Recorded mode is deterministic, committed, keyless, and the default for tests and demo. Live mode is provider-isolated and records usage, cost, latency, prompt hash, and failures.     | Recorded replay and live-adapter contract tests. |
| `AI-007` | The programme, adjustment, and accountability agents cannot write to repositories, publish, override, select/lower a tier, or create hard constraints.                                  | Capability/interface boundary tests.             |
| `AI-008` | Review bands are `blocked` for any blocking failure, `clear` only when all gates pass and every required judge is at least 4, and `attention` otherwise.                                | Decision-table unit tests.                       |

## Coaching flows

| ID         | Requirement                                                                                                                                    | Verification                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `FLOW-001` | Weekly generation queues an evaluated draft; only coach edit/approve/override can publish it.                                                  | Plan-loop E2E test.                         |
| `FLOW-002` | Every V1 adjustment, including load/volume reductions and equivalent swaps, is queued for coach approval; automatic application is disabled.   | Adjustment E2E and regression-gate tests.   |
| `FLOW-003` | A completed session or submitted check-in is visible to the next context assembly after its transaction commits.                               | Write-then-generate integration test.       |
| `FLOW-004` | Accountability tier is deterministic. Escalation moves toward human ownership and cannot return to automation without a recorded coach action. | State-machine transition tests.             |
| `FLOW-005` | At most one automated message may be sent per client in any rolling 48-hour window, even when jobs run concurrently.                           | Clock-boundary and concurrency tests.       |
| `FLOW-006` | Client-facing APIs expose only approved, current, published programme/session content.                                                         | Leakage/authorization-scope contract tests. |
| `FLOW-007` | Weekly and daily jobs use stable run keys and are safe to retry without duplicate plans, scores, states, or messages.                          | Duplicate and concurrent job tests.         |

## Privacy and no-auth operation

| ID        | Requirement                                                                                                                                           | Verification                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `PRV-001` | V1 implements no user login, signup, session, role, or permission system. Coach actions use the configured seeded coach actor.                        | Surface and dependency inspection.               |
| `PRV-002` | A production no-auth deployment fails startup unless explicit synthetic-demo configuration is enabled.                                                | Production configuration tests.                  |
| `PRV-003` | Production no-auth reads and jobs are scoped to records explicitly classified as synthetic; encountering non-synthetic client data fails closed.      | Mixed-classification integration tests.          |
| `PRV-004` | Traces and structured logs use client handles/IDs and never identity/contact fields, raw secrets, authorization values, or unredacted error payloads. | Redaction tests and fixture scan.                |
| `PRV-005` | Public demo fixtures, recordings, screenshots, traces, and test artifacts contain synthetic data only.                                                | CI content scan and fixture metadata validation. |
| `PRV-006` | Job endpoints require `CRON_SECRET` outside local/demo mode; this protects infrastructure invocation and is not user authentication.                  | Route-adapter contract tests.                    |

## Operations and verification

| ID        | Requirement                                                                                                                                                                                           | Verification                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `OPS-001` | Each request and job has a correlation ID propagated through logs, traces, agent runs, evaluations, and errors.                                                                                       | Observability integration test.       |
| `OPS-002` | External/model calls have explicit timeouts, bounded retries only for retry-safe failures, and no unbounded polling.                                                                                  | Fault-injection tests.                |
| `OPS-003` | Compose services have health checks and one-shot migrations complete before the web service becomes ready.                                                                                            | Docker smoke test.                    |
| `OPS-004` | Deterministic verification runs without network access or AI credentials. Live-model evaluation is a separately reported conditional suite.                                                           | Keyless CI test.                      |
| `OPS-005` | Release acceptance includes formatting, lint, strict type checking, units, PostgreSQL integration, contract, safety, web E2E, mobile E2E/config validation, accessibility, and all deployable builds. | `pnpm verify:full` aggregate command. |
