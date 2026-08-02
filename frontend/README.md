# Coach console

The Next.js coach console is the human review surface for Spotter's deterministic, no-auth V1. These
screenshots were captured by the production Playwright suite at 1440 × 900 using synthetic QA
fixtures.

## Verified coach cases

| Test case                                         | Production screen                                                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QA-E2E-001 — deterministic risk ordering**      | [![Risk-ranked coach review queue](../DOCS/assets/screenshots/coach-review-queue.png)](../DOCS/assets/screenshots/coach-review-queue.png)             |
| **QA-E2E-007 — effective client context**         | [![Coach client workspace](../DOCS/assets/screenshots/coach-client-workspace.png)](../DOCS/assets/screenshots/coach-client-workspace.png)             |
| **QA-E2E-003 — evidence-backed programme review** | [![Coach programme review](../DOCS/assets/screenshots/coach-programme-review.png)](../DOCS/assets/screenshots/coach-programme-review.png)             |
| **QA-E2E-002 — immutable context trace**          | [![Coach context trace](../DOCS/assets/screenshots/coach-context-trace.png)](../DOCS/assets/screenshots/coach-context-trace.png)                      |
| **QA-E2E-010 — independent evaluation scorecard** | [![Coach evaluation scorecard](../DOCS/assets/screenshots/coach-evaluation-scorecard.png)](../DOCS/assets/screenshots/coach-evaluation-scorecard.png) |

Only published programmes cross the client visibility boundary; draft and proposed work remain in
the coach workflow.
