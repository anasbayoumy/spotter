# ADR-0004: Recorded and Live Model Modes

- Status: Accepted
- Requirements: `AI-005`, `AI-006`, `OPS-004`

## Context

Core verification must be deterministic and keyless, while V1 must also exercise real generators,
independent judges, cost, latency, and provider failures.

## Decision

All model calls use `ModelGateway`. Recorded mode is deterministic and default for demo/tests/CI;
missing recordings fail rather than falling back live. Live mode is explicitly configured,
provider-isolated, traced, bounded by deadlines/retries, and requires distinct generator/judge model
IDs. Both modes execute the same schemas, gates, review-band rules, persistence, and approval flow.

## Consequences

- Deterministic acceptance never depends on network/model variance.
- Live quality/calibration is a separate conditional suite and honestly reported.
- Recordings are versioned synthetic fixtures, not permission to bypass the real pipeline.
