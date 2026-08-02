# Test evidence and autonomous defect loop

## Evidence location and identity

Each verification attempt writes only inside:

```text
artifacts/verification/<YYYYMMDDTHHMMSSZ>-<short-revision>-<attempt>/
```

Runtime artifacts may be gitignored, but their schema and the final human-readable release summary
are versioned. Evidence is retained before a failing environment is torn down.

## Manifest

`manifest.json` is machine validated and contains:

```json
{
  "schemaVersion": 1,
  "runId": "20260802T020000Z-abcdef12-01",
  "suite": "full",
  "revision": {
    "git": "abcdef1234567890abcdef1234567890abcdef12",
    "dirty": false,
    "contentHash": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "fileCount": 420,
    "sourceStable": true
  },
  "startedAt": "2026-08-02T02:00:00Z",
  "finishedAt": "2026-08-02T02:20:00Z",
  "environment": {
    "node": "v24.11.1",
    "pnpm": "10.20.0",
    "docker": "29.0.1",
    "compose": "2.40.3-desktop.1",
    "git": "git version 2.50.1",
    "os": "darwin-arm64"
  },
  "sourceContracts": [
    {
      "path": "DOCS/architecture/requirements.md",
      "sha256": "sha256:123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0"
    }
  ],
  "commands": [
    {
      "id": "cmd-001",
      "command": "pnpm run install:frozen",
      "script": "install:frozen",
      "startedAt": "2026-08-02T02:00:01Z",
      "finishedAt": "2026-08-02T02:00:02Z",
      "durationMs": 1000,
      "exitCode": 0,
      "log": "logs/cmd-001.log",
      "logSha256": "sha256:23456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01",
      "attempt": 1,
      "testCounts": {
        "kind": "gate-command",
        "discovered": 1,
        "executed": 1,
        "skipped": 0,
        "retried": 0
      }
    }
  ],
  "requirements": [
    { "id": "AI-002", "status": "passed", "evidence": ["logs/cmd-001.log"] },
    {
      "id": "QA-MOB-006",
      "status": "not-run",
      "evidence": ["KNOWN-LIMITATIONS.md"],
      "exception": "ENV-MOB-001"
    }
  ],
  "exceptions": [
    {
      "id": "ENV-MOB-001",
      "status": "not-run",
      "reason": "The host has no approved native simulator or device runner."
    }
  ],
  "verdict": "pass"
}
```

The example is intentionally small, but it validates against
`backend/infra/evidence/manifest.schema.json`. A real full manifest contains the complete ordered
command and requirement inventories enforced by `pnpm evidence:verify`.

Dirty worktrees are allowed during implementation, so `contentHash` must cover tested owned files;
the final report cannot identify only a commit that omits tested changes.

## Required artifact layout

```text
environment.json
manifest.json
checksums.sha256
logs/
reports/
  junit/
  coverage/
  mutation/
  safety/
  contract/
  integration/
  concurrency/
  e2e/coach/
  e2e/client/
  accessibility/
  mobile/
  performance/
  resilience/
  security/
  docker/
  defects/
    defect-history.json
    first-failures/
  traceability.json
FINAL-QUALITY-REPORT.md
KNOWN-LIMITATIONS.md
```

Playwright traces/screenshots/videos are retained for failures and representative passing critical
journeys. Reports identify tool version, config, seed, duration, tests discovered/executed/skipped,
retries, and exit status. Evidence links use relative paths and checksums.

`reports/defects/defect-history.json` is copied from the committed defect history source for the
final run. Each runtime-failure record identifies its immutable pre-fix artifact and the regression
or gate that supersedes it. Review findings are distinguished from executed failures; a historical
failure whose raw output was not retained remains an explicit evidence gap until replaced by honest
reproduction evidence.

## Evidence requirements

| ID           | Requirement                                                                                    | Command                                      |
| ------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `QA-EVD-001` | Manifest validates against a committed schema and references existing artifacts.               | `pnpm evidence:verify`                       |
| `QA-EVD-002` | Tested revision/content hash and source-contract hashes are exact.                             | `pnpm evidence:verify`                       |
| `QA-EVD-003` | Every architecture and QA/NFR/SEC requirement has pass/fail/not-applicable evidence.           | `pnpm evidence:verify`                       |
| `QA-EVD-004` | Discovered/executed/skipped/retried counts are present; blocking skip/retry cannot yield pass. | `pnpm evidence:verify`                       |
| `QA-EVD-005` | Artifacts pass secret, identity/PII, and prohibited real-data scans.                           | `pnpm evidence:verify && pnpm test:security` |
| `QA-EVD-006` | Logs and reports are checksummed; broken/missing links fail validation.                        | `pnpm evidence:verify`                       |
| `QA-EVD-007` | Failures retain pre-fix evidence and reference the defect/fix attempt that superseded them.    | `pnpm evidence:verify`                       |
| `QA-EVD-008` | `ENV-MOB-001` is explicit; native proof is never fabricated.                                   | `pnpm evidence:verify`                       |
| `QA-EVD-009` | Final report distinguishes deterministic acceptance, live observations, and not-run checks.    | `pnpm evidence:verify`                       |

## Autonomous defect loop

For every failure:

1. Freeze the failing output, command, environment, request/trace IDs, seed, and durable DB state.
2. Reproduce with the smallest stable command; never change code before confirming when feasible.
3. Classify: `product`, `test`, `fixture/contract`, `environment`, `performance`, `security`, or
   `flake`.
4. Trace the failure to requirement IDs and diagnose the first violated invariant/root cause.
5. Add or preserve a regression test that fails for the diagnosed behavior.
6. Apply the smallest correct fix without weakening boundaries or adjacent invariants.
7. Run the targeted test repeatedly enough to expose the original timing/flake condition.
8. Run the affected package, consumers, and relevant security/safety/NFR blast radius.
9. Run `pnpm verify`; at pool/release boundaries rerun `pnpm verify:full` from clean Docker.
10. Retain before/after evidence and update traceability/known limitations.

## Prohibited green-making

- Delete, skip, focus away, quarantine, or broadly mock a valid test.
- Add a CI retry that hides a first-attempt Tier A failure.
- Lower coverage, mutation, accessibility, performance, or scan thresholds without an approved ADR.
- Catch/ignore an error, hard-code a fixture result, disable strict types, or return fake success.
- Replace PostgreSQL evidence with PGlite or browser/native behavior with snapshots alone.
- Alter expected output merely to match current implementation.

A flaky blocking test is failed. Gather repeated-run evidence, fix its product/test isolation root
cause, and require a clean no-retry acceptance run.

After three unsuccessful distinct fixes for the same root cause, an independent reviewer reopens
diagnosis from the requirement/evidence without inheriting the current hypothesis. Autonomous work
continues with a different approach. It stops as blocked only for a genuine external limitation or
irreconcilable approved-contract conflict, reported with exact evidence; difficulty is not a
blocker.
