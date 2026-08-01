# ADR-0002: Docker PostgreSQL Authority with PGlite Parity

- Status: Accepted
- Requirements: `DAT-001`, `DAT-002`, `OPS-003`

## Context

PGlite enables a fast keyless demo and isolated tests, while production uses PostgreSQL 16 with
pgvector. PGlite alone cannot prove PostgreSQL concurrency, locking, indexes, or extension behavior.

## Decision

Committed migrations run against both adapters, but Docker PostgreSQL + pgvector is authoritative
for integration and release acceptance. PGlite is retained for demo and fast tests behind the same
repository ports and a defined parity suite.

## Consequences

- Contributors retain a Docker-free demo.
- Release verification requires Docker PostgreSQL.
- Any adapter difference is explicit; production behavior is never weakened to match PGlite.
