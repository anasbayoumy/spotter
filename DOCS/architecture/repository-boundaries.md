# Repository and Dependency Boundaries

## Canonical repository shape

The checkout root is the workspace and repository root (`SYS-001`).

```text
app/
├── frontend/                     # Next.js deployable
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/v1/           # ultra-thin REST route adapters
│   │   │   ├── adjustments/
│   │   │   ├── clients/
│   │   │   ├── programmes/
│   │   │   ├── queue/
│   │   │   ├── scorecard/
│   │   │   └── traces/
│   │   ├── features/
│   │   ├── components/
│   │   ├── lib/
│   │   └── server/               # Next-only request/runtime adapters
│   ├── tests/
│   ├── next.config.ts
│   └── package.json
│
├── backend/                      # @spotter/backend, server-only package
│   ├── src/
│   │   ├── composition/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   ├── agents/
│   │   ├── evals/
│   │   ├── jobs/
│   │   ├── cli/
│   │   └── index.ts
│   ├── migrations/
│   ├── packages/                 # cross-surface workspaces, physically backend-owned
│   │   ├── config/
│   │   ├── contracts/
│   │   ├── design-tokens/
│   │   └── testkit/
│   ├── resources/                # committed synthetic demo, recording, calibration, and golden data
│   ├── infra/                    # PostgreSQL init and verification schema declarations
│   ├── tooling/                  # repository verification and operational commands
│   ├── tests/
│   └── package.json
│
├── client-frontend/              # Expo application
│   ├── src/
│   │   ├── app/
│   │   ├── features/
│   │   ├── components/
│   │   ├── lib/
│   │   └── theme/
│   ├── tests/
│   ├── app.json
│   └── package.json
│
├── DOCS/
│   └── architecture/
├── docker/                       # production-like image and cluster entrypoints
├── .github/workflows/
├── compose.yaml
├── .env.example
├── eslint.config.mjs
├── prettier.config.mjs
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
└── package.json
```

`frontend/`, `backend/`, and `client-frontend/` are the only application folders (`SYS-002`). The
cross-surface workspaces are physically nested under `backend/packages/` but remain independent
package boundaries. A new shared package requires evidence that at least two surfaces need the same
stable concern; convenience is not sufficient.

## `frontend/` ownership

### Route tree

```text
frontend/src/app/
├── layout.tsx
├── globals.css
├── page.tsx                      # redirect to /queue
├── queue/page.tsx
├── clients/[clientId]/page.tsx
├── programmes/[programmeId]/page.tsx
├── adjustments/[adjustmentId]/page.tsx
├── traces/[traceId]/page.tsx
├── scorecard/page.tsx
└── api/v1/
    ├── clients/
    ├── programmes/
    ├── sessions/
    ├── check-ins/
    ├── adjustments/
    ├── accountability/
    ├── traces/
    ├── scorecard/
    └── jobs/
```

### Presentation modules

Feature folders own route-specific view models, query hooks, mutation hooks, components, and tests:

```text
frontend/src/features/
├── review-queue/
├── client-detail/
├── programme-review/
├── adjustment-review/
├── trace-inspector/
└── scorecard/
```

Reusable visual primitives live in `components/ui`; shell/navigation lives in `components/layout`.
`lib/api` owns the generated/typed client and response parsing. UI components do not call `fetch`
directly.

### Route-adapter contract

Each `route.ts` must be structurally equivalent to:

```ts
import { requestSchema, responseSchema } from "@spotter/contracts";
import { getBackend } from "@spotter/backend/server";

export async function POST(request: Request): Promise<Response> {
  const requestContext = await createRequestContext(request);
  const input = requestSchema.parse(await request.json());
  const result = await getBackend().programmes.generate(input, requestContext);
  return toJsonResponse(responseSchema.parse(result), requestContext.requestId);
}
```

The adapter may additionally enforce infrastructure secrets for job routes and parse path/query
parameters. It may not branch on coaching rules, open transactions, call models, query Drizzle, or
select a review band (`BND-002`). A shared adapter wrapper may remove boilerplate but must preserve
per-endpoint schemas and explicit facade method selection.

## `backend/` ownership

The package begins its server entry points with `import "server-only"` and uses explicit package
exports. Browser-safe types come from `@spotter/contracts`, never from `@spotter/backend`.

```text
backend/src/
├── index.ts                       # intentional server-only public facade types
├── composition/
│   ├── create-backend.ts
│   ├── get-backend.ts
│   ├── backend-facade.ts
│   └── runtime-adapters.ts
├── domain/                        # pure invariants and deterministic policies
├── application/                   # use cases, ports, and read models
├── infrastructure/database/       # PostgreSQL/PGlite adapters and repositories
├── agents/                        # context, gateways, prompts, and agent runners
├── evals/                         # gates, judges, calibration, and scorecards
├── jobs/                          # weekly-plan and accountability entry points
└── cli/                           # migration, seed, demo, and safety commands
```

Capabilities are split across explicit layers instead of mirrored placeholder directories. Domain
files own invariants, application files own use cases and ports, and concrete persistence remains
under `infrastructure/database`. Cross-layer imports follow the dependency matrix below and use
declared package exports rather than filesystem shortcuts.

### Backend public surface

The production composition root exposes a facade grouped by capability:

```ts
interface BackendFacade {
  clients: ClientFacade;
  programmes: ProgrammeFacade;
  sessions: SessionFacade;
  checkIns: CheckInFacade;
  adjustments: AdjustmentFacade;
  accountability: AccountabilityFacade;
  traces: TraceFacade;
  scorecard: ScorecardFacade;
  jobs: JobFacade;
}
```

It does not expose repositories, Drizzle clients, model SDK objects, or transaction handles.
External consumers use declared package exports; in-package tests may exercise internals without
expanding the production public surface.

## `client-frontend/` ownership

```text
client-frontend/
└── src/
    ├── app/
    │   ├── _layout.tsx
    │   ├── index.tsx
    │   ├── select-client.tsx
    │   ├── session/[sessionId].tsx
    │   └── (tabs)/
    │       ├── _layout.tsx
    │       ├── today.tsx
    │       ├── history.tsx
    │       └── check-in.tsx
    ├── features/
    │   ├── client-selector/
    │   ├── today/
    │   ├── session-logging/
    │   ├── history/
    │   └── check-in/
    ├── components/
    ├── lib/api/
    ├── lib/query/
    ├── lib/storage/
    └── theme/
```

The demo client selection is stored locally and sent only as the target resource identifier. It is
not authentication or authorization. Server code never trusts a coach/approval actor sent by this
app.

## Shared package boundaries

### `backend/packages/contracts`

Contains Zod 4 schemas and inferred JSON-safe types for:

- API envelopes and error codes;
- clients and constraints;
- programmes and review decisions;
- sessions and check-ins;
- adjustments and accountability;
- traces and scorecard read models; and
- structured model inputs/outputs and citations.

Database row types, Drizzle schemas, prompts, entities, repository interfaces, React hooks, and
formatting utilities do not belong here.

### `backend/packages/design-tokens`

Exports platform-neutral values for color, spacing, radius, typography, and semantic state. Web and
React Native map these values into their own styling systems; no React component is shared between
platforms.

### `backend/packages/config` and `backend/packages/testkit`

`config` owns runtime environment parsing and server configuration schemas. `testkit` exports
synthetic builders, fixed clocks, deterministic IDs, and contract assertions; production packages
cannot depend on it. Root ESLint and TypeScript configurations enforce shared strictness and import
zones.

## Backend-owned supporting assets

- `backend/resources/` contains only committed deterministic inputs: the synthetic demo dataset,
  model recordings, calibration labels, and golden safety manifest.
- `backend/infra/` contains infrastructure declarations consumed by Compose and verification:
  PostgreSQL initialization, allowed Docker topology, and the evidence manifest schema.
- `backend/tooling/` contains repository-level operational and verification commands for Docker,
  performance, security, generated contracts, evidence, and release gates. It is not imported by
  product runtime modules.

## Dependency matrix

| From                      | Allowed dependencies                                                          | Prohibited dependencies                      |
| ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| `frontend` presentation   | contracts, design tokens, frontend-local code                                 | backend, DB, agents, Expo                    |
| `frontend` route adapters | contracts, backend public server facade, adapter utilities                    | backend internals/deep imports               |
| `client-frontend`         | contracts, design tokens, client-local code                                   | backend, frontend, DB, server configuration  |
| backend domain            | contracts only where a stable value schema is shared; preferably local values | application, infrastructure, frameworks, I/O |
| backend application       | domain, application ports, contracts                                          | concrete DB/model adapters, HTTP/Next        |
| backend infrastructure    | application ports, domain, contracts, approved SDKs                           | React, Expo, route adapters                  |
| backend composition       | all backend layers                                                            | frontend/client presentation                 |
| contracts                 | Zod                                                                           | applications, DB, model SDK, UI frameworks   |
| testkit                   | contracts and dev-only libraries                                              | production-only runtime assumptions          |

Cycles are forbidden at package and backend-module levels. CI must run an architecture graph check
and fail on forbidden imports (`BND-001`, `BND-003`, `BND-007`).

## Configuration ownership

- Root configuration defines workspace tasks and common strictness.
- `frontend` validates public and server Next environment projections.
- `client-frontend` validates only `EXPO_PUBLIC_*` values.
- `backend` receives validated server configuration through the composition root.
- No module reads `process.env` outside its designated configuration adapter.
- Server secrets never cross a contract schema or appear in public runtime variables.
