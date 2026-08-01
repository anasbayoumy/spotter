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
