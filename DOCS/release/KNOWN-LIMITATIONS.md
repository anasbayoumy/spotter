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

- All bundled clients, traces, screenshots, safety cases, and recordings use synthetic data. No real
  client has used or reviewed this system, and real client data is prohibited.
- `backend/resources/calibration/labels.json` is `pending_human_review` and intentionally contains
  no scores. Kappa is unavailable until a human scores the cases; `pnpm --filter backend calibrate`
  reports that state and the exact file to update.
- The five committed generator recordings were captured from `ollama/qwen3.6:35b-mlx`; each entry
  stores its capture timestamp, prompt-version hash, raw model text, parsed output, and token usage.
  Reproduce them with `pnpm --filter backend record:fixtures` and explicit live credentials.
- Recorded mode is always the default and requires no key or network. Live mode is optional and
  activates only with `SPOTTER_MODEL_MODE=live` plus a base URL, key, and distinct generator/judge
  model IDs.
- The supplied endpoint currently advertises only `ollama/qwen3.6:35b-mlx`. Generator recording was
  verified against it; an independent live-judge run was not possible because no second model ID was
  available. The equality guard rejects using that model as its own judge.
- Authentication and tenancy are intentionally absent. Startup fails unless a production-mode
  deployment is explicitly synthetic-only; public or real-data deployment is prohibited.
