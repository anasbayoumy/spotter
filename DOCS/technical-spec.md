# Spotter V1 technical specification

Status: approved implementation contract.

## Runtime and tooling

| Concern                | Decision                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Language               | Strict TypeScript across server, web, mobile, tooling, and tests                       |
| Runtime                | Node.js 24 LTS                                                                         |
| Workspace              | pnpm workspaces with one frozen lockfile and Turborepo tasks                           |
| Coach web/API shell    | Next.js 16 App Router and React 19.2                                                   |
| Web UI                 | Tailwind CSS 4, accessible headless components, Lucide icons, TanStack Query 5         |
| Backend core           | Server-only TypeScript package with domain/application/infrastructure boundaries       |
| Client                 | Expo SDK 57, React Native 0.86, Expo Router, TanStack Query, `StyleSheet`              |
| API                    | Versioned JSON REST under `/api/v1`, shared Zod 4 contracts                            |
| Persistence            | Drizzle ORM and committed SQL migrations                                               |
| Authoritative database | PostgreSQL 16 with pgvector in Docker                                                  |
| Fast/demo database     | PGlite with explicit parity tests; never final release evidence by itself              |
| Model boundary         | AI SDK 6 plus generic OpenAI-compatible transport behind `ModelGateway`                |
| Scheduling             | Idempotent HTTP job entry points; PostgreSQL locks/constraints, no queue service in V1 |
| Observability          | Pino JSON logs, request/trace IDs, prompt hashes, latency/token/cost metadata          |
| Verification           | Vitest, Testing Library, Playwright, axe, Lighthouse, Docker Compose, optional Maestro |

Package versions are exact in the lockfile. Framework majors above do not change without an ADR and
a full regression run.

## Deployable shape

The V1 has one web/API deployable and one mobile application. The Next.js route layer imports the
server-only backend package. It validates transport input, invokes exactly one application use case,
and maps the typed result to HTTP. It contains no coaching policy, SQL, model invocation, or
transaction management.

The Expo application and browser code never import backend internals. Their only shared executable
boundary is `backend/packages/contracts`.

## Required workspaces and backend-owned assets

The pnpm workspace contains the three application packages plus the physically backend-owned shared
packages:

```text
frontend/
backend/
client-frontend/
backend/packages/contracts/
backend/packages/config/
backend/packages/design-tokens/
backend/packages/testkit/
```

Committed non-workspace backend assets remain beside the server package that owns them:

```text
backend/resources/
backend/infra/
backend/tooling/
```

### Backend layers

- `domain`: entities, value objects, lifecycle rules, temporal predicates, safety policies, and
  engagement calculations. It imports no framework, database, HTTP, UI, or model SDK.
- `application`: command/query use cases, ports, units of work, authorization-free demo identity
  selection, idempotency, and orchestration.
- `infrastructure`: PostgreSQL/PGlite adapters, Drizzle repositories, migrations, and transaction
  implementations.
- `agents`: deterministic context assembly, budgeting, prompts, structured generation, citations,
  model gateways, and traces.
- `evals`: blocking safety gates, independent judge adapters, review-band selection, calibration,
  and scorecards.
- `jobs`: weekly planning and daily accountability entry points with stable run keys and concurrency
  protection.
- `composition`: validated clocks/IDs, logging, model/database adapters, use-case wiring, and the
  narrow server facade consumed by thin Next route adapters.
- `cli`: migration, seed, deterministic demo, fixture recording, calibration-status, and
  safety-report entry points.

## API rules

- Every request and response is runtime-validated.
- Responses use `{ data, error, meta }`; `meta` includes a request ID.
- Mutations accept idempotency keys and return the original stable result on retry.
- Expected domain failures use typed error codes; unexpected failures are logged and return no
  internal details.
- Body sizes, query limits, pagination, timeouts, and bounded retries are explicit.
- Client-facing programme endpoints return only current, approved, published records.
- Job endpoints require a secret outside the explicit synthetic demo environment.

## Data and safety invariants

- Approval and publication are auditable and transactionally coupled.
- A published programme has approver and approval timestamp.
- Exactly one current published programme may exist for a client and programme slot.
- Supersession preserves immutable history and excludes stale records before retrieval ranking.
- Active validity intervals use UTC storage and client IANA timezones at scheduling boundaries.
- Context traces commit before any model call, including failed calls.
- Hard constraints are deterministic, pinned, and cannot be dropped under token pressure.
- Unknown exercise families fail closed.
- A blocked result requires an explicit coach override and written reason.
- Adjustments remain drafts until coach approval in V1.
- Automated accountability messages are suppressed for 48 hours and cannot reclaim human-owned
  escalation.

## Runtime modes

- `recorded`: deterministic committed model responses; default for tests and demo, with no key or
  network.
- `live`: optional provider-backed generation selected only by `SPOTTER_MODEL_MODE=live`; requires
  an OpenAI-compatible base URL, key, and distinct generator/judge model IDs.
- `test`: isolated clocks, IDs, databases, and gateways with production-equivalent contracts.

No code path may silently fall back from live to recorded behavior or report a live evaluation when
only recorded mode ran.

## Target command contract

```text
pnpm install --frozen-lockfile
pnpm dev
pnpm demo
pnpm --filter backend calibrate
pnpm --filter backend record:fixtures
pnpm format:check
pnpm lint
pnpm typecheck
pnpm boundaries:check
pnpm test:unit
pnpm test:integration
pnpm test:contracts
pnpm test:safety
pnpm test:e2e:web
pnpm test:e2e:mobile
pnpm test:a11y
pnpm test:performance
pnpm build
pnpm verify:docker
pnpm verify:full
```

`pnpm verify:full` runs every mandatory deterministic gate and `pnpm evidence:verify` validates the
retained proof. Native simulator execution is additive when a simulator exists; this host's
mandatory mobile proof is component, contract, export, accessibility, offline/retry, and Expo-web
E2E verification.
