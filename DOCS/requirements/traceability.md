# Requirement-to-Test Traceability Seed

This is the starting acceptance map, not a substitute for co-located unit tests. Test owners must
replace `planned` with executable paths and preserve requirement IDs in test names or metadata.

## Acceptance test catalogue

| Test ID | Level | Acceptance evidence |
|---|---|---|
| `AT-ARCH-01` | Static | Workspace boundaries and dependency rules pass; no second backend server. |
| `AT-DEMO-01` | Runtime | Clean keyless PGlite recorded-AI demo migrates, seeds twice, and serves both surfaces. |
| `AT-DEMO-02` | Audit | Fixtures/logs/traces/screenshots scan clean for secrets and non-synthetic identity. |
| `AT-DB-01` | Integration | PGlite and Docker PostgreSQL migrations, constraints, seeds, and core queries behave equivalently. |
| `AT-DB-02` | Integration | Temporal half-open boundaries and filter-before-rank exclude expired/superseded records. |
| `AT-DB-03` | Concurrency | Generate/publish/message/job races preserve uniqueness, atomicity, and idempotency. |
| `AT-CTX-01` | Unit/property | Canonical ordering/budgeting is deterministic and pins every active hard constraint. |
| `AT-CTX-02` | Integration | Trace precedes attempted model call; overflow, timeout, invalid output, and missing recording retain evidence. |
| `AT-AGENT-01` | Contract | Recorded/live gateways validate the same schemas, citations, operations, and model independence. |
| `AT-SAFE-01` | Golden | Documented 50-case deterministic suite correctly passes safe and blocks unsafe fixtures. |
| `AT-SAFE-02` | Adversarial | Alias, unknown family, medical/red-flag, budget stress, and inferred-hard-constraint attacks fail safely. |
| `AT-JUDGE-01` | Evaluation | Separate rubrics, review-band boundaries, calibration, and absent/live/recorded metrics are correct. |
| `AT-PLAN-01` | E2E/API | Generate through trace/eval/queue, edit/re-gate, approve, and client visibility succeeds. |
| `AT-PLAN-02` | E2E/API | Reject, blocked normal approval, reason-required override, stale and transactional failure paths succeed. |
| `AT-ADJ-01` | E2E/API | Log/check-in trigger boundaries create one proposal and update next context. |
| `AT-ADJ-02` | E2E/API | Unsupported/increase/stale adjustments fail; approved safe reduction versions and publishes. |
| `AT-ACC-01` | Unit/property | Tier 0–4 thresholds, sparse-history guards, precedence, timezone and 48-hour boundaries pass. |
| `AT-ACC-02` | Integration | Retry/concurrency suppression, human ownership, outbox, task and churn side effects are exact. |
| `AT-WEB-01` | Playwright | Queue/client/review/trace/scorecard happy paths, navigation, responsive and accessibility checks pass. |
| `AT-WEB-02` | Playwright | Empty/loading/invalid/conflict/offline/server-failure states retain data and expose safe request IDs. |
| `AT-MOB-01` | Maestro/Expo E2E | Select/Today/log/complete/History/check-in/message happy path passes. |
| `AT-MOB-02` | Maestro/Expo E2E | Draft invisibility, local-day boundaries, invalid selection, retry/conflict/offline and red flag pass. |
| `AT-API-01` | Contract | Every inventory route validates requests/responses/envelope/errors and rejects spoofed fields. |
| `AT-OPS-01` | Static/runtime | Env validation, cron secret, redacted structured logs, commands, builds and scorecard pass. |

## Requirement mapping

| Requirement IDs | Primary acceptance | Supporting evidence | Status |
|---|---|---|---|
| `SCP-001`–`SCP-007` | `AT-ARCH-01` | `AT-API-01`, builds | planned |
| `DEM-001`–`DEM-007` | `AT-DEMO-01` | `AT-DEMO-02`, `AT-API-01` | planned |
| `DAT-001`–`DAT-004` | `AT-DB-02` | repository unit tests | planned |
| `DAT-005`–`DAT-008` | `AT-DB-03` | `AT-DB-01`, `AT-PLAN-02` | planned |
| `CTX-001`–`CTX-006` | `AT-CTX-01` | `AT-CTX-02` | planned |
| `CTX-007`–`CTX-011` | `AT-AGENT-01` | `AT-CTX-02`, `AT-JUDGE-01` | planned |
| `SAF-001`–`SAF-004` | `AT-SAFE-01` | `AT-SAFE-02`, `AT-JUDGE-01` | planned |
| `SAF-005` | `AT-JUDGE-01` | configuration unit tests | planned |
| `SAF-006` | `AT-PLAN-02` | `AT-SAFE-01` | planned |
| `SAF-007`–`SAF-009` | `AT-SAFE-02` | `AT-ADJ-01`, `AT-MOB-02` | planned |
| `SAF-010` | `AT-SAFE-01` | CI runner assertions | planned |
| `PLN-001`–`PLN-004` | `AT-PLAN-01` | `AT-CTX-01`, `AT-JUDGE-01` | planned |
| `PLN-005`–`PLN-009` | `AT-PLAN-02` | `AT-DB-03`, `AT-MOB-02` | planned |
| `ADJ-001`–`ADJ-005` | `AT-ADJ-01` | `AT-MOB-01`, `AT-DB-03` | planned |
| `ADJ-006`–`ADJ-010` | `AT-ADJ-02` | `AT-SAFE-01`, `AT-PLAN-02` | planned |
| `ACC-001`–`ACC-010` | `AT-ACC-01` | `AT-ACC-02`, `AT-MOB-01` | planned |
| `CUI-001`–`CUI-003` | `AT-WEB-01` | `AT-WEB-02` | planned |
| `CUI-004`–`CUI-006` | `AT-WEB-01` | `AT-PLAN-01`, `AT-PLAN-02`, `AT-JUDGE-01` | planned |
| `CUI-007` | `AT-WEB-01` | automated accessibility report | planned |
| `MUI-001`–`MUI-003` | `AT-MOB-01` | `AT-MOB-02` | planned |
| `MUI-004`–`MUI-008` | `AT-MOB-02` | `AT-MOB-01`, `AT-ADJ-01`, `AT-ACC-02` | planned |
| `OPS-001`–`OPS-004` | `AT-API-01` | `AT-OPS-01`, `AT-DB-03` | planned |
| `OPS-005`–`OPS-010` | `AT-OPS-01` | `AT-DEMO-02`, `AT-DB-01`, builds | planned |

## Required final evidence

The certification report must include:

1. Exact file/test path for every acceptance test ID.
2. Commands, exit codes, test counts, coverage, and execution environment.
3. Requirement IDs with no evidence, if any; they are release blockers unless explicitly classified
   as an honest environment-dependent exception.
4. PGlite and PostgreSQL parity results.
5. Recorded-mode results, plus separately labelled live-model results only when credentials existed.
6. Known limitations and zero unresolved critical/high defects.

