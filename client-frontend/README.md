# Client experience

The Expo Router app is Spotter's synthetic, no-auth client surface. The gallery below uses the
production web export at a 390 × 844 mobile viewport with deterministic public-contract fixtures.

## Verified client cases

| Test case                                            | Production screen                                                                                                                                                   | What it shows                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **QA-CLI-001 — explicit synthetic-client selection** | [![Synthetic client selector](../DOCS/assets/screenshots/client-selector-mobile.png)](../DOCS/assets/screenshots/client-selector-mobile.png)                        | Explicit synthetic-client selector and no-auth boundary.      |
| **QA-CLI-002 — current published session**           | [![Client today screen](../DOCS/assets/screenshots/client-today-mobile.png)](../DOCS/assets/screenshots/client-today-mobile.png)                                    | Today's current coach-published session.                      |
| **QA-CLI-003 — unpublished-plan privacy boundary**   | [![No published plan client state](../DOCS/assets/screenshots/client-no-published-plan-mobile.png)](../DOCS/assets/screenshots/client-no-published-plan-mobile.png) | Client-safe empty state when no programme has been published. |
| **QA-CLI-006 — readiness and feedback check-in**     | [![Client daily check-in](../DOCS/assets/screenshots/client-check-in-mobile.png)](../DOCS/assets/screenshots/client-check-in-mobile.png)                            | Readiness score and free-text feedback check-in.              |
| **QA-CLI-004/005 — approved session logging**        | [![Client session log](../DOCS/assets/screenshots/client-session-log-mobile.png)](../DOCS/assets/screenshots/client-session-log-mobile.png)                         | Completion state for an approved client-visible session.      |

The client can view approved work, submit readiness and feedback, and log session completion. It
cannot see drafts, proposals, internal evaluations, or coach-only rationale.
