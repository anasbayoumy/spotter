# ADR-0001: Single Deployable with a Server-Only Backend Package

- Status: Accepted
- Requirements: `SYS-003`, `SYS-004`, `BND-002`, `BND-007`

## Context

V1 requires separate `frontend/`, `backend/`, and `client-frontend/` application folders. The source
architecture also requires one server deployable and thin Next REST handlers. A standalone backend
service would add deployment, network, CORS, tracing, and failure modes without V1 value.

## Decision

`frontend/` owns the Next.js process, coach UI, and `/api/v1` route adapters. `backend/` is a
server-only modular workspace package imported in-process through a narrow facade. It has no HTTP
listener and imports no Next types. `client-frontend/` consumes the Next REST API.

## Consequences

- Business and infrastructure code remains independently testable and separated from presentation.
- REST stays a real contract for Expo even though coach/UI calls are same-origin.
- The Next build context includes backend and shared packages and uses the Node runtime.
- A future service extraction remains possible at the facade/REST boundary but is not pre-built.
