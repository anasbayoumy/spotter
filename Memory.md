# Spotter delivery memory

- 2026-08-02: Approved a no-auth, synthetic-data V1 with one Next.js web/API deployable, a
  server-only modular `backend/`, a coach `frontend/`, and an Expo `client-frontend/`.
- 2026-08-02: Docker PostgreSQL/pgvector is authoritative; PGlite remains the fast/keyless adapter
  with parity checks.
- 2026-08-02: Every programme and adjustment requires coach approval before client visibility.
- 2026-08-02: Autonomous sequential three-agent pools are authorized, followed by independent
  certification and fix/retest loops.
- 2026-08-02: All repository writes stay under `/Users/anas/franz-agents/app`; publication target is
  `anasbayoumy/spotter`.
- 2026-08-02: Pool 0 canonical contract was committed to `main` as `9d07d75`; implementation
  continues on `agent/spotter-v1`.
- 2026-08-02: Pool 1 passed formatting, lint, strict typecheck, 89 unit/contract/config/testkit
  tests, PGlite migration/seed/vector health, and isolated Docker PostgreSQL migration/seed
  idempotency. Domain coverage reached 100% statements/lines/functions and 98.79% branches.
- 2026-08-02: Pool 2 implemented deterministic context assembly, recorded/live model gateways,
  programme/adjustment/accountability agents, eight fail-closed safety gates, independent judges,
  calibration/scorecard logic, typed application use cases, and scheduled jobs.
- 2026-08-02: The enforced Pool 2 unit gate passed 285 backend tests at 99.90% statements/lines,
  99.36% branches, and 100% functions. Context, safety/taxonomy, publication transactions, and
  accountability critical scopes each reached 100% in all metrics; 93 safety tests and both PGlite
  and Docker PostgreSQL integration suites passed.
- 2026-08-02: Coverage testing exposed and fixed a production error-mapping defect: wrapped Drizzle
  PostgreSQL `23505` errors are now detected through a bounded, cycle-safe cause chain, preserving
  the `publication_conflict` contract and transactional rollback.
- 2026-08-02: Pool 3 delivered one public server facade, all 25 `/api/v1` adapters, process liveness
  plus DB/schema readiness, the complete coach console, and the Expo client journey. A forward-only
  second migration aligned persisted sessions, check-ins, adjustments, triggers, and accountability
  state with shared contracts.
- 2026-08-02: Pool 3 root verification passed formatting, lint/boundaries, strict types, 285 backend
  unit tests, 21 coach tests, 39 Expo tests, 19 API contract tests, 93 safety tests, 13 PGlite
  tests, 5 isolated Docker PostgreSQL tests, 19 resilience tests, warning-free Next production
  build, and Expo iOS/Android/Web exports. Coach coverage is 97.56/94.11/96.77/98.57 and Expo
  coverage is 100/98.29/100/100 for statements/branches/functions/lines.
- 2026-08-02: Integration testing found and fixed a missing Drizzle journal entry for migration
  `0001_api_runtime_contract`; PGlite had applied filename-sorted SQL, while authoritative
  PostgreSQL correctly proved the metadata omission before the fix.
- 2026-08-02: Pool 4 adversarial verification exposed production-path defects hidden by isolated
  tests: safety evaluation omitted trace-derived constraints/schedule/adherence/volume; overflow
  evidence was thrown away before persistence; accountability tier and message kind could diverge;
  and several publication, session, programme-edit, and accountability races could lose state or
  downgrade human ownership. Each defect now has a production-path or authoritative PostgreSQL
  regression.
- 2026-08-02: The Pool 4 checkpoint passed 364 backend unit/property tests at 99.91% statements,
  99.61% branches, 100% functions, and 99.90% lines; 138 safety/property tests; the exact 50-case
  golden set with zero mismatches; 15 PGlite tests; 5 PostgreSQL integration tests; and 12 repeated
  PostgreSQL races spanning all `QA-CON-001..009` scenarios.
- 2026-08-02: Expanded mutation testing now genuinely executes 2,146 mutants across all critical
  scopes. The final strict score is 95.59%, every critical aggregate exceeds 95%, no mutation lacks
  coverage, and no blocker-removal, temporal-boundary, publication-state, or tier/ownership mutant
  survives. Every remaining survivor is classified in retained evidence.
- 2026-08-02: The public API now has a reproducible generated OpenAPI 3.1 inventory covering all 28
  operations. Route additions/removals/method changes fail `pnpm verify:generated` until the
  committed snapshot is regenerated and reviewed.
