# Spotter documentation contract

This directory is the canonical source of truth for implementation and verification.

## Decision precedence

1. Explicitly approved product decisions recorded in this repository.
2. Requirements, architecture, and testing contracts in this directory.
3. Architecture Decision Records for deliberate refinements.
4. Code and generated artifacts.

The original discovery documents in `/Users/anas/franz-agents/DOCS` were read-only inputs. Their
intended behavior is normalized here so contributors do not have to resolve contradictory drafts
independently.

## Canonical sections

- `requirements/`: V1 behavior, journeys, acceptance criteria, and requirement IDs.
- `architecture/`: system boundaries, dependency rules, data invariants, runtime design, and ADRs.
- `testing/`: mandatory quality gates, threat model, evidence contract, and release criteria.
- `traceability.md`: final requirement-to-code-to-test-to-evidence mapping maintained during
  delivery.

## Approved constraints

- No authentication in V1; the UI uses seeded synthetic coach/client selection.
- One Next.js web/API deployable, with all real server behavior isolated in `backend/`.
- An Expo client application under `client-frontend/`.
- All programmes and adjustments require coach approval before publication.
- Recorded model responses provide the mandatory deterministic, keyless path.
- Docker PostgreSQL/pgvector is authoritative for integration and release verification.
- No payments, multitenancy, real notifications, wearables, biomarkers, real client data, or
  production deployment.
