# Spotter V1 Canonical Architecture

Status: **approved implementation contract**

This directory is the canonical architecture for the Spotter V1 implementation rooted at
`/Users/anas/franz-agents/app`. The source documents in `/Users/anas/franz-agents/DOCS` remain the
product intent. Where they conflict with this directory, the decisions recorded here take precedence
for implementation.

## Decision precedence

1. Explicit, later user-approved constraints.
2. Accepted architecture decision records in [`adr/`](./adr/).
3. Testable requirements in [`requirements.md`](./requirements.md).
4. The detailed architecture documents in this directory.
5. The source product documents in `/Users/anas/franz-agents/DOCS`.

Changing an accepted requirement requires an ADR that identifies the affected requirement IDs, the
migration impact, and the new verification evidence. Requirement IDs are permanent; retired
requirements remain documented as superseded rather than being reused.

## Documents

- [`requirements.md`](./requirements.md) — stable, testable architectural requirements.
- [`system-architecture.md`](./system-architecture.md) — surfaces, deployment unit, layers, and
  quality attributes.
- [`repository-boundaries.md`](./repository-boundaries.md) — exact folders, ownership, dependency
  direction, and public entry points.
- [`database-and-transactions.md`](./database-and-transactions.md) — storage authority, temporal
  correctness, database constraints, and transaction boundaries.
- [`runtime-flows.md`](./runtime-flows.md) — weekly planning, adjustments, accountability, and
  request/model failure behavior.
- [`docker-topology.md`](./docker-topology.md) — local, demo, integration, and release-test runtime
  topology.
- [`adr/`](./adr/) — accepted architecture decisions and resolved document conflicts.

## Architectural summary

Spotter V1 has three top-level application folders and one server deployable:

```text
client-frontend/ (Expo) ── REST /api/v1 ──┐
                                          ▼
frontend/ (Next.js coach UI + route adapters) ── imports ── backend/ (server-only modules)
                                          │
                                          └── PostgreSQL 16 + pgvector
```

- `frontend/` owns the Next.js runtime, coach presentation, and ultra-thin REST adapters.
- `backend/` owns all domain rules, application use cases, persistence, agent orchestration,
  evaluations, transactions, jobs, and operational policies. It is not an independently running HTTP
  service.
- `client-frontend/` owns the Expo client experience and consumes only the public REST contract.
- `packages/contracts` contains the shared Zod wire schemas. It contains no business behavior.
- V1 has no user authentication. A production build fails closed unless it is explicitly configured
  as a synthetic-only public demo.

## Non-negotiable invariants

- A programme or adjustment cannot reach a client without a recorded coach approval.
- A blocked item requires an explicit override and non-empty reason; ordinary approval cannot
  publish it.
- Active hard constraints are selected deterministically, pinned into context, and never truncated.
- Expired and superseded records are filtered before retrieval ranking.
- A context trace is committed before every model call attempt.
- Agents never execute SQL, mutate state, choose an accountability tier, or publish content.
- Every mutation is validated, idempotent where retryable, auditable, and transactionally safe.
- Client APIs never return draft, queued, rejected, blocked, unapproved, or superseded plans.
- Automated messages are suppressed for 48 hours after the last automated message and stop when
  ownership escalates to a coach.
- CI and the default demo require neither a model key nor real personal data.
