# Docker and Runtime Topology

## Principles

- There is one server deployable: the Next.js application in `frontend/` (`SYS-003`).
- `backend/` runs in that process as a server-only imported package; Compose must not define a
  backend service (`SYS-004`).
- Docker PostgreSQL + pgvector is authoritative for integration and release verification.
- PGlite remains available for fast isolated tests and a keyless, Docker-free demo.
- Expo native tooling runs on the host/simulator and calls the same Next REST API.

## Compose services

The root `compose.yaml` defines:

| Service         | Lifecycle             | Responsibility                                                                        |
| --------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `postgres`      | long-running          | `pgvector/pgvector:pg16`, authoritative local database, named volume, health check    |
| `migrate`       | one-shot              | applies committed Drizzle SQL migrations after PostgreSQL is healthy                  |
| `seed`          | one-shot/demo profile | inserts idempotent synthetic fixtures only                                            |
| `web`           | long-running          | builds/runs `frontend/`, including `/api/v1` adapters and imported `backend/` modules |
| `test-postgres` | test profile          | isolated ephemeral pgvector database for concurrency/release suites                   |

There is no `backend`, Redis, broker, worker, or production notification service. Optional tooling
cannot be required by the main stack.

## Dependency and readiness order

```text
postgres healthy -> migrate completed -> seed completed when requested -> web ready
```

`web` readiness requires its process to be serving and its database dependency/migration version to
be valid. It must not report ready while migrations are pending. Container health checks use bounded
timeouts/retries and must not modify state (`OPS-003`).

## Networks, ports, and data

- `web`: host `3000`, serving coach UI and `/api/v1`.
- `postgres`: host `5432` for local tools; service name `postgres` inside Compose.
- `test-postgres`: separate test-only host port or internal-only network to avoid accidental reuse.
- PostgreSQL data uses a named development volume. Test data is ephemeral.
- Expo Metro uses its normal host port and `EXPO_PUBLIC_API_BASE_URL`; a physical device uses the
  host's reachable LAN address rather than container `localhost`.

Only `web` and intentionally exposed development database access publish host ports. Secrets arrive
through environment injection, never baked images or Compose files.

## Runtime modes

| Mode                | Database                      | Model                                | Purpose                                                  |
| ------------------- | ----------------------------- | ------------------------------------ | -------------------------------------------------------- |
| fast test           | isolated PGlite               | recorded                             | units, repository parity subset, deterministic iteration |
| keyless demo        | persistent/local PGlite       | recorded                             | `pnpm demo`, no Docker or AI key                         |
| Docker demo         | PostgreSQL pgvector           | recorded                             | full production-parity coaching loop                     |
| integration/release | ephemeral PostgreSQL pgvector | recorded                             | authoritative deterministic acceptance                   |
| live evaluation     | PostgreSQL branch/test DB     | live generator + distinct live judge | conditional quality/cost evaluation                      |

Recorded/live and PostgreSQL/PGlite are independent choices. “Keyless” means no model credential; it
does not weaken validation, gates, traces, approval, or audit behavior.

## Images and build context

The web Dockerfile uses a multi-stage build:

1. dependency stage installs the frozen pnpm lockfile;
2. build stage runs required code generation and `next build`;
3. runtime stage contains only the standalone Next output, required workspace runtime files, and a
   non-root user.

The build context is `app/` because Next must bundle `backend/` and shared packages. `.dockerignore`
excludes `.git`, local data, coverage, test artifacts, Expo build output, caches, secrets, and host
`node_modules`.

Migration and seed commands use the same lockfile/code revision as `web`; running an unrelated
global Drizzle version is prohibited.

## Verification

`pnpm test:docker` must prove:

1. clean PostgreSQL startup;
2. migration from empty database;
3. idempotent synthetic seed;
4. web readiness after migration;
5. representative REST health/read/write flow;
6. pgvector extension availability;
7. concurrency invariants for publication, idempotency, jobs, and nudge suppression; and
8. clean shutdown/restart with persisted development data.

`pnpm verify:full` includes Docker verification. PGlite-only success cannot satisfy a release
(`DAT-001`, `OPS-005`).

## Production shape

Production consists of one built Next server artifact and one managed PostgreSQL 16 + pgvector
database. Scheduling invokes protected `/api/v1/jobs/*` routes. The runtime must support normal
Node.js server execution because `backend/` uses database pooling and server-only modules; Edge
runtime is not an implicit target.

A no-auth production process fails startup unless the explicit synthetic-only guard succeeds. No
production image or migration embeds demo records; synthetic seed execution is a deliberate
deployment step (`PRV-002`, `PRV-003`).
