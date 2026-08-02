# Authoritative Docker verification protocol

`pnpm test:docker` implements this protocol and retains each command/result. It uses one web
service—the Next.js `frontend` process importing `backend`—not a separate backend service.

## Safety and isolation

- Generate a unique explicit Compose project: `spotter-qa-<UTC-run-id>`.
- Use the `test-postgres` profile/ephemeral volume for destructive verification.
- Never target an unnamed/default project, the development volume, a broad path, `~`, or `$HOME`.
- Before teardown, record resolved project/service/volume names and assert the project prefix.
- Fixed sleeps are forbidden; wait on Docker health/completion with bounded deadlines.

## Protocol

| Step/ID      | Required operation and assertion                                                                                                                                                                  | Evidence                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `QA-DKR-001` | Record Docker/Compose/Node/Corepack/pnpm versions, host architecture, git/worktree hash, and redacted config.                                                                                     | `environment.json`, `compose.rendered.yaml` |
| `QA-DKR-002` | `docker compose config --quiet`; assert services are exactly allowed topology (`postgres`, `migrate`, optional `seed`, `web`, test profile DB) with no backend/broker/worker.                     | Config log + topology assertion             |
| `QA-DKR-003` | Build web/migrate/seed images with `--pull --no-cache` and frozen lockfile.                                                                                                                       | Build log, image IDs/digests                |
| `QA-DKR-004` | Start empty PostgreSQL; wait healthy; assert version 16, non-superuser app role, expected DB, and pgvector extension.                                                                             | Inspect + SQL report                        |
| `QA-DKR-005` | Run the one-shot migration from empty DB; assert exit 0, committed migration checksums, and expected schema/index/constraint inventory.                                                           | Migration/JUnit/schema report               |
| `QA-DKR-006` | Run synthetic seed twice; second run changes no logical row counts/IDs and no non-synthetic record exists.                                                                                        | Seed logs + row/hash diff                   |
| `QA-DKR-007` | Start production web image only after migrations; `/health/live` and `/health/ready` pass. Assert one cluster primary plus exactly two discoverable workers; readiness includes schema/DB.        | Health transcript + process/inspect report  |
| `QA-DKR-008` | Exercise representative real HTTP read/write/generate/review/publish/client-read flow in recorded mode.                                                                                           | Contract/E2E JUnit + request IDs            |
| `QA-DKR-009` | Run PostgreSQL integration, concurrency, 50-case safety, live security HTTP, and resilience suites against this project; link performance to the separate mandatory root `test:performance` gate. | Linked suite reports                        |
| `QA-DKR-010` | Restart web; then restart PostgreSQL; health recovers within budget and committed data/idempotency remains correct.                                                                               | Restart timeline + post-state hashes        |
| `QA-DKR-011` | Scan health/status and logs for unhealthy containers, crashes, unhandled rejections, secrets, PII, raw provider/DB errors, and unexpected warnings.                                               | Redacted log scan report                    |
| `QA-DKR-012` | Assert web image runs non-root, has no Docker socket, no privileged mode/capability escalation, minimal writable paths, and no embedded `.env`/source secret.                                     | Inspect + image scan/SBOM                   |
| `QA-DKR-013` | Stop cleanly; prove the primary forwards SIGTERM, drains both workers without respawn inside 20 s, then remove only the validated unique QA project and ephemeral volumes.                        | Resolved target list + teardown log         |
| `QA-DKR-014` | Run PGlite parity separately; label it fast/demo evidence and never substitute it for steps 4–10.                                                                                                 | Parity report                               |

## Required smoke flow

1. List synthetic clients and fetch a client detail.
2. Generate a programme from a committed recording; verify trace precedes agent run.
3. Confirm evaluated queued draft is absent from client Today.
4. Approve a clear/attention draft or reason-override a blocked fixture.
5. Verify exactly one current approved programme and materialized session is client-visible.
6. Log/complete the session and submit a check-in with idempotency keys.
7. Generate an adjustment and prove it remains queued until coach approval.
8. Run accountability twice with the same run key and prove stable score/state/message results.
9. Navigate queue -> plan -> trace and validate exact selected/rendered context.

## Failure semantics

Any failed protocol step fails `pnpm test:docker`; teardown still runs in a `finally` path and does
not erase prior evidence. A tooling/image-registry/network failure is reported as infrastructure
failure, not a passing scan/build. Developers may run focused Docker scenarios, but release evidence
must come from the complete clean protocol.

This protocol verifies `SYS-003..006`, `DAT-001`, `DAT-005..010`, `FLOW-001..007`, `PRV-002..006`,
and `OPS-001..005`.
