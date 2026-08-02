# Spotter V1 known limitations

These are accepted V1 boundaries or non-blocking, explicitly controlled findings. None permits real
client data, a public no-auth deployment, or a high/critical vulnerability.

## `ENV-MOB-001` — native device runner unavailable

The current host has no approved iOS/Android simulator or physical-device runner, so native Maestro
proof is accurately `not-run`. React Native component/form/accessibility tests, Expo Doctor/config,
iOS and Android production exports, and Expo-web browser acceptance remain blocking and are not
waived.

Owner: Spotter maintainers. Expiry: rerun on an approved native runner before a public or real-data
release.

## `SEC-ADV-001` — transitive build-tool `uuid@7.0.3`

`pnpm audit --prod` reports moderate advisory `GHSA-w5hq-g745-h8pq` (CVE-2026-41907): missing
buffer-bound checks in UUID v3/v5/v6. The path is
`client-frontend > expo > @expo/config-plugins > xcode > uuid`; Spotter does not call those APIs,
pass caller-owned buffers to them, or ship this build-time Xcode dependency in the web/server
runtime. Production audit and image policy still require zero high/critical findings.

Compensating controls: synthetic-only data, pinned dependency graph, production bundle/image scans,
and reproducible iOS/Android exports. Owner: Spotter maintainers. Expiry: upgrade to a dependency
graph containing `uuid >=11.1.1` before 2026-09-01 or any public/real-data release, whichever is
earlier.

## `EVD-HIST-001` — five defect histories lack complete pre-fix evidence

The PostgreSQL Date-binding, payload-stale UI idempotency, Expo static-render timer, and duplicate
Expo-web heading defects were found before the strict evidence harness was complete. In addition,
the mutation audit overwrote intermediate failing reports while closing the survivors they exposed.
Those missing bytes are not reconstructed or misrepresented as retained evidence. The versioned
defect history records each gap, root cause, fix, and regression paths; retained runtime failures
carry pinned digests, the final mutation report and classification are bound exactly, and the final
same-content release suite must pass on its first attempt.

Owner: Spotter maintainers. Expiry: closed procedurally after this release by retaining
first-failure artifacts for every future blocking defect.

## Architectural V1 boundaries

- Authentication and tenancy are intentionally absent. Startup fails unless the deployment is
  explicitly synthetic-only; real client data is prohibited.
- Recorded model mode is the deterministic release target. Live provider observations cannot
  override deterministic gates and are not claimed as V1 acceptance evidence.
