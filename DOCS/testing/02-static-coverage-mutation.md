# Static, architecture, coverage, and mutation gates

## Static and build gates

| ID           | Blocking requirement                                                                                  | Expected command/evidence                 |
| ------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `QA-STA-001` | Install succeeds from the committed lockfile without mutation.                                        | `corepack pnpm install --frozen-lockfile` |
| `QA-STA-002` | All committed source and docs satisfy formatting. Verification never rewrites.                        | `pnpm format:check`                       |
| `QA-STA-003` | ESLint completes with zero warnings and zero errors.                                                  | `pnpm lint --max-warnings=0`              |
| `QA-STA-004` | Strict TypeScript succeeds for all workspaces with no emitted files.                                  | `pnpm typecheck`                          |
| `QA-STA-005` | Production frontend build and client exports succeed from clean outputs.                              | `pnpm build`                              |
| `QA-STA-006` | Tests contain no committed `.only`, unexplained `.skip`/`.todo`, or unconditional quarantine.         | `pnpm lint`                               |
| `QA-STA-007` | Production paths contain no placeholder throws, fake success, ignored promises, or swallowed catches. | `pnpm lint`                               |
| `QA-STA-008` | Server secrets and `backend` modules are absent from browser/native bundles.                          | `pnpm build && pnpm test:security`        |
| `QA-STA-009` | Public contracts and package exports resolve without deep private imports.                            | `pnpm typecheck`                          |
| `QA-STA-010` | Generated files are reproducible or excluded; a second generation produces no diff.                   | `pnpm verify:generated`                   |

The implementation must add `verify:generated` if code generation is introduced. If no generator
exists, the script records a deliberate no-op rather than being omitted.

## Dependency and folder boundaries

Dependency rules are enforced with ESLint boundaries or dependency-cruiser, not code review alone.

| ID           | Rule                                                                                                                             | Expected command                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `QA-ARC-001` | `frontend/` may use `backend` only from server route adapters/server components; client components may not import it.            | `pnpm lint:boundaries`                       |
| `QA-ARC-002` | `client-frontend/` depends only on shared contracts/design tokens and HTTP clients, never `backend`, DB, Next.js, or model SDKs. | `pnpm lint:boundaries`                       |
| `QA-ARC-003` | `backend/domain` is pure and imports no framework, database driver, React, Expo, or model SDK.                                   | `pnpm lint:boundaries`                       |
| `QA-ARC-004` | Application services may orchestrate ports but route adapters remain validate-call-map only.                                     | `pnpm lint:boundaries`                       |
| `QA-ARC-005` | Agent modules receive assembled input and cannot import repositories or publish/mutate directly.                                 | `pnpm lint:boundaries`                       |
| `QA-ARC-006` | Deterministic safety gates do not import an LLM/provider adapter.                                                                | `pnpm lint:boundaries`                       |
| `QA-ARC-007` | Workspace dependency graph has no cycles.                                                                                        | `pnpm lint:boundaries`                       |
| `QA-ARC-008` | Runtime environment parsing occurs once in the server composition root; public env allowlists are explicit.                      | `pnpm lint:boundaries && pnpm test:security` |

The root `pnpm lint` includes `pnpm lint:boundaries`.

## Type-quality rules

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and
  `useUnknownInCatchVariables` are enabled for owned TypeScript.
- `any`, non-null assertions, and unsafe type assertions require a narrow documented boundary and an
  adjacent validation or invariant. Blanket ESLint disables are prohibited.
- External input remains `unknown` until Zod validation.
- Database JSON and model output use shared versioned schemas; a TypeScript type alone is not a
  runtime contract.
- Exhaustive state transitions use discriminated unions and `never` checks.

## Coverage gates

Coverage is measured with the V8 provider and includes untested source files. Generated code,
declaration-only files, framework bootstrap, and exhaustive schema constants may be excluded only
through a committed allowlist with a reason.

| ID           | Scope                                                              | Lines | Branches | Functions | Command                     |
| ------------ | ------------------------------------------------------------------ | ----: | -------: | --------: | --------------------------- |
| `QA-COV-001` | Safety gates and movement taxonomy behavior                        |  100% |     100% |      100% | `pnpm test:unit --coverage` |
| `QA-COV-002` | Context temporal filtering, hard-constraint pinning, and budgeting |  100% |     100% |      100% | `pnpm test:unit --coverage` |
| `QA-COV-003` | Publish/override/supersession transaction services                 |  100% |     100% |      100% | `pnpm test:unit --coverage` |
| `QA-COV-004` | Engagement tiers, ownership transitions, and nudge suppression     |  100% |     100% |      100% | `pnpm test:unit --coverage` |
| `QA-COV-005` | All owned `backend` domain/application code                        |   90% |      90% |       90% | `pnpm test:unit --coverage` |
| `QA-COV-006` | Repository-wide owned source                                       |   80% |      80% |       80% | `pnpm test:unit --coverage` |
| `QA-COV-007` | Changed-lines coverage                                             |   90% |      90% |       90% | `pnpm coverage:changed`     |

`pnpm verify` runs the coverage gates. A high total does not compensate for a missed critical-scope
threshold. Coverage exclusions and threshold changes require an ADR and release-report disclosure.

## Mutation gates

Mutation testing targets deterministic code where an incorrect branch could defeat a safety or
integrity guarantee. It does not mutate generated schemas, presentation markup, or framework glue.

| ID           | Mutation scope                                         | Minimum mutation score | Additional rule                         | Command              |
| ------------ | ------------------------------------------------------ | ---------------------: | --------------------------------------- | -------------------- |
| `QA-MUT-001` | Movement taxonomy and blocking safety gates            |                    95% | No surviving blocker-removal mutant     | `pnpm test:mutation` |
| `QA-MUT-002` | Temporal filtering and hard-constraint budget logic    |                    95% | No surviving boundary/comparison mutant | `pnpm test:mutation` |
| `QA-MUT-003` | Publication approval, override, and supersession logic |                    95% | No surviving authorization/state mutant | `pnpm test:mutation` |
| `QA-MUT-004` | Engagement tier and 48-hour suppression logic          |                    95% | No surviving time/ownership mutant      | `pnpm test:mutation` |
| `QA-MUT-005` | Combined selected critical scope                       |                    90% | Every survivor is classified            | `pnpm test:mutation` |

An equivalent mutant may be excluded only with a code reference, explanation, reviewer, and expiry.
A timeout counts as not killed until the harness proves the production test detects the mutation.
Mutation evidence includes tool configuration, tested commit, scores by file, killed/survived list,
and every exclusion.

## Static-gate failure policy

Warnings are failures. A gate is never made green by disabling a rule at repository or package
scope, lowering a threshold, excluding a file, or casting through `unknown` without proving the
underlying invariant. If a rule is genuinely wrong for the architecture, change the documented
contract first and retain the decision in evidence.
