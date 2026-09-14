# Supply-Engine Unit Coverage Implementation Plan

## Overview

Build the repository's first unit-test suite, covering the supply engine's pure-function surface (`supply.ts`, `decimal.ts`, `dates.ts`, `dashboard.ts`) and the single display-path arithmetic site. This is rollout Phase 1 of `context/foundation/test-plan.md`, defending Risk #1 (a wrong supply-end date that renders identically to a correct one) and Risk #2 (float arithmetic reaching the screen).

The arithmetic this covers is what the PRD guards hardest — _"an incorrect 'you have enough' result is a product failure regardless of how smooth the rest of the experience is"_ — and it currently has zero automated coverage of any kind.

## Current State Analysis

**What exists:** Vitest 4.1.10 configured for integration tests only (`vitest.config.ts:17`, `include: ["tests/integration/**/*.test.ts"]`), one integration file (`tests/integration/schema.test.ts`, 273 lines, schema/RLS only), and four pgTAP files (`supabase/tests/`, 70 assertions, database invariants only).

**What's missing:** nothing exercises a single line of `src/lib/supply.ts`, `src/lib/decimal.ts`, `src/lib/dates.ts`, `src/lib/dashboard.ts`, or the medication status derivation. CI runs lint + typecheck + build and no test of behaviour at all.

**Key constraints discovered:**

- The functions under test are **already pure** — `today` and the clock are arguments everywhere, never read internally. No redesign is needed to make them testable.
- Two functions are **module-private** and therefore unreachable: `discrepancyPhrase` (`src/components/medications/MedicationsManager.tsx:118-124`) and `deriveStatus` (`src/lib/db/medications.ts:236-249`).
- Vitest's `include` glob does not match anything outside `tests/integration/` — a unit test placed elsewhere is silently never collected.
- The local-Supabase guard in `tests/integration/helpers/client.ts:20-28` runs at **call time, not import time**, so it cannot block a pure unit test that never calls it.
- `tsconfig.json` includes `**/*` with only `dist` excluded, so every new test file is type-checked by `astro check` in CI even though no test executes there.

### Key Discoveries:

- `supply.ts:198` — the exhaustion-at-expiry tie resolves to `"consumption"` via a strict `>`; a regression here leaves the date correct and only the reason wrong, making it invisible without an explicit assertion.
- `supply.ts:227` — `supplyEndDate <= nextVisitDate` is **red**, non-strict. The code carries its own do-not-fix comment; the test must carry the reasoning in its title for the same purpose.
- `supply.ts:137-140` — exhaustion is provisional and reversible; a later refill clears the flag and nulls the recorded end date. A reader "optimising" this into an early `break` silently breaks the refill case.
- `decimal.ts:68-70` — `floorDivide` throws `RangeError` rather than returning `Infinity`/`NaN`. The smallest divisor that does not round to zero at the `10^6` scale is `5e-7`.
- `dates.ts:117-119` — `addDays` rejects a well-formed but calendrically nonexistent day (`2026-02-30`) via a round-trip check, stricter than the originally stated contract and deliberately so.
- `medications.ts:245` — `not_started` fires on `currentDosage === 0 && hasNonzeroPending`, **not** on "every row is future-dated". A prior narrower test shipped as a bug.
- `TestProjectInlineConfiguration.extends` (Vitest 4.1.10 types, verified in `node_modules`) — `true` makes a project inherit all root options. Without it, projects do not inherit `resolve.alias`.

## Desired End State

Running `npm run test:unit` with Docker stopped executes roughly 60 assertions across five files in under a second, all green. Running `npm test` executes both projects. Every worked example, boundary, and guard documented across four prior slices' follow-up queues is asserted in code rather than in prose, and the two errors those documents contain are corrected at source. `context/foundation/test-plan.md` §6.1 tells the next contributor exactly where a new unit test goes and which existing file to copy.

Verification: `npm run test:unit` passes with the Supabase stack stopped; `npm test` passes with it running; `npm run typecheck` and `npm run lint` stay at zero errors.

## What We're NOT Doing

- **No CI wiring.** Adding a test step to `.github/workflows/ci.yml` is rollout Phase 4 ("Quality-gates wiring") per `test-plan.md` §3. This phase leaves CI untouched.
- **No integration tests.** Route-level assertions, zero-rows-as-404, `updated_at` tamper resistance, and the multi-insert partial-failure cases are rollout Phase 2. They need a live stack and belong with the other integration work.
- **No pgTAP assertions.** The `dosage_changes_insert_own` policy assertion specified in S-05's follow-up is rollout Phase 3.
- **No component/DOM testing.** `jsdom`, `@testing-library/react`, and a React Vite plugin are all absent, and nothing in this phase's scope needs a DOM. `discrepancyPhrase` is covered as a pure function, not through a rendered component.
- **No behaviour changes.** Apart from two visibility changes (one extraction, one `export`), no production code is modified. If a test fails, the default assumption is that the test is wrong — see Critical Implementation Details.
- **No `resolveTodayForUser` coverage.** It reads `new Date()` with no injection point; testing it requires fake timers, which is out of proportion to its risk here.
- **No fix for the `daily_dosage` clamp asymmetry** noted in S-05's follow-up. It is a real open question but it is a production change, not a test.

## Implementation Approach

Infrastructure first, then primitives, then the engine that depends on them, then the consumers, then documentation. Ordering Phases 2 and 3 this way means a `floorDivide` defect surfaces as a `floorDivide` failure rather than as a confusing engine failure three layers up.

The suite is lifted from an existing, verified specification rather than invented. The scratch harness at `context/changes/supply-status-dashboard/scratch/engine-harness.md` was re-run against current code during research and still passes 32/32 — those assertions are ported as named `it()` blocks. Everything beyond them comes from the prose in `supply-engine-tests.md` and `deferred-tests.md`, with two documented corrections.

## Critical Implementation Details

**Vitest project inheritance.** Each entry in `test.projects` must carry `extends: true`, or it will not inherit the root `resolve.alias` that maps `@` → `src`. Every test in this phase imports via `@/lib/...`, so omitting it produces a wall of unresolved-import failures that look like missing files rather than a config error.

**The oracle rule — this phase's single most important constraint.** Every expected value in these tests must come from hand-worked arithmetic or from a stated requirement, never from running the function and recording what it returned. A test whose expectation was captured from the implementation passes by construction and can never fail for the right reason. Research independently hand-verified worked examples 5 and 6 and the two corrected values below; anything not on that list must be derived by hand before it is written down. When a test fails during this phase, re-derive the expected value by hand before touching `src/` — the default assumption is that the test is wrong, because the production code has been in use and the test has not.

**Two corrected values that must not be copied from the follow-up specs.** `mid-supply-dosage-change/follow-ups/deferred-tests.md` contains a worked example whose stated result is off by one day, and a `deriveStatus` row that a later impl-review superseded. Both corrections are specified in Phases 3 and 4 respectively. Copying either verbatim produces a red test against correct code.

## Phase 1: Test infrastructure and reachability

### Overview

Split Vitest into two projects so pure tests run without a Supabase stack, and make the two module-private functions importable.

### Changes Required:

#### 1. Vitest project split

**File**: `vitest.config.ts`

**Intent**: Replace the single `include` glob with two named projects so the pure suite can run with no Docker and no credentials, while the integration suite keeps its current timeouts and env loading. The existing header comment asserting "there are no pure functions to test yet" is now false and should be rewritten to describe the split.

**Contract**: `test.projects` is a `TestProjectConfiguration[]`; each entry needs `extends: true` to inherit the root `resolve.alias`. Project `unit` includes `tests/unit/**/*.test.ts`, uses `environment: "node"`, and needs neither `env` loading nor the extended timeouts. Project `integration` includes `tests/integration/**/*.test.ts` and keeps the current `testTimeout: 30_000`, `hookTimeout: 60_000`, and `env: loadEnv(...)`. Projects are selected with `--project <name>`.

#### 2. Test scripts

**File**: `package.json`

**Intent**: Give each project a script so a developer can run the fast suite alone, and keep `npm test` meaning "everything".

**Contract**: `test:unit` → `vitest run --project unit`; `test:integration` → `vitest run --project integration`; `test` stays `vitest run` (now both projects). `test:watch` stays as-is.

#### 3. Extract the notice phrase

**File**: `src/lib/notices.ts` (new), `src/components/medications/MedicationsManager.tsx`

**Intent**: Move `discrepancyPhrase` out of the island into a new pure module so a unit test can import it without dragging React and the entire shadcn/lucide import graph into a node-environment test process. Carry its explanatory comment across intact — it records the lived defect. The island imports it back.

**Contract**: `export function discrepancyPhrase(before: number | undefined, after: number): string`. Behaviour must not change: empty string when `before` is undefined or equal to `after`; otherwise ` — <difference> <fewer|more> than projected`, with the difference computed through `subtractExact`. `src/lib/notices.ts` is a new presentation-string module; no such module exists today, which is why this is a new file rather than an addition to `decimal.ts` (arithmetic primitives, no domain vocabulary) or `supply.ts` (the projection engine).

#### 4. Export the status derivation

**File**: `src/lib/db/medications.ts`

**Intent**: Make `deriveStatus` importable. It stays where it is — it sits beside `toView` and `MedicationStatus` which it is tightly coupled to, and moving it would split cohesive code for no test benefit.

**Contract**: add `export` to the existing `function deriveStatus(...)`. Signature and behaviour unchanged. `nextNonzeroPendingChange` is already exported and needs no change.

#### 5. Infrastructure smoke test

**File**: `tests/unit/notices.test.ts`

**Intent**: Prove the new project actually collects and runs, that `@/` resolves inside it, and that it needs no Supabase stack — before any substantial suite depends on all three. Covers Risk #2's assertions, so it is not throwaway scaffolding.

**Contract**: Assert `discrepancyPhrase` over the cases specified in `supply-status-dashboard/follow-ups/supply-engine-tests.md`: `0.3 → 0.1` gives `"0.2 fewer"` (not `0.19999999999999998`); `0.1 → 0.3` gives `"0.2 more"`; `1.005 → 0.9` gives `"0.105 fewer"`; `30 → 18` gives `"12 fewer"`; `5 → 0.123457` gives `"4.876543 fewer"`; `before === after` and `before === undefined` both give `""`. Follow the house style in `tests/integration/schema.test.ts` — explicit `vitest` imports, `describe` as a domain phrase, `it` as a full behavioural sentence.

### Success Criteria:

#### Automated Verification:

- Unit project runs with the Supabase stack stopped: `npm run test:unit`
- Integration project is still collected and passes with the stack running: `npm run test:integration`
- Both run together: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes at zero warnings: `npm run lint`

#### Manual Verification:

- The medications page still renders and a count correction still shows the correct discrepancy notice in a browser (the extraction changed an import path on a live user-visible path)
- `npm run test:unit` completes in under ~2 seconds with Docker fully stopped, confirming no hidden stack dependency

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Arithmetic primitives

### Overview

Cover the exact-decimal helpers and date arithmetic the engine is built on, including the guards that exist specifically to prevent the "you have enough" over-report class.

### Changes Required:

#### 1. Decimal helpers

**File**: `tests/unit/decimal.test.ts`

**Intent**: Assert the float-class failures each helper exists to prevent, naming the failing float pair in each test title so the point is the class and not the operation.

**Contract**: `floorDivide(0.9, 0.3) === 3` (raw JS gives `2.9999999999999996`, and a naive floor yields a one-day error landing exactly on the green/yellow boundary); `subtractExact(0.3, 0.1) === 0.2` exactly; `clampScale(0.1234567) === 0.123457`; `floorDivide(10, 4e-7)` and `floorDivide(0, 4e-7)` both throw `RangeError` rather than returning `Infinity`/`NaN`; `floorDivide` at the `5e-7` boundary does **not** throw. Also cover `addExact` and `multiplyExact`, which no prior spec names but which the walk depends on.

#### 2. Date arithmetic

**File**: `tests/unit/dates.test.ts`

**Intent**: Cover the calendar arithmetic and the two guards that are stricter than the originally stated contract — both deliberate, and both at risk of being read as accidental and removed.

**Contract**: `addDays` across month boundaries, year boundaries, negative offsets, and leap years (2024 leap, 2100 **not** leap, 2000 leap); signed `daysBetween`; a differential run of `addDays` against `Date.toISOString()` over 5000 consecutive days. Guards: `addDays("2026-02-30", 1)` throws `RangeError` (well-formed but calendrically nonexistent — caught by a round-trip check, not the range check); `addDays("2026-09-10", NaN)` throws `RangeError` (an unvalidated offset once produced the literal string `"0NaN-NaN-NaN"`, which compared lexicographically against real dates and rendered into a `<time>` element); a finite negative offset still works. Also assert `resolveToday` falls back to UTC on an invalid zone rather than throwing, passing an explicit `Date` as the injectable second argument. `isPast` is strict — a visit dated today is not past.

### Success Criteria:

#### Automated Verification:

- Unit suite passes: `npm run test:unit`
- Type checking passes: `npm run typecheck`
- Linting passes at zero warnings: `npm run lint`

#### Manual Verification:

- Spot-check three expected values in `dates.test.ts` by hand against a calendar, confirming they were derived rather than captured from a run
- Temporarily break one guard in `src/lib/decimal.ts` and confirm the suite goes red in the expected test, then revert

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: The supply engine

### Overview

The core of Risk #1: the walk that produces the supply-end date, and the classifier that colours it.

### Changes Required:

#### 1. The worked examples

**File**: `tests/unit/supply.test.ts`

**Intent**: Port the six worked examples, giving each `it()` a title that states the rule rather than a number. Two of them encode decisions that read as bugs to someone who has not read the reasoning, and each needs its reasoning in the test name rather than only in a comment — a later reader who "fixes" either produces a green suite and a wrong product.

**Contract**: All six examples with their fixtures and expected results are specified in `supply-status-dashboard/follow-ups/supply-engine-tests.md` and reproduced in the verified scratch harness; both were re-run during research and pass 32/32 against current code. The two that lead:

- **Example 5, breakpoint past the expiry cap** → `{ supplyEndDate: "2026-09-15", supplyEndReason: "expiry", projectedQuantity: 95 }`. This is the one failure mode that **over-reports** cover — getting any date after the expiry means the breakpoint set was not bounded at `max(today, expiryDate)` and the walk consumed straight through the cap. Every other engine defect found during S-04 under-reported.
- **Example 6, exhaustion then refill** → `{ supplyEndDate: "2026-11-13", supplyEndReason: "consumption", projectedQuantity: 25 }`. The walk must continue past an exhaustion because a later refill un-ends it; returning early reports "out of stock" to a user holding a nearly full box. Reachable from the ordinary UI.

#### 2. Engine edges

**File**: `tests/unit/supply.test.ts`

**Intent**: Cover the documented edge cases, including one whose regression is entirely invisible.

**Contract**: no supply events → `{ null, null, 0 }`; no dosage rows → dose 0, stock intact, supply-end is the expiry; a `5 → 0 → 5` series exhausting exactly at the pause → `2026-09-10` (three spans with zero consumption in the middle, never a gap to skip, and the zero-dose branch must never divide); `today` before the first event → projected 0; expiry preceding the first event → returns before the walk with reason `expiry`; expired in the past → the walk still reaches `today` for the projection. And: **an exhaustion landing exactly on the bound resolves to `consumption`, not `expiry`** — a regression here leaves the date correct and only the reason wrong, which is why it needs an explicit assertion rather than being folded into another case.

#### 3. The S-05 shapes — with corrected values

**File**: `tests/unit/supply.test.ts`

**Intent**: Cover the shape S-05 made reachable for the first time — a dosage row dated after `today`. **The expected value stated in the source spec is wrong and must not be copied.**

**Contract**: For `events: +30 on 2026-09-10`, `dosages: 1/day from 2026-09-10 and 3/day from 2026-09-17`, `expiry 2027-01-01`, `today 2026-09-10` — the correct result is `supplyEndDate: "2026-09-23"`, reason `consumption`, projected 30. `deferred-tests.md` states `2026-09-24`; that is an off-by-one, independently hand-verified during research and confirmed against the engine. Its own prose derives the right figure ("seven days at 1/day leaves 23; 23 ÷ 3 is 7 whole days") and then miscounts the final offset: seven doses from 09-17 land on 09-17 through 09-23. Also cover: a scheduled **decrease** to 0.5/day extends the end date to `2026-11-01` (a test covering only an increase passes with a mis-signed comparison); a scheduled **stop** (`daily_dosage: 0`) makes the supply-end the expiry and is distinct from running out; **two pending changes compose** (1/day, 3/day at +7, 1/day at +14) → `2026-09-25` — the middle segment is the one a "find the next change" implementation quietly drops, and the source spec states no expected value for this case.

#### 4. The classifier and dose lookup

**File**: `tests/unit/supply.test.ts`

**Intent**: Assert the full boundary partition in one block so it is visible as a whole, with the counter-intuitive case named in its title.

**Contract**: the five-row table — `visit − 1` → red, **`visit` (equality) → red**, `visit + 1` → yellow, `visit + 14` → yellow, `visit + 15` → green — plus `no_visit` when the visit is null (checked first, even over a null supply end) and red when the supply end is null. The equality case reads as an off-by-one against a surface reading of the PRD; the bands partition on days of cover **after** the visit, and this one has none — the day after the visit there is nothing, and the visit is the last opportunity to obtain a prescription. That reasoning belongs in the test name. Also cover `doseInForce` directly, including a row dated one day ahead of the queried date (the shape the known timezone-pairing defect produces).

### Success Criteria:

#### Automated Verification:

- Unit suite passes: `npm run test:unit`
- Type checking passes: `npm run typecheck`
- Linting passes at zero warnings: `npm run lint`

#### Manual Verification:

- Hand-verify the corrected `2026-09-23` and the newly-derived `2026-09-25` on paper, independently of the engine, before accepting the phase
- Temporarily invert the classifier's `<=` to `<` and confirm the equality test goes red with a title that explains why it is red

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Status derivation and dashboard assembly

### Overview

The consumers of the engine: how a medication's status is derived, and how cards are grouped and ordered on the dashboard.

### Changes Required:

#### 1. Status derivation — with a corrected and extended table

**File**: `tests/unit/medication-status.test.ts`

**Intent**: Assert all status outcomes in one block so the precedence is visible as a whole, naming the reasoning for the two that read as bugs. **One row in the source spec is obsolete and one is missing.**

**Contract**: six rows, not five — no dosage rows → `no_dosage`; one row dated `today + 7` → `not_started`; one row dated today at 0 → `not_used`; **one row dated today at 0 plus a nonzero row at +7 → `not_started`** (the source spec says `not_used`; that rule was superseded by S-04 impl-review F5, and the amended contract lives in `mid-supply-dosage-change/plan.md`); one row dated today at 0 plus a **second row also at 0** at +7 → `not_used` (value-gating, not presence-gating — this row is absent from the source spec entirely); one row dated today at 2 → `active`. Plus `archived` taking precedence over everything, and `out_of_stock` on `projectedQuantity <= 0`. Name in the title why `no_dosage` and `not_used` must stay distinct: the first is a data gap the app must admit to, the second is the user's own choice, and collapsing them would let a failed insert read as a deliberate decision. Also cover `nextNonzeroPendingChange` directly — it is deliberately not `pending[0]`, because a medication can carry a scheduled stop followed by a later scheduled resume.

#### 2. Dashboard assembly

**File**: `tests/unit/dashboard.test.ts`

**Intent**: Cover grouping, ordering, and the state mapping whose exhaustiveness guard exists because a previous fall-through handed a defect from one slice to the next.

**Contract**: `nextVisitFor` returns the soonest non-past visit for a specialist, treating a visit dated today as next rather than past, and `null` when none exists. `buildDashboard` groups by specialist ordered by next visit ascending with no-visit groups last and ties broken by specialist name, orders cards within a group by the documented precedence (an unknowable medication sorts above a known-empty one), and excludes archived medications. `cardStateFor` maps `no_dosage` → `no_dosage`, `not_used` → `stopped`, `out_of_stock` → `out_of_stock`, and `active`/`not_started` → the supply-status classification — `not_started` deliberately joins `active` rather than getting a quiet state of its own. A `MedicationView` fixture builder will be needed; the type requires roughly twenty fields while `buildDashboard` reads only five.

### Success Criteria:

#### Automated Verification:

- Unit suite passes: `npm run test:unit`
- Full suite passes: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes at zero warnings: `npm run lint`

#### Manual Verification:

- Create a medication with dosage 0 today and a nonzero change scheduled for next week in the running app, and confirm the dashboard shows the state the new test asserts (`not_started`, not `not_used`)
- Confirm the dashboard's visible group order for a user with two specialists matches what `dashboard.test.ts` asserts

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Close-out — spec corrections and cookbook

### Overview

Correct the two errors at source so the next reader of those specs is not misled, and record where unit tests now live.

### Changes Required:

#### 1. Correct the drifted follow-up specs

**File**: `context/changes/mid-supply-dosage-change/follow-ups/deferred-tests.md`

**Intent**: Fix both verified errors in place, each with a dated note naming what was wrong and how it was established — these files are explicitly written to be read by whoever plans test work, so an uncorrected off-by-one will mislead someone again.

**Contract**: correct the worked example's stated result from `2026-09-24` to `2026-09-23`, keeping the (correct) prose derivation and adding the missing final step. Correct the `deriveStatus` table's fourth row from `not_used` to `not_started`, note that S-04 impl-review F5 superseded it, and add the missing value-gating row. Each correction carries a dated note; neither rewrites the surrounding reasoning. Mark the entries as now covered, pointing at the test files that carry them.

#### 2. Note coverage on the sibling specs

**File**: `context/changes/supply-status-dashboard/follow-ups/supply-engine-tests.md`

**Intent**: Record which parts of this spec are now discharged and which remain open for later rollout phases, so the queue reflects reality.

**Contract**: a dated note naming the test files that now carry the unit-level assertions, and stating that the integration-level items in that document remain open and belong to rollout Phase 2. Also correct the claim that the scratch harness "already asserts everything below" — the committed harness has 32 assertions; the broadened 49-assertion version was never committed.

#### 3. Cookbook and conventions

**File**: `context/foundation/test-plan.md`, `CLAUDE.md`

**Intent**: Tell the next contributor where a unit test goes, and add the third testing bucket to the project conventions, which currently describe only two.

**Contract**: `test-plan.md` §6.1 gains location (`tests/unit/`), naming (`<module>.test.ts`), a reference test to copy, and the exact command. §3's Phase 1 row moves to `complete` and the header's "Last updated" bumps. `CLAUDE.md`'s Testing section gains a line stating that pure-function tests live in `tests/unit/` and run without a stack via `npm run test:unit`, alongside the existing two buckets.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes at zero warnings: `npm run lint`
- Formatting is clean: `npm run format`

#### Manual Verification:

- Open a fresh agent session, ask it to read the project rules and `test-plan.md`, then ask where a test for a new pure helper in `src/lib/` should go — it should name `tests/unit/`, the naming pattern, and the command, without being told
- Re-read both corrected follow-up files end to end and confirm the corrections read as corrections rather than as rewrites of the original reasoning

**Implementation Note**: This is the final phase. After manual confirmation, the rollout phase is complete and `/10x-test-plan` will advance to rollout Phase 2.

---

## Testing Strategy

This change _is_ a testing change; the strategy below is how the suite itself is kept honest.

### Unit Tests:

- Five files under `tests/unit/`, one per module: `decimal`, `dates`, `supply`, `medication-status`, `dashboard`, plus `notices`.
- Roughly 60 assertions, the majority ported from a specification that was independently verified against current code.
- Every test title states the rule, not the symbol — a failure should name what broke, not which line number.
- The assertions most likely to be "corrected" by a future reader carry their reasoning in the title: the red-on-equality boundary, the consumption-on-tie reason, the continue-past-exhaustion walk, and the two `addDays` guards.

### Integration Tests:

None in this phase. The existing integration suite must continue to pass unchanged, which Phase 1 verifies explicitly after the config split.

### Manual Testing Steps:

1. Stop Docker entirely, run `npm run test:unit`, and confirm it passes in about a second — proving the unit project has no hidden stack dependency.
2. Start the stack, run `npm test`, and confirm both projects run.
3. In the running app, perform a count correction with fractional values and confirm the notice reads `0.2 fewer`, not `0.19999999999999998` — the extraction in Phase 1 touched this live path.
4. Create a medication with dosage 0 today and a nonzero change scheduled ahead, and confirm the dashboard state matches the corrected `not_started` assertion.
5. Deliberately break one guard, confirm the expected test goes red with a legible title, and revert.

## Performance Considerations

The unit project is pure computation with no I/O; the whole suite should run in well under a second. One test deliberately runs 5000 iterations (the `addDays` differential against `Date`), which is still trivially fast and is the assertion that would catch a systematic calendar drift the hand-picked boundary cases would miss.

Worth recording for whoever extends the engine: `computeSupply` is `O(breakpoints × events)`, not `O(breakpoints)` as an earlier plan stated — the walk rescans the full events array at every breakpoint. Irrelevant at the PRD's volume of 20 medications with a handful of events each, and the NFR conclusion still holds because iterations are bounded by breakpoint count and never by a day count.

## Migration Notes

No data migration. Two production files change visibility only (one function extracted to a new module, one gains `export`), and neither alters behaviour. `vitest.config.ts` and `package.json` change shape; a developer with a stale checkout who runs `npm test` gets both projects rather than one, which is the intended new default. Rollback is `git revert` — nothing in this change touches the database or the deployed Worker.

## References

- Related research: `context/changes/testing-supply-engine-unit-coverage/research.md`
- Rollout strategy: `context/foundation/test-plan.md` (§2 Risk Map, §3 Phase 1)
- Source specification: `context/changes/supply-status-dashboard/follow-ups/supply-engine-tests.md`
- S-05 shapes and the two corrected values: `context/changes/mid-supply-dosage-change/follow-ups/deferred-tests.md`
- Verified scratch harness (32/32 passing against current code): `context/changes/supply-status-dashboard/scratch/engine-harness.md`
- House style to match: `tests/integration/schema.test.ts`
- Superseded `deriveStatus` rule, current contract: `context/changes/mid-supply-dosage-change/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test infrastructure and reachability

#### Automated

- [x] 1.1 Unit project runs with the Supabase stack stopped: `npm run test:unit` — adc464e
- [x] 1.2 Integration project is still collected and passes with the stack running: `npm run test:integration` — adc464e
- [x] 1.3 Both run together: `npm test` — adc464e
- [x] 1.4 Type checking passes: `npm run typecheck` — adc464e
- [x] 1.5 Linting passes at zero warnings: `npm run lint` — adc464e

#### Manual

- [x] 1.6 Medications page renders and a count correction shows the correct discrepancy notice in a browser — adc464e
- [x] 1.7 `npm run test:unit` completes in under ~2 seconds with Docker fully stopped — adc464e

### Phase 2: Arithmetic primitives

#### Automated

- [x] 2.1 Unit suite passes: `npm run test:unit`
- [x] 2.2 Type checking passes: `npm run typecheck`
- [x] 2.3 Linting passes at zero warnings: `npm run lint`

#### Manual

- [x] 2.4 Spot-check three expected values in `dates.test.ts` by hand against a calendar
- [x] 2.5 Temporarily break one guard in `decimal.ts`, confirm the expected test goes red, revert

### Phase 3: The supply engine

#### Automated

- [ ] 3.1 Unit suite passes: `npm run test:unit`
- [ ] 3.2 Type checking passes: `npm run typecheck`
- [ ] 3.3 Linting passes at zero warnings: `npm run lint`

#### Manual

- [ ] 3.4 Hand-verify the corrected `2026-09-23` and the derived `2026-09-25` on paper, independently of the engine
- [ ] 3.5 Temporarily invert the classifier's `<=` to `<`, confirm the equality test goes red, revert

### Phase 4: Status derivation and dashboard assembly

#### Automated

- [ ] 4.1 Unit suite passes: `npm run test:unit`
- [ ] 4.2 Full suite passes: `npm test`
- [ ] 4.3 Type checking passes: `npm run typecheck`
- [ ] 4.4 Linting passes at zero warnings: `npm run lint`

#### Manual

- [ ] 4.5 A medication at dosage 0 today with a nonzero change scheduled ahead shows `not_started` in the running app
- [ ] 4.6 The dashboard's visible group order for two specialists matches what `dashboard.test.ts` asserts

### Phase 5: Close-out — spec corrections and cookbook

#### Automated

- [ ] 5.1 Full suite passes: `npm test`
- [ ] 5.2 Type checking passes: `npm run typecheck`
- [ ] 5.3 Linting passes at zero warnings: `npm run lint`
- [ ] 5.4 Formatting is clean: `npm run format`

#### Manual

- [ ] 5.5 A fresh agent session, given the project rules and `test-plan.md`, names `tests/unit/` and the command unprompted
- [ ] 5.6 Both corrected follow-up files read as corrections, not rewrites of the original reasoning
