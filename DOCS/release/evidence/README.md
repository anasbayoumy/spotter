# Retained first-failure evidence

This directory contains the small, immutable subset of pre-fix evidence needed to make the Spotter
V1 defect loop reproducible from a fresh clone. The machine index in
[`scripts/verification/defect-history.json`](../../../scripts/verification/defect-history.json) pins
each file or directory tree by SHA-256 and defines its destination in a final verification bundle.

The retained browser traces contain synthetic demo data only. Generated passing reports and full
release logs remain under gitignored `artifacts/verification/`; they are regenerated and checksummed
by `pnpm verify:full`.
