# End-to-end, accessibility, responsive, and mobile gates

All browser journeys run against production builds, recorded model responses, synthetic seed data,
and Docker PostgreSQL. Network interception may induce failures but may not replace the backend on
happy-path acceptance journeys.

## Coach-console E2E

| ID           | Journey/assertion                                                                                              | Command             |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ------------------- |
| `QA-E2E-001` | `/` redirects to queue; blocked, attention, clear groups sort deterministically.                               | `pnpm test:e2e:web` |
| `QA-E2E-002` | Generate weekly plan, observe pending state, inspect gates/judges, and reach exact trace within two clicks.    | `pnpm test:e2e:web` |
| `QA-E2E-003` | Edit draft, retain diff/action evidence, approve, and publish atomically.                                      | `pnpm test:e2e:web` |
| `QA-E2E-004` | Reject with reason; rejected plan never appears to client.                                                     | `pnpm test:e2e:web` |
| `QA-E2E-005` | Ordinary approval of blocked plan fails; override requires and records a nonblank reason.                      | `pnpm test:e2e:web` |
| `QA-E2E-006` | Publishing next version supersedes current version while history remains inspectable.                          | `pnpm test:e2e:web` |
| `QA-E2E-007` | Client detail shows goals, active constraints, adherence, sessions, programme, and messages accurately.        | `pnpm test:e2e:web` |
| `QA-E2E-008` | Adjustment draft can be edited/approved/rejected but never auto-applies.                                       | `pnpm test:e2e:web` |
| `QA-E2E-009` | Accountability tier/owner/message suppression and coach context brief are visible and correct.                 | `pnpm test:e2e:web` |
| `QA-E2E-010` | Scorecard renders fixture counts, gate rates, calibration status, cost/latency, and honest unavailable values. | `pnpm test:e2e:web` |
| `QA-E2E-011` | Empty, loading, validation, 404, 409/stale, 429, 503, and retry states are actionable and do not lose input.   | `pnpm test:e2e:web` |
| `QA-E2E-012` | No uncaught browser error, hydration warning, failed asset, or unexpected request occurs.                      | `pnpm test:e2e:web` |

The current committed production coach suite passes all 12 journeys.

Screenshots are captured at 375×812, 768×1024, 1280×800, and 1440×900 for queue, client detail,
programme review, trace, and scorecard. Visual snapshots detect clipping/overlap, but semantic
assertions remain the acceptance source.

## Client Expo-web E2E

| ID           | Journey/assertion                                                                      | Command                |
| ------------ | -------------------------------------------------------------------------------------- | ---------------------- |
| `QA-CLI-001` | Select seeded synthetic client and preserve selection without identity data.           | `pnpm test:e2e:client` |
| `QA-CLI-002` | Today displays only the current approved programme/session/message.                    | `pnpm test:e2e:client` |
| `QA-CLI-003` | Draft, queued, rejected, blocked-unoverridden, and superseded content never appears.   | `pnpm test:e2e:client` |
| `QA-CLI-004` | Log sets, notes, RPE, and complete a session; refresh preserves one result.            | `pnpm test:e2e:client` |
| `QA-CLI-005` | Duplicate taps/retry do not duplicate work; validation retains entered values.         | `pnpm test:e2e:client` |
| `QA-CLI-006` | Readiness/free-text check-in changes the next assembled trace.                         | `pnpm test:e2e:client` |
| `QA-CLI-007` | History distinguishes completed, missed, and planned sessions in client timezone.      | `pnpm test:e2e:client` |
| `QA-CLI-008` | Eligible in-app nudge appears once; suppressed/human-owned automation does not appear. | `pnpm test:e2e:client` |
| `QA-CLI-009` | Offline/503 states preserve draft input and safe retry behavior.                       | `pnpm test:e2e:client` |
| `QA-CLI-010` | No uncaught console/runtime error or unexpected network request occurs.                | `pnpm test:e2e:client` |

The committed production suite contains nine Playwright journeys covering all ten IDs;
`QA-CLI-004/005` deliberately share one idempotent session-logging journey. Temporary screenshot
capture helpers are not counted as acceptance tests.

## Accessibility

| ID            | Blocking requirement                                                                     | Command            |
| ------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| `QA-A11Y-001` | Axe reports zero critical/serious violations on every primary/empty/error state.         | `pnpm test:a11y`   |
| `QA-A11Y-002` | All critical journeys complete by keyboard with visible focus and no trap.               | `pnpm test:a11y`   |
| `QA-A11Y-003` | Inputs have programmatic labels/instructions/errors; errors are announced.               | `pnpm test:a11y`   |
| `QA-A11Y-004` | Modal/dialog focus enters, remains contained, and returns to trigger.                    | `pnpm test:a11y`   |
| `QA-A11Y-005` | Tables/groups/headings expose meaningful structure; color is never sole signal.          | `pnpm test:a11y`   |
| `QA-A11Y-006` | Text and non-text contrast meet WCAG 2.2 AA; zoom/reflow works at 200%.                  | `pnpm test:a11y`   |
| `QA-A11Y-007` | Status changes such as generate/publish/error use suitable live announcements.           | `pnpm test:a11y`   |
| `QA-A11Y-008` | RN controls expose roles, labels, states, hints where needed, and >=44×44 touch targets. | `pnpm test:mobile` |

The current production accessibility suite passes 8/8 Playwright tests: five coach tests and three
client tests.

## Mobile proof and environmental exception

| ID           | Requirement                                                                                     | Command/status                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `QA-MOB-001` | RN route/components cover selector, Today, session form, history, check-in, offline and errors. | `pnpm test:mobile`                                                                        |
| `QA-MOB-002` | `expo-doctor` and resolved app config pass with no unsupported dependency/config issue.         | `pnpm test:mobile`                                                                        |
| `QA-MOB-003` | Production JS/assets export successfully for both iOS and Android.                              | `pnpm test:mobile`                                                                        |
| `QA-MOB-004` | Expo-web production export starts and passes client Playwright journeys.                        | `pnpm test:e2e:client`                                                                    |
| `QA-MOB-005` | Public mobile bundle contains no server secret/backend/database/model package.                  | `pnpm build && pnpm test:security`                                                        |
| `QA-MOB-006` | Maestro critical journeys pass on an actual native simulator/device.                            | `ENV-MOB-001`: not executable in current environment; must be reported, not marked passed |

The release can satisfy the approved V1 environment with `QA-MOB-001..005` green and `ENV-MOB-001`
disclosed. It may not claim native-device verification. Any later public-store or
device-distribution release requires `QA-MOB-006` before release.

The current native component and route suite passes 44/44 tests; this does not replace the disclosed
`ENV-MOB-001` native-device exception.
