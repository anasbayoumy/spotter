# Test strategy

## Objective

Verification must prove that one seeded coach can operate the complete Plan, Adjust, and
Accountability loops without unsafe or unapproved output reaching a selected synthetic client. It
must also prove the less visible properties: current context is temporally correct, retries are
idempotent, concurrent requests preserve invariants, failures leave audit evidence, and the no-auth
build cannot accidentally expose real data.

## Test layers

| Layer                  | Primary responsibility                                            | Runtime                  | Gate                        |
| ---------------------- | ----------------------------------------------------------------- | ------------------------ | --------------------------- |
| Static/architecture    | Types, dependency direction, forbidden patterns, build shape      | Host Node                | Every change                |
| Unit                   | Pure domain rules, state machines, value validation, render logic | Vitest                   | Every change                |
| Component              | Coach and RN surface behavior without a browser/device            | Vitest + Testing Library | Every change                |
| Contract               | Zod schemas, HTTP envelope, clients against provider contract     | Vitest                   | Every change                |
| PGlite parity          | Fast repository behavior and deterministic demo path              | PGlite                   | Every change                |
| Safety                 | Fixed fixtures and property tests, no model/network               | Vitest/custom runner     | Every change/PR             |
| PostgreSQL integration | Migrations, queries, constraints, transactions, pgvector          | Docker                   | Pool/release                |
| Concurrency            | Duplicate requests, publication races, job/nudge races            | Docker PostgreSQL        | Pool/release                |
| E2E                    | Real browser journeys through HTTP and persistence                | Playwright + Docker      | Pool/release                |
| Mobile                 | RN components, Expo checks/exports, Expo-web browser journeys     | Host + Playwright        | Pool/release                |
| Accessibility          | Automated axe plus keyboard/focus assertions                      | Playwright               | Pool/release                |
| Performance            | HTTP, batch jobs, rendering, query and resource budgets           | k6/Lighthouse/Docker     | Release                     |
| Resilience             | Dependency outage, timeout, restart, malformed output, recovery   | Docker/Toxiproxy         | Release                     |
| Security               | Threat-driven source, HTTP, dependency, secret and image checks   | Host + Docker            | Release                     |
| Live evaluation        | Independent generator/judge quality and cost observations         | External model           | Non-blocking unless enabled |

Test counts in discovery documents are planning floors, not targets. Coverage is accepted by risk
and behavior, not by manufacturing tests to reach a count.

## Environments and data

### Fast deterministic environment

- Recorded model responses.
- PGlite database created uniquely per test worker.
- Frozen clock, seeded UUID source, and explicit client IANA timezone when time affects behavior.
- No external network.
- Used by `pnpm verify`.

### Authoritative release environment

- Unique Compose project name such as `spotter-qa-<run-id>`.
- PostgreSQL 16 with pgvector and committed migrations.
- Single Next.js `frontend` deployable containing only thin `/api/v1` adapters.
- Server-only `backend` package imported by route adapters; it is never browser-bundled.
- Recorded model mode, synthetic fixtures, real HTTP, and production builds.
- Used by `pnpm verify:full` and `pnpm test:docker`.

### Live evaluation environment

Live generation and independent judging run only when provider credentials and distinct model IDs
already exist. Results are labeled observational. Missing credentials do not block V1 because the
approved product includes a complete keyless recorded path.

## Determinism rules

- Tests that compare time must inject a clock; they may not depend on local wall-clock time.
- Tests that schedule sessions use explicit IANA zones and include DST boundary cases.
- Tests may not depend on execution order or data left by another test.
- Each test owns its database schema/database or rolls back a dedicated transaction.
- Random/property tests record their seed; a failing seed is retained as a regression fixture.
- Recorded AI fixtures are committed, schema-versioned, prompt-hash-bound captures with model and
  timestamp provenance.
- Network access is denied by default in deterministic suites.

## Risk tiers

### Tier A — never regress

- Active hard constraints are pinned and cannot be evicted.
- Unknown movement families fail closed.
- Expired/superseded records do not influence context.
- No programme or adjustment publishes without coach approval.
- A blocked item requires explicit override with a non-empty reason.
- Publication and supersession are atomic.
- Traces exist before model invocation, including failed invocations.
- Automated messages obey 48-hour suppression under concurrency.
- Human-owned escalation cannot return to automation without a recorded coach action.
- Draft, rejected, and superseded content is never visible on the client surface.

Tier A failures block all further release claims. Their tests have no CI retry and their critical
implementation paths are subject to mutation testing.

### Tier B — release-critical

All documented user journeys, API contracts, audit records, accessibility, data integrity, Docker
health, production builds, security gates, and approved performance budgets.

### Tier C — observational

Live-model judge distributions, cost/latency from external providers, and native device behavior
covered by `ENV-MOB-001`. Observational results are retained but do not weaken Tier A/B gates.

## Execution order

### Inner implementation loop

1. Identify the requirement IDs affected.
2. Add or confirm a failing acceptance/regression test.
3. Implement the smallest complete behavior.
4. Run format/lint/types and the targeted suite.
5. Run all tests in the affected package and its dependants.
6. Run `pnpm verify` before declaring the slice complete.

### Pool boundary

Run `pnpm verify`, PostgreSQL integration, contracts, concurrency, relevant E2E, accessibility, and
the affected NFR/security scenarios. Retain evidence for the pool.

### Release loop

Run the clean-room Docker protocol, `pnpm verify:full`, evidence validation, then an independent
adversarial review. Any defect re-enters the fix loop in `09-evidence-and-fix-loop.md`; after the
fix, the targeted test, blast-radius suites, and complete release gate run again.

## Test ownership and independence

- Feature implementers own the first unit/integration evidence for their changes.
- A quality specialist owns the canonical safety set, NFR harnesses, and final traceability audit.
- Final adversarial reviewers inspect requirements and evidence before reading implementation to
  reduce confirmation bias.
- A test may be changed with product code only when the approved contract changed or the test is
  proven incorrect. The evidence records why and which requirement authorized the change.

## QA strategy requirements

| ID           | Requirement                                                                 | Verification                               |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------ |
| `QA-STR-001` | The fast deterministic suite requires no network, AI key, or Docker.        | `pnpm verify`                              |
| `QA-STR-002` | Authoritative integration/release evidence uses Docker PostgreSQL/pgvector. | `pnpm test:docker`                         |
| `QA-STR-003` | Every release requirement maps to implementation, test, and evidence.       | `pnpm evidence:verify`                     |
| `QA-STR-004` | Tier A gates run without retry and fail closed.                             | `pnpm verify:full`                         |
| `QA-STR-005` | Randomized tests preserve failing seeds.                                    | `pnpm test:unit`                           |
| `QA-STR-006` | Recorded model fixtures are schema-versioned and deterministic.             | `pnpm --filter backend test:unit`          |
| `QA-STR-007` | Live evaluation cannot override deterministic acceptance.                   | `pnpm evidence:verify`                     |
| `QA-STR-008` | The mobile environmental exception is explicit and accurately reported.     | `pnpm test:mobile && pnpm evidence:verify` |
