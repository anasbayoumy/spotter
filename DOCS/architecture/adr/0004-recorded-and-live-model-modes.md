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
IDs. `OpenAICompatibleTransport` uses the generic OpenAI-compatible protocol, explicit JSON-only
text instructions, and the existing Zod output schemas; it does not require native JSON-schema mode
or hardcode a provider. Schema repair is attempted once before a non-retryable failure. Both modes
execute the same gates, review-band rules, persistence, and approval flow.

## Consequences

- Deterministic acceptance never depends on network/model variance.
- Live quality/calibration is conditional on two available model IDs and is honestly reported.
- Generator recordings are captured model responses over synthetic fixtures and include raw text,
  model ID, timestamp, prompt hash, and usage. They are not evidence of human review.
- Calibration remains unavailable until humans populate the pending label file.
