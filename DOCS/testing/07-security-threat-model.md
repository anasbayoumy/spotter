# Security threat model and gates

## Security posture

V1 deliberately has no user authentication. It is a synthetic-data demonstration, not an
Internet-facing real-client system. The process must fail closed when configured as production
without an explicit synthetic-demo flag. Authentication, tenancy, and real health/contact data are
out of scope; their absence is a deployment boundary, not a risk accepted for real data.

## Assets and trust boundaries

Protected assets are active constraints, approved programmes, session/check-in data, coach actions,
context traces, agent outputs, cron/provider/database secrets, idempotency records, logs, and test
artifacts. Only synthetic handles/content may enter this repository or no-auth deployment.

Trust boundaries:

1. Browser/Expo-web or native client -> public Next.js `/api/v1` adapter.
2. Thin route adapter -> server-only backend application service.
3. Application service -> PostgreSQL repository/transaction.
4. Application service -> model gateway/recorded fixture.
5. Cron caller -> secret-protected job adapter.
6. Build-time public bundle -> server environment/secrets.
7. CI/test process -> retained evidence artifacts.

Agents are untrusted content generators. They have no database/tool capability and cannot publish,
approve, create hard constraints, select/lower accountability tier, or bypass deterministic gates.

## STRIDE analysis

| Threat | Example | Primary control |
|---|---|---|
| Spoofing | Caller acts as seeded coach because there is no auth | Synthetic-demo production guard; no real data/deployment |
| Tampering | Client changes approver, band, client ID, or auto-apply field | Strict schemas, server-owned fields, transactions, state machine |
| Repudiation | Override/edit/job cannot be attributed | Append-only actions, request/run IDs, reasons, timestamps |
| Information disclosure | Raw notes/secrets leak in logs, bundles, errors, evidence | Redaction, allowlisted public env, scans, sanitized errors |
| Denial of service | Oversized body, generation flood, slow DB/provider | Body/rate/concurrency limits, timeouts, bounded queues |
| Elevation of privilege | Prompt tells agent to publish or mutate constraints | No tools/repositories in agents; deterministic application authorization |

## Threat-driven security requirements

| ID | Blocking control/test | Command |
|---|---|---|
| `SEC-001` | Production startup without auth requires explicit synthetic-demo mode and verifies seeded data is synthetic; otherwise exits. | `pnpm test:security` |
| `SEC-002` | Requests are strict-schema validated; server-owned actor/client/state fields cannot be mass-assigned. | `pnpm test:security` |
| `SEC-003` | SQL/JSON/path inputs cannot inject queries or escape client scoping. | `pnpm test:security` |
| `SEC-004` | Stored/reflected model, note, check-in, reason, and error content renders as text; XSS payload corpus is inert. | `pnpm test:security && pnpm test:e2e:web` |
| `SEC-005` | Prompt injection cannot grant DB/tools, publish, approve, alter hard constraints, or change tier ownership. | `pnpm test:safety && pnpm test:security` |
| `SEC-006` | Secrets are absent from git, logs, traces, fixtures, source maps, public env, web/native bundles, and evidence. | `pnpm test:security` |
| `SEC-007` | PII/real health data patterns are absent from seed, fixtures, traces, logs, screenshots, and artifacts. | `pnpm test:security && pnpm evidence:verify` |
| `SEC-008` | Cron secret is required outside demo, compared safely, rate-limited, and never accepted from query strings. | `pnpm test:security` |
| `SEC-009` | CORS allowlist and CSP/HSTS/nosniff/referrer/frame/permissions headers match environment. | `pnpm test:security` |
| `SEC-010` | Per-route body size, request rate, and generation concurrency limits return bounded 413/429 responses. | `pnpm test:security` |
| `SEC-011` | Production dependencies have zero unresolved critical/high exploitable advisories. | `pnpm test:security` |
| `SEC-012` | Images scan with zero critical/high findings, use pinned bases, non-root user, and minimal capabilities. | `pnpm test:security` |
| `SEC-013` | Errors expose no stack, SQL, filesystem path, provider body, secret, or internal object. | `pnpm test:security` |
| `SEC-014` | Idempotency prevents replay from duplicating review, publication, jobs, logs, or messages. | `pnpm test:concurrency` |
| `SEC-015` | Model/provider URLs are configuration allowlisted; user content cannot cause SSRF or arbitrary fetch. | `pnpm test:security` |
| `SEC-016` | Open redirects, path traversal, prototype pollution, and unsafe object merges are rejected. | `pnpm test:security` |
| `SEC-017` | Database role is not superuser, schema privileges are minimal, and pgvector is the only required extension. | `pnpm test:docker` |
| `SEC-018` | Logs are structured/redacted and resistant to newline/log-forging payloads. | `pnpm test:security` |
| `SEC-019` | SBOM is produced for deployable images and retained with image digests. | `pnpm test:security` |
| `SEC-020` | Any advisory exception names package/CVE, reachability, compensating control, owner, and expiry. | `pnpm evidence:verify` |

Security tooling includes a secret scanner, `pnpm audit --prod`, static source/bundle checks,
OWASP-oriented HTTP tests, and an image/SBOM scanner such as Trivy/Syft. Tool database/network
failures are not reported as clean scans; release evidence states the scan failed.

## Abuse cases

- Repeated generate/job calls with new keys must hit rate/concurrency limits.
- A client ID in body may not override the client in the route/use case.
- Markdown/HTML/URL/script payloads from clients or models remain inert in both UIs and exports.
- A malicious note may influence text only within its declared context priority; it cannot redefine
  system policy, omit pinned constraints, or become a hard constraint.
- An attacker reading public client code cannot recover database/provider/cron credentials.
- A crafted model response cannot smuggle undeclared operations through permissive JSON.

The final report separates accepted architectural exposure (`no auth + synthetic only`) from
remediable defects. Any evidence of real data, secret exposure, safety bypass, or production no-auth
misconfiguration is an immediate release blocker.
