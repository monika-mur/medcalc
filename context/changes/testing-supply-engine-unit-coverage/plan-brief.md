# Supply-Engine Unit Coverage — Plan Brief

> Full plan: `context/changes/testing-supply-engine-unit-coverage/plan.md`
> Research: `context/changes/testing-supply-engine-unit-coverage/research.md`

## What & Why

Build the repository's first unit-test suite over the supply engine's pure-function surface and the one display-path arithmetic site. This is rollout Phase 1 of `context/foundation/test-plan.md`, defending its top two risks: a supply-end date that is arithmetically wrong but renders identically to a correct one, and exact-decimal arithmetic recomputed with raw floats on the way to the screen. The PRD guards this arithmetic harder than anything else in the product — _"an incorrect 'you have enough' result is a product failure regardless of how smooth the rest of the experience is"_ — and it has never had a single automated assertion.

## Starting Point

Vitest and pgTAP are both configured, but all existing coverage sits at the F-01 schema and RLS layer: one integration file and four pgTAP files. Nothing exercises `supply.ts`, `decimal.ts`, `dates.ts`, `dashboard.ts`, or the status derivation. CI runs lint, typecheck, and build — no test of behaviour at all. Four prior slices each deferred their suite and left a written specification behind; research verified those specs against current code and found them largely accurate, with two errors.

## Desired End State

`npm run test:unit` runs roughly 60 assertions in about a second with Docker stopped entirely. Every worked example, boundary, and guard that has lived in prose across four follow-up queues is asserted in code. The two errors those documents contain are corrected at source. `test-plan.md` §6.1 tells the next contributor where a unit test goes and which file to copy.

## Key Decisions Made

| Decision                          | Choice                                                                                | Why (1 sentence)                                                                                                                                                | Source   |
| --------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Reachability of private functions | Extract `discrepancyPhrase` to `src/lib/notices.ts`; `export` `deriveStatus` in place | Keeps React and the shadcn import graph out of a node-environment test, while leaving `deriveStatus` beside the code it is coupled to.                          | Plan     |
| Test runner scoping               | Vitest `projects` split (`unit`, `integration`)                                       | Idiomatic for Vitest 4 and lets the pure suite run with no Supabase stack — the common inner-loop case.                                                         | Plan     |
| Drifted spec files                | Correct them in place with dated notes                                                | Those files exist to be read by whoever plans test work; an uncorrected off-by-one will mislead someone again.                                                  | Plan     |
| `dashboard.ts` scope              | In                                                                                    | Already pure and exported, so zero refactor cost, and `cardStateFor`'s exhaustiveness guard exists because a prior fall-through handed a defect between slices. | Plan     |
| File layout                       | One file per module under `tests/unit/`                                               | A failure names its module; matches the flat convention both existing suites already use.                                                                       | Plan     |
| Cut order if time runs short      | Prose-only assertions first, then spec corrections                                    | The 32 verified assertions already cover every worked example and both leading risks.                                                                           | Plan     |
| Oracle discipline                 | Expected values hand-derived, never captured from a run                               | An expectation lifted from the implementation passes by construction and can never fail for the right reason.                                                   | Research |

## Scope

**In scope:** Vitest project split; two visibility changes; unit tests for `decimal`, `dates`, `supply`, `medication-status`, `dashboard`, and `notices`; corrections to two follow-up specs; cookbook and `CLAUDE.md` entries.

**Out of scope:** CI wiring (rollout Phase 4); integration and route-level tests (rollout Phase 2); pgTAP policy assertions (rollout Phase 3); component/DOM testing; any behaviour change; `resolveTodayForUser`; the `daily_dosage` clamp asymmetry.

## Architecture / Approach

Infrastructure first, then primitives, then the engine that depends on them, then the consumers, then documentation. Ordering the primitives ahead of the engine means a `floorDivide` defect surfaces as a `floorDivide` failure rather than as a confusing engine failure three layers up. The suite is lifted from an existing specification that research re-ran against current code (32/32 passing) rather than invented, with everything beyond it derived by hand.

## Phases at a Glance

| Phase                              | What it delivers                                                           | Key risk                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1. Infrastructure and reachability | Vitest projects split, two extractions, Risk #2 assertions as a smoke test | Projects need `extends: true` or `@/` imports silently fail to resolve               |
| 2. Arithmetic primitives           | `decimal` and `dates` coverage, including both deliberate guards           | Guards read as accidental and get "simplified" away later                            |
| 3. The supply engine               | Six worked examples, edges, S-05 shapes, classifier boundaries             | Copying the source spec's wrong date verbatim writes a red test against correct code |
| 4. Status and dashboard            | Six-row status table, grouping, ordering, card-state mapping               | One source-spec row is obsolete; another is missing entirely                         |
| 5. Close-out                       | Spec corrections, cookbook, `CLAUDE.md` third bucket                       | Corrections read as rewrites of the original reasoning                               |

**Prerequisites:** A local Supabase stack for the integration half of verification only; Phases 2–4 need nothing running. No schema or migration work.
**Estimated effort:** ~2–3 sessions across five phases; Phase 3 carries the most assertions.

## Open Risks & Assumptions

- The ~17 assertions that exist only in prose (beyond the 32 verified harness ones) were not independently re-derived during research. They must be hand-derived as they are written, not trusted — and they are first on the cut list.
- Extracting `discrepancyPhrase` touches a live user-visible path. The change is behaviour-preserving, but it is the one place this phase modifies something a user can see, so Phase 1 carries a browser check.
- A failing test in this phase most likely means the test is wrong, not the code — the production code has been in use and the tests have not. That assumption is stated in the plan so it is not re-litigated mid-implementation.

## Success Criteria (Summary)

- The arithmetic the PRD calls a product failure if wrong is asserted in code, with each counter-intuitive decision explained in the test's own title.
- A developer can run the full pure suite with no Docker, in about a second.
- The next person to add a test for a pure helper finds the answer in `test-plan.md` without asking.
