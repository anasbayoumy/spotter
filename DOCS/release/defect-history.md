# Spotter V1 defect and fix-loop history

This is the human index for the versioned machine record at
[`backend/tooling/verification/defect-history.json`](../../backend/tooling/verification/defect-history.json).
The machine record owns exact requirement mappings, diagnoses, corrections, regression paths, and
pre-fix artifact copy destinations.

The frozen sources live under [`evidence/first-failures`](./evidence/first-failures) so a fresh
clone can reproduce the evidence bundle without relying on a developer's gitignored runtime
directories.

It is deliberately not a final quality verdict. `fixed-targeted-validation` means the focused
regression passed; it does not mean `pnpm verify:full` or `pnpm evidence:verify` passed for the
final content hash. `open-release-blocker`, `fix-in-progress`, and `release-pending` remain
blocking.

| ID        | Finding                                            | Class       | Current evidence state                           |
| --------- | -------------------------------------------------- | ----------- | ------------------------------------------------ |
| `DEF-001` | Incomplete adjustment review/publication path      | product     | Focused regressions pass; release pending        |
| `DEF-002` | Incomplete shared HTTP security controls           | security    | Standalone security passes; image proof pending  |
| `DEF-003` | PostgreSQL `Date` binding mismatch                 | product     | PostgreSQL regressions pass; first log absent    |
| `DEF-004` | Docker context/install failure                     | environment | 14/14 focused Docker pass; release pending       |
| `DEF-005` | Docker workspace build-order failure               | environment | 14/14 focused Docker pass; release pending       |
| `DEF-006` | Compose literal-`null` image inventory             | environment | 14/14 focused Docker pass; release pending       |
| `DEF-007` | Image scan hid findings without available fixes    | security    | 14/14 focused Docker pass; release pending       |
| `DEF-008` | Browser-state/runtime-guard isolation defects      | test        | Client gate passes; coach gate pending           |
| `DEF-009` | Payload-stale UI idempotency keys                  | product     | Focused/client retry gates pass                  |
| `DEF-010` | Static Expo-web query timer process hang           | test        | Native/export/client E2E gates pass              |
| `DEF-011` | Incomplete coverage execution attribution          | test        | Attribution fixed; real threshold gaps open      |
| `DEF-012` | Mutation sandbox copied local browser cache        | test        | Failure retained; corrected gate running         |
| `DEF-013` | Docker smoke asserted a private response field     | test        | 14/14 focused Docker pass; release pending       |
| `DEF-014` | Expo proxy canonicalized origin inconsistently     | test        | Failure retained; client gate passes             |
| `DEF-015` | Screenshot route reads were navigation-aborted     | test        | Failure retained; browser rerun pending          |
| `DEF-016` | Isolated PostgreSQL database lacked pgvector       | test        | 14/14 focused Docker pass; release pending       |
| `DEF-017` | Restart proof used tmpfs PostgreSQL storage        | test        | 14/14 focused Docker pass; release pending       |
| `DEF-018` | Expo-web session had duplicate page headings       | product     | First artifact absent; client gate passes        |
| `DEF-019` | Web readiness failed to recover after restart      | environment | 14/14 focused Docker pass; release pending       |
| `DEF-020` | Check-in redirected during selection restore       | product     | Failure retained; native/client gates pass       |
| `DEF-021` | Docker log gate omitted required scan classes      | test        | 14/14 focused Docker pass; release pending       |
| `DEF-022` | Docker teardown lost stopped container identity    | test        | 14/14 focused Docker pass; release pending       |
| `DEF-023` | Mutation iterations overwrote failing reports      | test        | Gap disclosed; final binding pending             |
| `DEF-024` | Mutation workers produced systemic runtime errors  | test        | Prior rerun clean; frozen-tree rerun pending     |
| `DEF-025` | Mocked suites substituted for live fault proof     | test        | 14/14 focused Docker pass; release pending       |
| `DEF-026` | Docker state/log scan omitted evidence streams     | test        | 14/14 focused Docker pass; release pending       |
| `DEF-027` | Restart proof covered partial state/replay         | test        | 14/14 focused Docker pass; release pending       |
| `DEF-028` | Image evidence accepted incomplete proof           | security    | 14/14 focused Docker pass; release pending       |
| `DEF-029` | Failure cleanup omitted networks and errors        | test        | 14/14 focused Docker pass; release pending       |
| `DEF-030` | DB/migration/image provenance proof incomplete     | test        | 14/14 focused Docker pass; release pending       |
| `DEF-031` | Clean mutation audit found behavioral survivors    | test        | Fixes pass; frozen-tree rerun pending            |
| `DEF-032` | PostgreSQL outage mapped to generic 500            | product     | 14/14 focused Docker pass; release pending       |
| `DEF-033` | Named PostgresError ESM import broke startup       | product     | Failure retained; client gate passes             |
| `DEF-034` | Check-in free text omitted from next trace         | product     | Failure retained; client gate passes             |
| `DEF-035` | History test depended on earlier session state     | test        | Failure retained; client gate passes             |
| `DEF-036` | Offline assertion locator was ambiguous            | test        | Failure retained; client gate passes             |
| `DEF-037` | Docker CSP assertion contradicted shipped policy   | test        | Failure retained; QA-DKR-009 rerun passes        |
| `DEF-038` | Log scan rejected expected PostgreSQL test noise   | test        | Failure retained; focused scanner passes         |
| `DEF-039` | Bundled SBOM plugin used an obsolete Docker API    | environment | Failure retained; local Scout proof passes       |
| `DEF-040` | Trivy subcommand flag was passed at global scope   | test        | Failure retained; exact SARIF retest passes      |
| `DEF-041` | Deterministic coach edit appeared as live          | product     | Backend/PGlite pass; coach gate pending          |
| `DEF-042` | Invalid chart semantics and broad alert locators   | product     | Failure retained; accessibility gate passes      |
| `DEF-043` | Keyboard test navigated before reads settled       | test        | Failure retained; accessibility gate passes      |
| `DEF-044` | Expo title and radio state semantics were absent   | product     | Failure retained; client a11y gate passes        |
| `DEF-045` | Node-native test collected as empty Vitest suite   | test        | Failure retained; coverage gate passes           |
| `DEF-046` | Repository and changed-code coverage gaps          | test        | Failure retained; unchanged thresholds pass      |
| `DEF-047` | Invalid server policy mapped to client HTTP 400    | security    | Failure retained; HTTP security passes 23/23     |
| `DEF-048` | Deferred updater read a cleared event target       | product     | Failure retained; mutation-page tests pass       |
| `DEF-049` | General harness parsed React Native Flow syntax    | test        | Failure retained; native policy tests pass       |
| `DEF-050` | Module reset split error-constructor identity      | test        | Failure retained; query policy passes 2/2        |
| `DEF-051` | Completed session exposed duplicate submission     | product     | Failure retained; session suite passes 19/19     |
| `DEF-052` | Screen test lacked safe-area boundary double       | test        | Failure retained; component suite passes 5/5     |
| `DEF-053` | Native Card fixture placed raw text under View     | test        | Failure retained; component suite passes 5/5     |
| `DEF-054` | Today test spread unknown query data               | test        | Failure retained; seven workspaces typecheck     |
| `DEF-055` | Coverage fixtures violated public contracts        | test        | Failure retained; seven workspaces typecheck     |
| `DEF-056` | Session fixtures retained obsolete `createdAt`     | test        | Failure retained; seven workspaces typecheck     |
| `DEF-057` | Session fixtures retained non-public `sessionKey`  | test        | Failure retained; seven workspaces typecheck     |
| `DEF-058` | Lint mixed immutable evidence with live source     | test        | Failure retained; strict repository lint passes  |
| `DEF-059` | Frontend tests crossed backend import boundary     | test        | Failure retained; 350-file boundary gate passes  |
| `DEF-060` | Live files lacked deterministic formatting         | test        | Failure retained; repository formatting passes   |
| `DEF-061` | Tablet client profile values were crushed          | product     | Failure retained; coach E2E passes 12/12         |
| `DEF-062` | Evidence rejected digit-bearing requirement IDs    | test        | Failure retained; validator tests pass 2/2       |
| `DEF-063` | Load limits lacked a guarded QA binding            | performance | Review fixed; release performance pending        |
| `DEF-064` | Recorded week and generated cleanup diverged       | performance | Review fixed; release performance pending        |
| `DEF-065` | Mutation fixture violated programme contract       | performance | Review fixed; harness regressions pass           |
| `DEF-066` | Cleanup authority and teardown could false-pass    | performance | Review fixed; release cleanup proof pending      |
| `DEF-067` | Gates omitted every-run business correctness       | performance | Review fixed; harness regressions pass           |
| `DEF-068` | Lighthouse proof used a detached navigation        | performance | Review fixed; production measurement pending     |
| `DEF-069` | Resource proof could miss peaks and growth         | performance | Review fixed; production soak pending            |
| `DEF-070` | Baseline was unverifiable and source-unbound       | performance | Review fixed; measured promotion pending         |
| `DEF-071` | Corpus admitted extra and duplicate queue rows     | performance | Review fixed; release corpus proof pending       |
| `DEF-072` | Corpus constraint detail violated strict contract  | test        | Failure retained; corrected smoke rerun pending  |
| `DEF-073` | Performance corpus was layered over demo queue     | test        | Failure retained; corrected smoke rerun pending  |
| `DEF-074` | Web started before its owned coach corpus existed  | test        | Failure retained; corrected smoke rerun pending  |
| `DEF-075` | Queue Lighthouse proof aborted before raw capture  | test        | Fix tests pass; corrected measurement pending    |
| `DEF-076` | Recorded-run invariant expected the wrong model ID | test        | Fix tests pass; corrected Docker rerun pending   |
| `DEF-077` | Corpus evaluation name violated gate contract      | test        | Fix tests pass; critical route rerun pending     |
| `DEF-078` | Mixed-read p95 exceeded the 250 ms budget          | performance | Fix tests pass; measured rerun pending           |
| `DEF-079` | Post-fix mixed-read p95 still exceeded its budget  | performance | Partial fix measured; residual is DEF-081        |
| `DEF-080` | Lighthouse rejected valid serialized loaded proof  | test        | 21 fresh proofs pass; release validation pending |
| `DEF-081` | Residual system capacity missed the read budget    | performance | Open; deciding p95 is 303.742 ms                 |
| `DEF-082` | Expo main-thread blocking missed score 85          | performance | Open; route medians score 84                     |
| `DEF-083` | Snapshot missed workers after Next title rewrite   | test        | Targeted live failure; fix is in progress        |

## Release evidence rule

The final evidence runner must copy the machine record to `reports/defects/defect-history.json` and
copy every `firstFailure.artifacts[]` source to its declared `releasePath` before checksums are
generated. The verifier must fail when a retained runtime-failure source or copied destination is
absent, when a copied item is outside the evidence `reports/` tree, or when a record still has a
blocking validation status.

File artifacts pin the original bytes with `sourceSha256`. Directory artifacts use
`sourceTreeSha256`, calculated as SHA-256 over sorted lines of
`<file-sha256><two spaces><relative-posix-path>\n`. The final evidence sanitizer may transform
copied text, so the source digest proves the frozen input while `checksums.sha256` proves the
sanitized release artifact.

Five defect histories (`DEF-003`, `DEF-009`, `DEF-010`, `DEF-018`, and `DEF-023`) lack complete raw
pre-fix evidence. They are disclosed as evidence gaps rather than reconstructed. A final QA-EVD-007
claim should either retain an honest reproduction against the affected revision or explicitly
resolve how those historical gaps are treated; the final report must not describe them as preserved
pre-fix evidence.
