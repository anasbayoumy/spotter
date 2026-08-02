# Spotter V1 Product Requirements

This directory is the canonical product contract for the implementation at the repository root.

## Authority

When source documents disagree, implementation decisions use this order:

1. Approved user decisions: no authentication, all implementation inside `app`, the named
   `frontend`, `backend`, and `client-frontend` boundaries, autonomous delivery, synthetic data.
2. `DOCS/tech-stack.md`, which explicitly identifies itself as the V1 implementation contract.
3. `DOCS/tests.md`.
4. `DOCS/arch.md` and `DOCS/data-model.md`.
5. `DOCS/overview.md`.

`DOCS/agent-layer.md` currently duplicates the data-model document. Where agent behavior is absent
from it, the pipeline and agent contracts in `tech-stack.md` are authoritative.

## Resolved source conflicts

| Topic                  | V1 decision                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js version        | Next.js 16, not the older Next.js 15 diagram.                                                                                                              |
| HTTP boundary          | Versioned JSON REST, not tRPC or GraphQL.                                                                                                                  |
| Adjustments            | Every adjustment requires coach approval; no auto-application in V1.                                                                                       |
| Jobs                   | Idempotent cron-triggered route handlers; no separate queue worker.                                                                                        |
| Demo database          | PGlite is the mandatory keyless path; Docker PostgreSQL/pgvector is a parity path.                                                                         |
| Client 001             | The committed/no-auth demo uses a synthetic `c_001`; no real health data is committed.                                                                     |
| Physical layout        | `frontend/`, modular server-only `backend/`, and `client-frontend/`. Thin Next route adapters import backend use cases, preserving one web/API deployable. |
| Clear-plan bulk action | Not required because it has no V1 REST contract. Individual approval remains required.                                                                     |

## Documents

- [product-contract.md](product-contract.md): scope, actors, invariants, and demo behavior.
- [journeys-and-acceptance.md](journeys-and-acceptance.md): complete product loops and UI
  acceptance.
- [api-and-errors.md](api-and-errors.md): endpoint/use-case inventory and failure behavior.
- [requirements.md](requirements.md): atomic, testable requirement IDs.
- [traceability.md](traceability.md): initial requirement-to-acceptance-test mapping.

All requirements are mandatory unless explicitly marked optional or environment-dependent.
