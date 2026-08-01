# ADR-0005: No Authentication and Synthetic-Only Production Guard

- Status: Accepted
- Requirements: `PRV-001` through `PRV-006`

## Context

V1 deliberately has no user authentication. Public no-auth access to real health-adjacent data would
be unacceptable, even though authentication is outside the functional prototype scope.

## Decision

V1 uses a configured seeded coach and selectable demo clients. A production no-auth runtime boots
only when synthetic-demo operation is explicitly enabled and all in-scope clients are classified
synthetic. Mixed/non-synthetic data fails startup and remains query-scoped as defense in depth. Job
routes retain an infrastructure `CRON_SECRET`; this is not user authentication.

## Consequences

- Public demos may contain synthetic data only, including traces, recordings, and artifacts.
- Real Client 001 data cannot be deployed through this V1 surface.
- Authentication/tenancy requires a future ADR and threat/privacy review; IDs preserve the seam.

