# Spotter

Spotter is a no-auth, synthetic-data V1 of an AI-assisted coaching system. It generates grounded
training programmes, evaluates them with deterministic safety rules and independent quality checks,
routes them through coach approval, and exposes only approved work to the client experience.

The implementation follows the canonical contract in [`DOCS/`](./DOCS/README.md). The repository
contains:

- `frontend/`: Next.js coach console and thin REST adapters.
- `backend/`: server-only domain, application, persistence, agent, evaluation, job, shared-package,
  infrastructure, deterministic-resource, and verification-tooling modules.
- `client-frontend/`: Expo client application.

Backend-owned supporting assets are grouped by responsibility:

- `backend/packages/`: versioned cross-surface contracts, configuration, design tokens, and test
  utilities.
- `backend/resources/`: committed synthetic demo, real-model recordings, pending calibration labels,
  and deterministic safety data.
- `backend/infra/`: PostgreSQL initialization and verification schema declarations.
- `backend/tooling/`: repository verification and operational commands.

Generated reports, coverage, local state, dependencies, and credentials remain untracked. No real
client data or credentials are required for the deterministic V1 path.

For Docker startup, Expo launch, hands-on acceptance, automated E2E commands, and cleanup, follow
the [local and staging playbook](./playbook.md).

## Product screenshots

These are application-build screens rendered with deterministic synthetic fixtures.

### Coach console

| Current build                                                                                                                                       | What it shows                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [![Coach review queue](./DOCS/assets/screenshots/coach-review-queue.png)](./DOCS/assets/screenshots/coach-review-queue.png)                         | Populated review queue with risk-ranked items and safety findings.    |
| [![Coach programme review](./DOCS/assets/screenshots/coach-programme-review.png)](./DOCS/assets/screenshots/coach-programme-review.png)             | Safety-flagged programme with the deterministic gate finding visible. |
| [![Coach context trace](./DOCS/assets/screenshots/coach-context-trace.png)](./DOCS/assets/screenshots/coach-context-trace.png)                      | Exact context trace for the safety-flagged programme.                 |
| [![Coach evaluation scorecard](./DOCS/assets/screenshots/coach-evaluation-scorecard.png)](./DOCS/assets/screenshots/coach-evaluation-scorecard.png) | Evaluation scorecard generated from the seeded recorded-mode runs.    |

See the [coach console gallery](./frontend/README.md) for client context, traceability, and
evaluation evidence.

### Client experience

| Current build                                                                                                                          | What it shows                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [![Client today screen](./DOCS/assets/screenshots/client-today-mobile.png)](./DOCS/assets/screenshots/client-today-mobile.png)         | Today's current coach-published session in the mobile client. |
| [![Client daily check-in](./DOCS/assets/screenshots/client-check-in-mobile.png)](./DOCS/assets/screenshots/client-check-in-mobile.png) | Readiness and feedback check-in in the mobile client.         |

See the [client experience gallery](./client-frontend/README.md) for client selection and session
logging.
