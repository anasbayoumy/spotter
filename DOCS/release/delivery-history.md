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
| 6    | Independent verification and any required fix waves        | Zero unresolved critical/high defects and complete evidence |

Pools are sequential. Agents in a pool own disjoint paths. At each boundary, the root runs
authoritative integration checks and records a Git checkpoint. A failing gate enters reproduce →
diagnose → regression test → smallest fix → targeted retest → affected suite → full regression.
There is no arbitrary retry cap for code defects.

## Checkpoints

- Pool 0: canonical requirements, architecture, and testing contract — complete (`9d07d75`).
- Pool 1: typed workspace, contracts/domain, database adapters/migrations/seed — complete
  (`827f5a3`).
- Pool 2: intelligence runtime, evaluations, application workflows, jobs, and critical coverage —
  complete (`dd46af4`).
- Pool 3: public backend facade, REST/health adapters, contract-valid migrations/seed, coach
  console, and Expo client — complete (`8c25b39`).
- Pool 4: production-path adversarial/property tests, exact safety evidence, authoritative
  PostgreSQL races, and critical-scope mutation hardening — complete locally; checkpoint publication
  in progress.
