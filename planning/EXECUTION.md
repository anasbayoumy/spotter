# Autonomous delivery plan

The root orchestrator coordinates three specialist agents per pool and owns integration, shared
manifests, the lockfile, Docker, CI, canonical traceability, and Git publication.

| Pool | Scope                                                      | Exit gate                                                   |
| ---- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| 0    | Requirements, architecture, testing contract               | Canonical requirement IDs and reconciled decisions          |
| 1    | Workspace/Docker, contracts/domain, data/migrations        | Install, static checks, migration/seed and database parity  |
| 2    | Agents/evals, application use cases, jobs                  | Backend behavior and deterministic pipeline tests           |
| 3    | REST adapters, coach console, client application           | Three product loops operate end to end                      |
| 4    | Unit/property, integration/concurrency, safety/adversarial | Deterministic release suite meets coverage and safety gates |
| 5    | Web/mobile, performance/resilience, security/architecture  | Non-functional budgets and audits pass                      |
| 6    | Independent certification and any required fix waves       | Zero unresolved critical/high defects and complete evidence |

Pools are sequential. Agents in a pool own disjoint paths. At each boundary, the root runs
authoritative integration checks and records a Git checkpoint. A failing gate enters reproduce →
diagnose → regression test → smallest fix → targeted retest → affected suite → full regression.
There is no arbitrary retry cap for code defects.
