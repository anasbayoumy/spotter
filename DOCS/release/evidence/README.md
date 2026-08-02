# Release-safe first-failure evidence

The tracked [`public/first-failures`](./public/first-failures) directory contains one compact JSON
summary per retained runtime defect. The machine index in
[`backend/tooling/verification/defect-history.json`](../../../backend/tooling/verification/defect-history.json)
pins every summary by SHA-256 and defines its destination in a final verification bundle. A clean
clone therefore contains every input needed to prepare and verify release evidence.

Each public summary contains only the reviewed failure facts and cryptographic provenance for its
original raw captures. Browser traces, videos, screenshots, verbose logs, and mutation payloads stay
immutable in the developer-local [`first-failures`](./first-failures) vault and are excluded from
Git. When that vault is available, the verifier also checks its file and directory-tree digests;
its absence in a fresh clone is intentional and does not weaken the pinned public summary.

The verifier rejects oversized summaries, embedded payload fields, stale ledger facts, unsafe raw
paths, ignored public sources, and digest mismatches. Generated passing reports and full release
logs remain under gitignored `artifacts/verification/`; `pnpm verify:full` regenerates and checksums
them.
