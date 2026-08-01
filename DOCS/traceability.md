# Requirements traceability

This release index is updated as each implementation pool completes. A requirement is not complete until it points to implementation, automated verification, and retained evidence.

| Contract | Canonical mapping | Implementation mapping | Status |
|---|---|---|---|
| Product scope and behavior (`SCP`, `ACT`, `PLAN`, `REV`, `ADJ`, `ACC`, `COACH`, `CLIENT`, `API`, `OBS`, `DEMO`, `PRIV`) | [`requirements/requirements.md`](./requirements/requirements.md) and [`requirements/traceability.md`](./requirements/traceability.md) | Populated by Pools 1–6 in this file | Contract approved |
| Architecture (`SYS`, `BND`, `DAT`, `AI`, `FLOW`, `PRV`, `OPS`) | [`architecture/requirements.md`](./architecture/requirements.md) | Populated by Pools 1–6 in this file | Contract approved |
| Quality, safety, security, and non-functional (`QA`, `NFR`, `SEC`) | [`testing/README.md`](./testing/README.md) and [`testing/11-requirements-traceability.md`](./testing/11-requirements-traceability.md) | Populated by Pools 4–6 in this file | Contract approved |

## Implementation evidence

| Requirement group | Code | Tests | Evidence | Status |
|---|---|---|---|---|
| Workspace and boundaries | Pending Pool 1 | Pending Pool 1 | Pending | Planned |
| Data and transactions | Pending Pool 1 | Pending Pools 1/4 | Pending | Planned |
| Agent and evaluation pipeline | Pending Pool 2 | Pending Pools 2/4 | Pending | Planned |
| Plan, Adjust, Accountability | Pending Pool 2 | Pending Pools 2/4 | Pending | Planned |
| Coach and client surfaces | Pending Pool 3 | Pending Pools 3/5 | Pending | Planned |
| Safety and security | Pending Pools 2/4/5 | Pending Pools 4/5 | Pending | Planned |
| Release certification | Pending Pool 6 | `pnpm verify:full` | `artifacts/verification/` | Planned |
