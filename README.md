# Spotter

Spotter is a no-auth, synthetic-data V1 of an AI-assisted coaching system. It generates grounded
training programmes, evaluates them with deterministic safety rules and independent quality checks,
routes them through coach approval, and exposes only approved work to the client experience.

The implementation is being built from the canonical contract in [`DOCS/`](./DOCS/README.md). The
repository will contain:

- `frontend/`: Next.js coach console and thin REST adapters.
- `backend/`: server-only domain, application, persistence, agent, evaluation, and job modules.
- `client-frontend/`: Expo client application.
- `packages/`: shared contracts, configuration, design tokens, and test utilities.

Development, demo, verification, and architecture commands will be documented here as they become
executable. No real client data or credentials are required for the deterministic V1 path.
