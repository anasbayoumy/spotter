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

The former root `infra/`, `packages/`, fixtures, scripts, and planning folders are intentionally not
part of the public shape. Required implementation assets live under `backend/`; generated reports,
coverage, local memory, dependencies, and credentials remain untracked. No real client data or
credentials are required for the deterministic V1 path.

## Product screenshots

These are authentic production-build screens rendered with deterministic synthetic fixtures.

### Coach console

| Risk-ranked review queue                                                                                                    | Programme safety review                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [![Coach review queue](./DOCS/assets/screenshots/coach-review-queue.png)](./DOCS/assets/screenshots/coach-review-queue.png) | [![Coach programme review](./DOCS/assets/screenshots/coach-programme-review.png)](./DOCS/assets/screenshots/coach-programme-review.png) |

See the [coach console gallery](./frontend/README.md) for client context, traceability, and
evaluation evidence.

### Client experience

| Unpublished-plan privacy state                                                                                                                                              | Daily check-in                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [![Client experience with no published plan](./DOCS/assets/screenshots/client-no-published-plan-mobile.png)](./DOCS/assets/screenshots/client-no-published-plan-mobile.png) | [![Client daily check-in](./DOCS/assets/screenshots/client-check-in-mobile.png)](./DOCS/assets/screenshots/client-check-in-mobile.png) |

See the [client experience gallery](./client-frontend/README.md) for client selection and session
logging.
