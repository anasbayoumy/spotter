# Spotter V1 quality contract

This directory is the canonical verification contract for Spotter V1. A feature is not complete
because it works once or because its author says it is complete. It is complete only when the
required automated gates pass and the evidence is retained in the format defined here.

## Scope and authority

These documents normalize the quality requirements from the discovery documents and the approved
architecture contract. If two statements conflict, use the precedence in
[`../README.md`](../README.md). Stable requirement IDs in this directory are never reused; a retired
requirement remains recorded as retired.

The release environment has Docker, Node.js, and Corepack. Docker PostgreSQL 16 with pgvector is the
authoritative integration and release database. PGlite is a fast/demo adapter and must pass parity
tests, but a PGlite result cannot replace PostgreSQL evidence.

There is no native iOS simulator or Maestro runner in the authorized environment. Mandatory V1
mobile proof is therefore React Native component testing, Expo configuration/doctor checks,
successful iOS and Android native bundle export, and Expo-web end-to-end testing. The missing
device/simulator run is the explicit environmental exception `ENV-MOB-001`; it must appear in the
release report and must never be described as executed. Once a suitable runner exists, `QA-MOB-006`
becomes mandatory without changing the rest of this contract.

## Documents

- [`01-test-strategy.md`](01-test-strategy.md): layers, ownership, environments, and execution
  order.
- [`02-static-coverage-mutation.md`](02-static-coverage-mutation.md): static, coverage,
  architecture, and mutation gates.
- [`03-safety-golden-set.md`](03-safety-golden-set.md): the exact 50 deterministic safety fixtures.
- [`04-contract-integration-concurrency.md`](04-contract-integration-concurrency.md): HTTP,
  database, transaction, adapter-parity, and race-condition gates.
- [`05-e2e-accessibility-mobile.md`](05-e2e-accessibility-mobile.md): coach, client, accessibility,
  responsive, and mobile gates.
- [`06-performance-resilience.md`](06-performance-resilience.md): blocking performance budgets and
  controlled failure tests.
- [`07-security-threat-model.md`](07-security-threat-model.md): assets, boundaries, threats, and
  security verification.
- [`08-docker-verification.md`](08-docker-verification.md): authoritative clean-room Docker
  protocol.
- [`09-evidence-and-fix-loop.md`](09-evidence-and-fix-loop.md): evidence schema and defect loop.
- [`10-release-definition-of-done.md`](10-release-definition-of-done.md): final release decision.
- [`11-requirement-command-matrix.md`](11-requirement-command-matrix.md): stable ID-to-command map.

## Canonical commands

The implementation must expose these root commands. More specific scripts may exist, but CI and
release evidence use these names.

| Command                                   | Contract                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `corepack pnpm install --frozen-lockfile` | Reproducible dependency installation                                                  |
| `pnpm verify`                             | Fast deterministic gate: format, lint, boundaries, types, unit, PGlite parity, safety |
| `pnpm verify:full`                        | All mandatory gates including authoritative Docker, E2E, NFR, and security            |
| `pnpm format:check`                       | Formatting only; never rewrites during verification                                   |
| `pnpm lint`                               | ESLint and forbidden-pattern checks                                                   |
| `pnpm typecheck`                          | Strict TypeScript across every workspace                                              |
| `pnpm test:unit`                          | Unit/component tests with coverage                                                    |
| `pnpm test:integration`                   | PostgreSQL integration/contract tests via Docker                                      |
| `pnpm test:integration:pglite`            | Fast/demo adapter parity suite                                                        |
| `pnpm test:contract`                      | Shared Zod and REST provider/consumer contracts                                       |
| `pnpm test:concurrency`                   | Transaction, idempotency, and race tests                                              |
| `pnpm test:safety`                        | The committed deterministic 50-case suite plus safety properties                      |
| `pnpm test:mutation`                      | Targeted mutation suite for safety-critical code                                      |
| `pnpm test:e2e:web`                       | Coach-console Playwright journeys                                                     |
| `pnpm test:e2e:client`                    | Expo-web client Playwright journeys                                                   |
| `pnpm test:a11y`                          | Axe and keyboard/focus journeys on both web surfaces                                  |
| `pnpm test:mobile`                        | RN component tests, Expo doctor/config, and native bundle exports                     |
| `pnpm test:performance`                   | Repeatable performance budgets against Docker                                         |
| `pnpm test:resilience`                    | Controlled dependency-failure and recovery suite                                      |
| `pnpm test:security`                      | Source, dependency, secret, HTTP, and container security gates                        |
| `pnpm test:docker`                        | Authoritative Docker protocol in `08-docker-verification.md`                          |
| `pnpm build`                              | Production builds/exports for every deployable surface                                |
| `pnpm evidence:verify`                    | Evidence schema, checksums, secret/PII scan, and completeness                         |
| `pnpm --filter backend calibrate`         | Reports pending human labels; never invents kappa                                     |
| `pnpm --filter backend record:fixtures`   | Re-captures every model fixture from an explicitly configured live endpoint           |

All mandatory acceptance runs use recorded model mode and require no external AI key. Live-model
evaluation is informative unless separately approved; it cannot turn a deterministic failure green.

## Release principles

1. Safety, temporal correctness, publication approval, auditability, and human escalation fail
   closed.
2. No skipped, focused-only, quarantined, or retry-masked blocking test counts as green.
3. A failing valid test is fixed in product code or in the contract—not deleted or weakened.
4. Every failure produces a regression test when a stable automated reproduction is possible.
5. Authors may fix their work, but a final adversarial verification must be executed independently.
6. Test artifacts contain synthetic handles only and are scanned for secrets and PII.
7. An unavailable optional external service is recorded as not run, never represented as passing.
