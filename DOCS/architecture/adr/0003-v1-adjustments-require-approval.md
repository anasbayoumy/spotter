# ADR-0003: All V1 Adjustments Require Coach Approval

- Status: Accepted
- Requirements: `FLOW-002`, `DAT-006`

## Context

The original architecture permits narrow automatic reductions, while the V1 technical contract
excludes automatic programme modification. Publication authority is the primary safety promise.

## Decision

Every V1 adjustment is evaluated and queued. A coach must approve or explicitly override before it
creates and publishes a new programme version. No agent/event-facing auto-apply use case exists.

## Consequences

- Reductions, volume changes, and documented swaps follow the same audit/publication guarantees.
- The auto-apply safety rule remains as a fail-closed regression guard.
- Automatic low-risk application may be proposed later only through a new ADR and evidence.

