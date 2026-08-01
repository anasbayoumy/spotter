# Requirement-to-command matrix

This is the minimum automated mapping. Detailed scenarios and evidence live in the linked testing
documents. Implementation paths and artifact paths are added to `../traceability.md` during build.

## Canonical architecture requirements

| Architecture ID | Primary quality evidence                                           | Required command                                                 |
| --------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `SYS-001`       | Root/working-directory architecture assertion                      | `pnpm lint:boundaries`                                           |
| `SYS-002`       | Top-level application-folder assertion                             | `pnpm lint:boundaries`                                           |
| `SYS-003`       | Single web deployable/build and Compose topology                   | `pnpm build && pnpm test:docker`                                 |
| `SYS-004`       | Backend server-only/no-listener negative test                      | `pnpm lint:boundaries && pnpm test:unit`                         |
| `SYS-005`       | Shared REST contract and Expo-web/mobile proof                     | `pnpm test:contract && pnpm test:mobile && pnpm test:e2e:client` |
| `SYS-006`       | No Redis/broker/worker/backend service in resolved Compose         | `pnpm test:docker`                                               |
| `BND-001`       | Presentation import boundary                                       | `pnpm lint:boundaries`                                           |
| `BND-002`       | Thin adapter architecture/unit tests                               | `pnpm lint:boundaries && pnpm test:unit`                         |
| `BND-003`       | Pure domain negative dependency test                               | `pnpm lint:boundaries`                                           |
| `BND-004`       | Contracts package dependency/schema tests                          | `pnpm lint:boundaries && pnpm test:contract`                     |
| `BND-005`       | Envelope/request-ID input/output validation                        | `pnpm test:contract`                                             |
| `BND-006`       | Idempotency provider + concurrent replay tests                     | `pnpm test:contract && pnpm test:concurrency`                    |
| `BND-007`       | Server-only negative bundle/import test                            | `pnpm build && pnpm test:security`                               |
| `DAT-001`       | Empty PostgreSQL migration/integration protocol                    | `pnpm test:integration && pnpm test:docker`                      |
| `DAT-002`       | Cross-adapter conformance, labeled non-authoritative               | `pnpm test:integration:pglite && pnpm test:integration`          |
| `DAT-003`       | Append-only/supersession constraints and repository tests          | `pnpm test:integration`                                          |
| `DAT-004`       | Time-boundary/filter-before-rank fixtures                          | `pnpm test:integration && pnpm test:safety`                      |
| `DAT-005`       | Approval/unique-current DB constraint and race                     | `pnpm test:integration && pnpm test:concurrency`                 |
| `DAT-006`       | Fault rollback and concurrent publication                          | `pnpm test:integration && pnpm test:resilience`                  |
| `DAT-007`       | Blocked approval/override reason tests                             | `pnpm test:contract && pnpm test:e2e:web`                        |
| `DAT-008`       | Immutable published edit/version history                           | `pnpm test:integration && pnpm test:e2e:web`                     |
| `DAT-009`       | Pre-call trace with timeout/invalid-output injection               | `pnpm test:integration && pnpm test:resilience`                  |
| `DAT-010`       | DB-enforced job/idempotency/message races                          | `pnpm test:concurrency`                                          |
| `DAT-011`       | UTC/IANA/DST tests with injected clock                             | `pnpm test:unit && pnpm test:integration`                        |
| `AI-001`        | Deterministic routing/assembly and gateway boundary                | `pnpm test:unit && pnpm lint:boundaries`                         |
| `AI-002`        | Pinning/budget stress fixtures and mutation tests                  | `pnpm test:safety && pnpm test:mutation`                         |
| `AI-003`        | Malformed/partial recording contract and fault tests               | `pnpm test:contract && pnpm test:resilience`                     |
| `AI-004`        | Pipeline-order and 50-case safety results                          | `pnpm test:safety`                                               |
| `AI-005`        | Distinct model config and redacted judge payload contract          | `pnpm test:contract`                                             |
| `AI-006`        | Recorded deterministic replay/no-network and live adapter contract | `pnpm verify && pnpm test:contract`                              |
| `AI-007`        | Agent capability/import negative tests                             | `pnpm lint:boundaries && pnpm test:security`                     |
| `AI-008`        | Exhaustive review-band decision table                              | `pnpm test:unit && pnpm test:safety`                             |
| `FLOW-001`      | Complete weekly plan-loop acceptance                               | `pnpm test:e2e:web && pnpm test:e2e:client`                      |
| `FLOW-002`      | Adjustment approval-only regression/E2E                            | `pnpm test:safety && pnpm test:e2e:web`                          |
| `FLOW-003`      | Write-then-assemble integration/E2E                                | `pnpm test:integration && pnpm test:e2e:client`                  |
| `FLOW-004`      | Tier/ownership state-machine/property tests                        | `pnpm test:unit && pnpm test:safety`                             |
| `FLOW-005`      | 48-hour boundaries and concurrent message race                     | `pnpm test:safety && pnpm test:concurrency`                      |
| `FLOW-006`      | Client leakage contract/E2E corpus                                 | `pnpm test:contract && pnpm test:e2e:client`                     |
| `FLOW-007`      | Duplicate/concurrent job and recovery tests                        | `pnpm test:concurrency && pnpm test:resilience`                  |
| `PRV-001`       | No-auth surface/dependency inspection, seeded actor action         | `pnpm lint:boundaries && pnpm test:e2e:web`                      |
| `PRV-002`       | Production startup synthetic-demo fail-closed test                 | `pnpm test:security`                                             |
| `PRV-003`       | Mixed synthetic classification integration test                    | `pnpm test:integration && pnpm test:security`                    |
| `PRV-004`       | Trace/log/error redaction payload corpus                           | `pnpm test:security`                                             |
| `PRV-005`       | Fixture/recording/artifact real-data scan                          | `pnpm test:security && pnpm evidence:verify`                     |
| `PRV-006`       | Cron secret route matrix                                           | `pnpm test:contract && pnpm test:security`                       |
| `OPS-001`       | Correlation propagation integration and log assertion              | `pnpm test:integration`                                          |
| `OPS-002`       | Timeout/bounded retry fault injection                              | `pnpm test:resilience`                                           |
| `OPS-003`       | Health/migration dependency protocol                               | `pnpm test:docker`                                               |
| `OPS-004`       | Keyless/offline deterministic acceptance                           | `pnpm verify`                                                    |
| `OPS-005`       | Full aggregate gate and evidence verification                      | `pnpm verify:full && pnpm evidence:verify`                       |

## Quality requirement families

| IDs                 | Source                                                                             | Required command(s)                                                              |
| ------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `QA-STR-001..008`   | [`01-test-strategy.md`](01-test-strategy.md)                                       | `pnpm verify`, `pnpm verify:full`, `pnpm evidence:verify`                        |
| `QA-STA-001..010`   | [`02-static-coverage-mutation.md`](02-static-coverage-mutation.md)                 | Frozen install, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` |
| `QA-ARC-001..008`   | [`02-static-coverage-mutation.md`](02-static-coverage-mutation.md)                 | `pnpm lint:boundaries`                                                           |
| `QA-COV-001..007`   | [`02-static-coverage-mutation.md`](02-static-coverage-mutation.md)                 | `pnpm test:unit --coverage`, `pnpm coverage:changed`                             |
| `QA-MUT-001..005`   | [`02-static-coverage-mutation.md`](02-static-coverage-mutation.md)                 | `pnpm test:mutation`                                                             |
| `QA-SAF-001..058`   | [`03-safety-golden-set.md`](03-safety-golden-set.md)                               | `pnpm test:safety`                                                               |
| `QA-API-001..014`   | [`04-contract-integration-concurrency.md`](04-contract-integration-concurrency.md) | `pnpm test:contract` plus linked security/resilience                             |
| `QA-DB-001..016`    | [`04-contract-integration-concurrency.md`](04-contract-integration-concurrency.md) | PostgreSQL/PGlite integration commands                                           |
| `QA-CON-001..009`   | [`04-contract-integration-concurrency.md`](04-contract-integration-concurrency.md) | `pnpm test:concurrency`                                                          |
| `QA-E2E-001..012`   | [`05-e2e-accessibility-mobile.md`](05-e2e-accessibility-mobile.md)                 | `pnpm test:e2e:web`                                                              |
| `QA-CLI-001..010`   | [`05-e2e-accessibility-mobile.md`](05-e2e-accessibility-mobile.md)                 | `pnpm test:e2e:client`                                                           |
| `QA-A11Y-001..008`  | [`05-e2e-accessibility-mobile.md`](05-e2e-accessibility-mobile.md)                 | `pnpm test:a11y`, `pnpm test:mobile`                                             |
| `QA-MOB-001..006`   | [`05-e2e-accessibility-mobile.md`](05-e2e-accessibility-mobile.md)                 | `pnpm test:mobile`; `QA-MOB-006` is `ENV-MOB-001`                                |
| `NFR-PERF-001..010` | [`06-performance-resilience.md`](06-performance-resilience.md)                     | `pnpm test:performance`                                                          |
| `NFR-RES-001..014`  | [`06-performance-resilience.md`](06-performance-resilience.md)                     | `pnpm test:resilience` and linked E2E                                            |
| `SEC-001..020`      | [`07-security-threat-model.md`](07-security-threat-model.md)                       | `pnpm test:security` plus linked suites                                          |
| `QA-DKR-001..014`   | [`08-docker-verification.md`](08-docker-verification.md)                           | `pnpm test:docker`                                                               |
| `QA-EVD-001..009`   | [`09-evidence-and-fix-loop.md`](09-evidence-and-fix-loop.md)                       | `pnpm evidence:verify`                                                           |
| `QA-REL-001..016`   | [`10-release-definition-of-done.md`](10-release-definition-of-done.md)             | `pnpm verify:full && pnpm evidence:verify`                                       |
