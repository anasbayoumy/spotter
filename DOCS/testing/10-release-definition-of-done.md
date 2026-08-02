# Release definition of done

## Release verdict

Spotter V1 receives a `pass` only when all conditions below are true for the same tested content
hash. `pass-with-known-limitations` is not a substitute for a blocking failure. The sole
pre-approved environmental exception is `ENV-MOB-001`; it permits the defined mobile substitute
evidence but not a claim of native simulator/device testing.

## Product completion

- The Plan loop works end to end: deterministic context/trace, recorded generation, validation,
  gates/judges/band, queue, edit/reject/approve/override, atomic publication, client visibility.
- The Adjust loop produces enumerated version-bound drafts and every V1 adjustment requires coach
  review before creating/publishing a new programme version.
- The Accountability loop computes deterministic versioned scores/tiers, escalates ownership only
  toward humans automatically, and transactionally enforces the rolling 48-hour cap.
- Session logs and check-ins become visible to the next context after commit.
- Queue, client detail, programme review, trace inspector, scorecard, Today, logging, history, and
  check-in surfaces include loading, empty, validation, conflict, dependency, and retry states.

## Non-negotiable invariant completion

- Active hard constraints cannot be evicted/truncated; hard-only budget overflow calls no model.
- Unknown families fail closed and all 50 golden outcomes pass.
- Expired, future, rejected, and superseded data cannot influence current context/client reads.
- No programme/adjustment reaches a client without coach approval; blocked requires reasoned
  override.
- Publication/supersession/session materialization/action insertion is atomic under failure/races.
- Every attempted model call has a pre-call trace and correlated run/evaluation/error evidence.
- Agents have no SQL, repository mutation, publication, approval, hard-constraint, or tier
  capability.
- Duplicate requests/jobs/signals remain idempotent under concurrency.
- Production no-auth starts only in verified synthetic-only mode; no real data/secrets/PII are
  present.

## Mandatory green gates

| ID           | Gate                                                                  | Required status                              |
| ------------ | --------------------------------------------------------------------- | -------------------------------------------- |
| `QA-REL-001` | Frozen install, format, lint/boundaries, strict types, generated diff | Pass                                         |
| `QA-REL-002` | Unit/component coverage and changed-lines thresholds                  | Pass                                         |
| `QA-REL-003` | Critical mutation thresholds and survivor review                      | Pass                                         |
| `QA-REL-004` | PGlite parity plus authoritative Docker PostgreSQL integration        | Pass                                         |
| `QA-REL-005` | Contract and all concurrency scenarios                                | Pass                                         |
| `QA-REL-006` | 50-case safety set and safety properties                              | Pass                                         |
| `QA-REL-007` | Coach and Expo-web client E2E; no unexpected console/network errors   | Pass                                         |
| `QA-REL-008` | Axe/keyboard/WCAG and RN accessibility assertions                     | Pass                                         |
| `QA-REL-009` | RN component, Expo doctor/config, iOS/Android export                  | Pass                                         |
| `QA-REL-010` | Native Maestro/device proof                                           | `not-run: ENV-MOB-001`, accurately disclosed |
| `QA-REL-011` | Performance budgets/baseline comparison                               | Pass                                         |
| `QA-REL-012` | Resilience/fault/restart/recovery scenarios                           | Pass                                         |
| `QA-REL-013` | Security, secret/PII, dependency, image, SBOM gates                   | Pass                                         |
| `QA-REL-014` | Clean-room Docker protocol                                            | Pass                                         |
| `QA-REL-015` | Production builds and server/client bundle separation                 | Pass                                         |
| `QA-REL-016` | Evidence schema/checksums/traceability/final report                   | Pass                                         |

The aggregate command is `pnpm verify:full`; `pnpm evidence:verify` verifies the verdict.

## Code and repository completion

- All implementation is under the approved root/folders and obeys architecture boundaries.
- Migrations, seed, recordings, golden fixtures, contracts, scripts, Docker, CI, and documentation
  are committed/complete for the tested content.
- No blocking TODO, placeholder, skipped/focused test, unexplained warning, blanket type/lint
  disable, unresolved critical/high exploitable finding, or undocumented threshold exception
  remains.
- Route adapters are thin; domain logic is deterministic/pure where specified; stateful services use
  explicit ports/transactions. Classes are used where lifecycle/encapsulation helps, not as
  ceremony.
- A clean Docker build/install requires no undeclared host dependency or AI credential.

## Evidence and handoff

`FINAL-QUALITY-REPORT.md` states the content hash, commands, gate results, requirement coverage,
defects fixed, performance numbers, security/image results, Docker health, live-eval status, exact
artifact paths, and limitations. `KNOWN-LIMITATIONS.md` includes `ENV-MOB-001` and excludes issues
that violate a mandatory gate.

An independent adversarial reviewer confirms the matrix and evidence before the orchestrator marks
the goal complete. If any mandatory item is red, missing, stale, or represented only by an author's
claim, the correct verdict is `fail` or `blocked`, never `pass`.
