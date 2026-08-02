# Client experience

The Expo Router app is Spotter's synthetic, no-auth client surface. The gallery below uses the
production web export at a 390 × 844 mobile viewport with deterministic public-contract fixtures.

## Verified client cases

| Test case                                            | Production screen                                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QA-CLI-001 — explicit synthetic-client selection** | [![Synthetic client selector](../DOCS/assets/screenshots/client-selector-mobile.png)](../DOCS/assets/screenshots/client-selector-mobile.png)                        |
| **QA-CLI-003 — unpublished-plan privacy boundary**   | [![No published plan client state](../DOCS/assets/screenshots/client-no-published-plan-mobile.png)](../DOCS/assets/screenshots/client-no-published-plan-mobile.png) |
| **QA-CLI-006 — readiness and feedback check-in**     | [![Client daily check-in](../DOCS/assets/screenshots/client-check-in-mobile.png)](../DOCS/assets/screenshots/client-check-in-mobile.png)                            |
| **QA-CLI-004/005 — approved session logging**        | [![Client session log](../DOCS/assets/screenshots/client-session-log-mobile.png)](../DOCS/assets/screenshots/client-session-log-mobile.png)                         |

The client can view approved work, submit readiness and feedback, and log session completion. It
cannot see drafts, proposals, internal evaluations, or coach-only rationale.
