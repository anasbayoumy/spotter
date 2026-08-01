# Spotter repository rules

These rules apply to the entire repository.

## Scope and authority

- Make changes only inside this repository.
- `DOCS/` is the implementation source of truth.
- Precedence is: approved user decisions, canonical `DOCS/` contract, ADRs, then implementation.
- If code and documentation disagree, fix the disagreement; do not silently choose one.
- Use synthetic demo data only. Never add real health, identity, or credential data.

## V1 architecture

- `frontend/` is the Next.js coach console and contains only thin `/api/v1` route adapters.
- `backend/` is a server-only modular package imported by those adapters; it is not a second deployable.
- `client-frontend/` is the Expo client application and communicates only through REST contracts.
- `packages/contracts` contains cross-surface Zod schemas. UI packages must never import backend internals.
- PostgreSQL 16 with pgvector in Docker is the authoritative integration database. PGlite is limited to fast tests and the keyless demo adapter.
- Every V1 programme and adjustment requires coach approval before client visibility.

## Engineering rules

- Keep strict TypeScript enabled and avoid `any`, non-null assertions, silent catches, and mutable global state.
- Business rules live outside controllers, route adapters, and React components.
- Use classes for stateful boundaries and invariant-owning use cases; use pure functions for deterministic policies.
- Validate environment, HTTP input/output, persisted JSON, and model output at runtime.
- Make mutations idempotent and transactionally protect approval, publication, supersession, nudges, and scheduled jobs.
- A context trace must be persisted before a model gateway is invoked.
- Hard constraints cannot be evicted by token budgeting. Unknown movement families fail closed.
- Add regression coverage for every defect. Never weaken or skip a valid test to make a gate pass.

## Verification

- Run targeted checks while developing and the complete release gate before declaring success.
- Docker work must use the dedicated `spotter-v1` Compose project and must not touch unrelated containers or volumes.
- Store final evidence under `artifacts/verification/` and scan it for secrets and personal data.
- Native simulator execution may be reported unavailable only when the host lacks the simulator; component, export, and Expo-web mobile verification remain mandatory.

## Collaboration

- Respect pool file ownership. Do not edit a path assigned to another active agent.
- Only the root orchestrator changes root manifests, the lockfile, Compose, CI, or cross-boundary configuration unless ownership is explicitly delegated.
- Do not create migrations concurrently.
