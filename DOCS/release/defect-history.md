# Spotter V1 defect and fix-loop history

The versioned machine record at
[`backend/tooling/verification/defect-history.json`](../../backend/tooling/verification/defect-history.json)
owns defect identifiers, requirement mappings, diagnoses, corrections, regression paths, and pre-fix
artifact destinations. Compact retained evidence is under
[`evidence/public/first-failures`](./evidence/public/first-failures).

This page is an index, not a current quality verdict. Historical test counts, coverage percentages,
mutation percentages, and timing measurements were removed from this human summary because the
current tree cannot reproduce an old revision's result. Run the current commands in
[`testing/11-requirement-command-matrix.md`](../testing/11-requirement-command-matrix.md) for
current behavior.

Validate the machine ledger and retained public evidence with:

```bash
node --test backend/tooling/verification/defect-evidence.test.mjs
```

The ledger deliberately distinguishes focused regression evidence from same-content release
evidence. A focused pass is not a claim that `pnpm verify:full` or `pnpm evidence:verify` passed.
Blocking validation states remain blocking.

The records for `DEF-003`, `DEF-009`, `DEF-010`, `DEF-018`, and `DEF-023` disclose incomplete raw
pre-fix evidence. They must not be described as preserved pre-fix proof unless an honest
reproduction against the affected revision is retained.
