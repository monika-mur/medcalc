---
date: 2026-09-14T20:50:00+02:00
researcher: Monika Murawska (via Claude Code)
git_commit: f3c3cdfb89641afd7dd66768abab426e238dd9bd
branch: docs/s-05-roadmap-done
repository: monika-mur/medcalc
topic: "Ground rollout Phase 1 of test-plan.md — supply-engine unit coverage (Risks #1, #2)"
tags: [research, codebase, testing, supply-engine, decimal, dates, dashboard, medications, test-plan]
status: complete
last_updated: 2026-09-14
last_updated_by: Monika Murawska (via Claude Code)
---

# Research: Ground rollout Phase 1 — Supply-engine unit coverage

**Date**: 2026-09-14T20:50:00+02:00
**Researcher**: Monika Murawska (via Claude Code)
**Git Commit**: `f3c3cdfb89641afd7dd66768abab426e238dd9bd`
**Branch**: `docs/s-05-roadmap-done`
**Repository**: `monika-mur/medcalc`

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md`: "Supply-engine unit coverage" (Risks #1, #2). For each risk: ground the real failure path in code, quote relevant lines, verify or correct the response guidance, locate existing tests, identify the cheapest useful test layer, and flag speculative risks or misleading hot-spot evidence. Additionally: verify four prior slices' deferred-test specifications against current code, since they were written against earlier revisions.

## Summary

**Both risks are real and both are cheaply testable at the unit layer — with one correction to the test-plan's assumed anchor and one important scope addition.**

- **Risk #1** (wrong supply-end date) is grounded in `src/lib/supply.ts` (`computeSupply`, `doseInForce`, `classifySupplyStatus`) plus the pure-arithmetic guards in `src/lib/decimal.ts` and `src/lib/dates.ts`. Every one of these functions is already pure and injectable — **no refactor is needed to make Risk #1 testable.** The test-plan's response guidance holds as written.
- **Risk #2** (float arithmetic on the display path) is grounded in exactly one site — `discrepancyPhrase` in `src/components/medications/MedicationsManager.tsx:118-124` — already fixed to use `subtractExact`, but **not exported**, so it cannot be unit-tested without either exporting it or extracting it to a lib module. A repo-wide sweep of `src/components/**` (excluding generated `ui/`) found **no second instance** of this defect class — the risk is real but narrower than "the display path" implied; it is one function.
- **`deriveStatus`**, which the test-plan's own §2 implicitly assumed lived in `dashboard.ts`, actually lives in `src/lib/db/medications.ts:236-249` and is **module-private**. This is a correction to ground, not a defect: the function is still pure and unit-testable in principle, but is unreachable without an export, same as `discrepancyPhrase`.
- **No existing test touches any of these functions.** The current suite (`tests/integration/schema.test.ts`, four pgTAP files) covers only the F-01 schema and RLS layer. Vitest's `include` glob (`tests/integration/**/*.test.ts`) does not even collect a file placed elsewhere — this is a real blocker a plan must address, not an assumption.
- **The four prior slices' follow-up specs contain two must-not-copy errors**: one worked-example expected value is arithmetically wrong (off by one day), and one `deriveStatus` table row encodes a rule that was superseded by a later impl-review finding. Both are detailed below with corrected values, independently hand-verified.
- **No risk here is speculative.** Both Risk #1 and Risk #2 describe defects with a concrete, previously-observed failure mode (S-04's impl-review found a real over-report; a real "0.19999999999999998" notice shipped). The hot-spot evidence (`src/lib/`, 12 commits/30d) correctly points at the highest-risk directory — it is not misleading.

## Detailed Findings

### Risk #1 — the supply engine

#### Exported API surface a test author needs

All types below are locally defined in `src/lib/supply.ts` — nothing here is imported from `database.types.ts`:

```ts
// supply.ts:26-31
export interface SupplyInputs {
  events: { quantity_delta: number; occurred_on: string }[];
  dosages: { daily_dosage: number; effective_date: string }[];
  expiryDate: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
}

// supply.ts:33-40
export interface SupplyResult {
  supplyEndDate: string | null;
  supplyEndReason: "consumption" | "expiry" | null;
  projectedQuantity: number;
}
```

| Symbol                 | Line            | Signature                                                                        |
| ---------------------- | --------------- | -------------------------------------------------------------------------------- |
| `doseInForce`          | `supply.ts:55`  | `(dosages: DosageRow[], at: string) => number`                                   |
| `computeSupply`        | `supply.ts:66`  | `(inputs: SupplyInputs) => SupplyResult`                                         |
| `SupplyStatus`         | `supply.ts:204` | `type SupplyStatus = "green" \| "yellow" \| "red" \| "no_visit"`                 |
| `classifySupplyStatus` | `supply.ts:219` | `(supplyEndDate: string \| null, nextVisitDate: string \| null) => SupplyStatus` |

Every field on `SupplyInputs`/`SupplyResult` is required; `events`/`dosages` may be empty arrays, and neither needs to be pre-sorted (`computeSupply` scans for `start`, `supply.ts:75-80`).

`src/lib/decimal.ts` (all module-private constants: `MAX_SCALE = 6`, `MAX_FACTOR = 1e6`):

| Symbol          | Line             | Signature                              |
| --------------- | ---------------- | -------------------------------------- |
| `floorDivide`   | `decimal.ts:58`  | `(a: number, b: number) => number`     |
| `subtractExact` | `decimal.ts:75`  | `(a: number, b: number) => number`     |
| `addExact`      | `decimal.ts:81`  | `(a: number, b: number) => number`     |
| `multiplyExact` | `decimal.ts:95`  | `(a: number, times: number) => number` |
| `clampScale`    | `decimal.ts:110` | `(n: number) => number`                |

`src/lib/dates.ts`:

| Symbol                | Line           | Signature                                                                                                    |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| `resolveToday`        | `dates.ts:38`  | `(timeZone: string \| undefined, now = new Date()) => string` — clock is an **injectable default parameter** |
| `isPast`              | `dates.ts:47`  | `(visitDate: string, today: string) => boolean` — strict `<`                                                 |
| `isFarFuture`         | `dates.ts:58`  | `(visitDate: string, today: string) => boolean`                                                              |
| `addDays`             | `dates.ts:140` | `(date: string, days: number) => string`                                                                     |
| `daysBetween`         | `dates.ts:154` | `(from: string, to: string) => number` — signed `to − from`                                                  |
| `resolveTodayForUser` | `dates.ts:71`  | `(userMetadata: unknown) => string` — **not injectable**, reads `new Date()` internally with no parameter    |

**Every function in `supply.ts`, `decimal.ts`, and the four date-arithmetic helpers is pure and callable deterministically with no fakes.** The only clock readers in this scope are `resolveToday` (injectable via its second parameter) and `resolveTodayForUser` (not injectable — out of scope for a pure unit suite; excluded from this phase).

#### `computeSupply` control flow — verified against source, line by line

**Early returns** (before any walk):

- No events (`supply.ts:71-73`) → `{ supplyEndDate: null, supplyEndReason: null, projectedQuantity: 0 }`. This is the _only_ path returning a null `supplyEndDate`.
- Expiry precedes every event (`supply.ts:85-87`) → `{ supplyEndDate: expiryDate, supplyEndReason: "expiry", projectedQuantity: 0 }` — the zero here is hard-coded, even if a large refill exists and `today` is well past `start`.

**Breakpoint set** (`supply.ts:92-109`):

```ts
const bound = today > expiryDate ? today : expiryDate;
const breakpoints = [
  ...new Set([...events.map((e) => e.occurred_on), ...dosages.map((d) => d.effective_date), today, expiryDate]),
]
  .filter((d) => d >= start && d <= bound)
  .sort();
```

Bounded below by `start` (min `occurred_on`), above by `bound = max(today, expiryDate)`. The `<= bound` filter exists specifically to drop future-dated `effective_date` rows (the S-05 case) and UTC-skew-ahead events — without it a span would run past expiry and the next span would have negative length (comment at `:96-99`). **Caveat for test design**: a `dosage.effective_date` earlier than `start` is filtered out of the breakpoint set, but `doseInForce` is always called with the full, unfiltered `dosages` array, so an early dosage still governs the first span.

**Zero-dose branch** (`supply.ts:159-167`):

```ts
if (dose === 0) {
  if (remaining === 0) {
    supplyEndDate = addDays(at, -1);
    exhausted = true;
  }
  continue;
}
```

Never divides. Confirms `CLAUDE.md` → Domain schema's stated invariant.

**Exhaustion is provisional and reversible** (`supply.ts:114`, `:137-140`): the walk does not `break` on exhaustion. Every remaining breakpoint is still visited, deltas still applied; a later positive balance clears the flag and nulls `supplyEndDate`. The `today`-projection assignment (`:142-144`) runs _before_ the `if (exhausted) continue` (`:148-150`) — so a projection is still recorded even mid-exhaustion.

**Tie resolution — the exact line the test-plan needs**: `supply.ts:198`.

```ts
if (!exhausted || supplyEndDate === null || supplyEndDate > expiryDate) {
  return { supplyEndDate: expiryDate, supplyEndReason: "expiry", projectedQuantity };
}
return { supplyEndDate, supplyEndReason: "consumption", projectedQuantity };
```

An exhaustion landing exactly on `expiryDate` resolves to `"consumption"` — the comparison is strict `>`, so equality falls through to the consumption branch. A prior post-walk step (`supply.ts:187-190`) additionally converts "ran out exactly at `bound` with no explicit exhaustion" into an exhaustion, specifically to prevent this exact tie from being mislabelled `"expiry"`.

#### `classifySupplyStatus` — verified boundary comparisons

```ts
// supply.ts:219-231
if (nextVisitDate === null) return "no_visit";
if (supplyEndDate === null) return "red";
if (supplyEndDate <= nextVisitDate) return "red"; // non-strict — equality is RED
return supplyEndDate > addDays(nextVisitDate, 14) ? "green" : "yellow"; // strict — visit+14 is YELLOW
```

`no_visit` is checked first, even over a null supply end. The code carries its own do-not-fix comment (`:206-218`): _"`prd.md` reads 'on or before' for the red boundary; do not 'correct' this to a strict `<`."_ This confirms the test-plan's Risk #1 response guidance without correction.

#### Guard throw sites — precise, for edge-case test design

| Function                                                   | Throws when                                                                         | Type                                                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `floorDivide`                                              | `Math.round(b * factor) === 0` — divisor rounds to zero at the active scale         | `RangeError` (`decimal.ts:68-70`)                                                                            |
| `addDays`                                                  | offset not finite (`NaN`/`±Infinity`); or malformed/nonexistent date string         | `RangeError` (`dates.ts:147-149`, plus `toEpochDay`'s three throw sites at `:97-99`, `:106-108`, `:117-119`) |
| `daysBetween`                                              | either date malformed (via `toEpochDay`)                                            | `RangeError`                                                                                                 |
| `subtractExact`, `addExact`, `multiplyExact`, `clampScale` | never throw                                                                         | —                                                                                                            |
| `resolveToday`                                             | never throws — invalid zone falls back to UTC via a bare `catch` (`dates.ts:38-44`) | —                                                                                                            |

**Scaling factor is `10^6`.** The smallest divisor that does _not_ round to zero is **`5e-7`** (`5e-7 × 1e6 = 0.5`, rounds to 1); `4.9e-7` and below throw. `MIN_NONZERO_DOSAGE = 0.000001` (`validation/medication.ts:58`) sits one order above that floor — its own comment names the exact failure this prevents: `Infinity` (walk never decrements, reports "lasts until expiry" — the over-report class the PRD calls a product failure) or `NaN` (renders as the literal string `"0NaN-NaN-NaN"`).

**`addDays` also rejects a well-formed but calendrically nonexistent day** (`"2026-02-30"`) via a round-trip check (`dates.ts:117-119`) — stricter than the plan's originally stated contract, and deliberately so (S-04 impl-review F5).

#### `deriveStatus` — CORRECTION to the test-plan's assumed location

**The test-plan's §2/§6 references to a dashboard-level status function are imprecise.** `deriveStatus` is not in `src/lib/dashboard.ts` — it lives in `src/lib/db/medications.ts:236-249` and is **module-private** (not exported). It is reachable only through `toView` (also private), called from the async DB functions that need a `SupabaseClient`.

```ts
// medications.ts:236-249
function deriveStatus(archivedAt, dosageCount, hasNonzeroPending, currentDosage, projectedQuantity): MedicationStatus {
  if (archivedAt !== null) return "archived";
  if (dosageCount === 0) return "no_dosage";
  if (currentDosage === 0 && hasNonzeroPending) return "not_started";
  if (currentDosage === 0) return "not_used";
  if (projectedQuantity <= 0) return "out_of_stock";
  return "active";
}
```

Six values in strict precedence. Two distinctions worth naming in test titles because they read as bugs: "no dosage rows at all" (`no_dosage`) is distinct from "a dosage row present with value 0" (`not_used`) — collapsing them would hide a failed insert that silently drops the user's data (comment at `:14-23`). And `not_started` fires not on "every row is future-dated" but specifically on `currentDosage === 0 && hasNonzeroPending`, where `hasNonzeroPending = nextNonzeroPendingChange(pendingChanges) !== undefined` (exported, pure, `medications.ts:99-103`).

**`buildDashboard`/`nextVisitFor`/`cardStateFor` in `dashboard.ts` ARE pure and exported** (`dashboard.ts:2-3` imports only types; `today` is an injected argument throughout — file header at `:6-14` states "nothing in this file reads a clock"). These belong in this phase's unit scope. `deriveStatus` and `nextNonzeroPendingChange` need either an export or a decision to test them only through the (out-of-scope-for-this-phase) integration layer.

### Risk #2 — display-path float arithmetic

#### The known site, verified

```ts
// MedicationsManager.tsx:118-124 — module-scope function, NOT exported
function discrepancyPhrase(before: number | undefined, after: number): string {
  if (before === undefined || before === after) return "";
  const difference = Math.abs(subtractExact(after, before));
  return ` — ${String(difference)} ${after < before ? "fewer" : "more"} than projected`;
}
```

Pure (two `number` params, no props/state/hooks). Already imports `subtractExact` from `@/lib/decimal` (`:23`) — the fix from the lived incident is in place. Called at `:514` inside `handleCorrect`, interpolated into a success-notice string.

**Testability verdict**: pure but **not importable** — `MedicationsManager.tsx` has exactly one `export` (`export default function MedicationsManager`, `:175`). A test must either add `export` to the function in place, or extract it (with its doc comment) to a new pure module — no existing `src/lib/` file is a natural home; `decimal.ts` is arithmetic primitives with no domain vocabulary, `supply.ts` is the projection engine. The repo's own precedent for this exact move is `nextNonzeroPendingChange`, extracted to `src/lib/db/medications.ts` so both the island and the server-rendered card share one derivation instead of two.

#### Sweep result — the risk is narrower than "the display path" implies

A full sweep of `src/components/**` (excluding `src/components/ui/`, generated shadcn output) for arithmetic over medication/dosage/supply/quantity-derived values found **exactly one site**: `discrepancyPhrase`. No second instance of the defect class exists today. Specifically ruled out as false positives: `toNumber()` (string-to-number parse of form input, not numeric-column arithmetic), bare `String(...)` calls (single-value rendering, no operation), a literal `/` in JSX text ("`{daily_dosage} / day`"), and `Math.max(usageCount, 1)` in `SpecialistsManager.tsx` (an integer `count(*)`, not a `numeric` column).

**The dashboard itself performs zero client arithmetic by construction** — `src/pages/dashboard.astro` mounts no island at all (stated explicitly at `:11-14`); `SupplyCard.astro` only renders server-computed values.

#### Is a DOM/component test possible today?

**No, not without adding dependencies.** `vitest.config.ts:16` sets `environment: "node"`; no `jsdom`/`happy-dom`, `@testing-library/react`, or React Vite plugin exist in `package.json` or on disk (verified against `package-lock.json` and `node_modules`). This confirms that testing `discrepancyPhrase` as a rendered component is out of reach without new dependencies — testing it as a plain exported function is not, and needs only a reachable export plus an `include` glob that collects the new test file (see Test Infrastructure below).

### Test infrastructure — what a plan can rely on, what it must add

**Can rely on as-is:**

- Vitest 4.1.10 installed; `@/*` → `src/*` resolves under Vitest via a manual `resolve.alias` (`vitest.config.ts:10-14`), proven in practice by the existing suite's `@/db/database.types` import.
- `environment: "node"` — sufficient for every function this phase covers (none need a DOM).
- `tests/` is inside `tsconfig.json`'s typecheck scope (`include: [".astro/types.d.ts", "**/*"]`, only `dist` excluded) — a new test file is type-checked by `astro check`, which runs in CI, so it must type-check cleanly under `astro/tsconfigs/strict`.
- The local-Supabase-stack guard in `tests/integration/helpers/client.ts` (`:20-28`) runs **at call time, not import time** — reading env vars at module scope (`:7-8`) does nothing on its own. A pure unit test placed under `tests/` is not blocked by this guard, as long as it never calls `createAuthenticatedClient`.
- An established house style exists (`tests/integration/schema.test.ts`): explicit `vitest` imports (no globals), named SQLSTATE-style constants over magic values, `describe` names as domain phrases, `it` names as full behavioral sentences that state the counter-intuitive reasoning inline.

**Must be added by this phase's plan:**

- **`vitest.config.ts:17`'s `include` is `["tests/integration/**/_.test.ts"]`only.** A file at`tests/unit/_.test.ts`or co-located under`src/` will not be collected until the glob is widened. This is the single concrete infrastructure change this phase requires.
- `npm test` currently means `vitest run` = only the integration suite (which needs a live local Supabase stack). If unit tests should run without that stack (they should — none of Risk #1/#2's functions need it), either the config needs a project/workspace split or the single `include` glob needs widening to also match a unit-test path with no Supabase dependency; `npm test` would then start requiring the stack only for the subset of files that need it. Decide this in planning, not here.
- No CI step runs any test today (`.github/workflows/ci.yml` runs lint + typecheck + build only) — wiring CI is explicitly out of scope for this phase (that's rollout Phase 4, "Quality-gates wiring," per `test-plan.md` §3).
- `CLAUDE.md`'s Testing section currently defines only two buckets (`supabase/tests/` for DB invariants, `tests/integration/` for the client path via PostgREST) — it says nothing about pure unit tests. This phase's final sub-phase should record the new location as a §6 cookbook entry per the test-plan schema.

### Prior-spec drift — corrections a plan must not inherit uncritically

Four prior slices left written test specifications (`supply-status-dashboard/follow-ups/supply-engine-tests.md`, `mid-supply-dosage-change/follow-ups/deferred-tests.md`, `supply-status-dashboard/scratch/engine-harness.md`, `supply-status-dashboard/follow-ups/timezone-classification.md`). Independent verification found:

**Correct and safe to lift as-is:**

- All six `computeSupply` worked examples from `supply-engine-tests.md` (1–4) — verified against current code, `file:line` citations mostly hold with minor shifts (content unchanged; `supply.ts` untouched since 2026-09-08, absent from the S-05 PR diff).
- Worked examples 5 and 6 (the two "leading" ones) — **independently hand-verified by walking the breakpoint algorithm from the stated inputs, without reading the code's output first.** Both documented expected values (`2026-09-15`/`expiry`/95, and `2026-11-13`/`consumption`/25) are **arithmetically correct**.
- The scratch harness (`engine-harness.md`) — re-run verbatim against current `supply.ts`/`decimal.ts`/`dates.ts`: **32/32 still pass.** `dates.ts` and `decimal.ts` did change after the harness was captured (2026-09-10, additive `RangeError` guards only), but no assertion exercises either new guard, so none drift. Safe to lift as a starting set.

**Must NOT be copied verbatim — corrected here:**

- **`deferred-tests.md`'s S-05 future-dosage worked example states the wrong expected date.** It reads: `events: +30 on 2026-09-10; dosages: 1/day from 2026-09-10, 3/day from 2026-09-17; expiry: 2027-01-01; today: 2026-09-10` → the spec claims `supplyEndDate 2026-09-24`. **Independent hand-derivation gives `2026-09-23`**, confirmed by running the current engine against the fixture: seven days at 1/day (09-10 through 09-16) leaves 23; from 09-17 at 3/day, ⌊23/3⌋ = 7 whole days covered, landing the last full dose on **09-17 + 6 = 09-23**, not 09-24. The spec's own prose ("23 ÷ 3 is 7 whole days") is right and its final sentence miscounts the offset. A test-writer who copies `2026-09-24` verbatim writes a red test against a correct engine.
- **The same spec's `deriveStatus` table row is obsolete.** It asserts `{one dated today at 0, one at +7 (nonzero)} → not_used`. Shipped code returns **`not_started`** for this input (`medications.ts:245`, `currentDosage === 0 && hasNonzeroPending`). The rule changed via S-04's impl-review finding F5 after this follow-up was written; `plan.md:451-467` carries the current, amended contract. The table also omits a needed sixth row: a 0-dose-today medication with a **second pending row also at 0** must still resolve `not_used` (value-gating, not presence-gating — see `nextNonzeroPendingChange`'s own comment on why it is not `pending[0]`).
- **"Lift the harness, it already asserts everything" is an overclaim.** The committed harness has 32 assertions. `change.md` for `supply-status-dashboard` records a broadened 49-assertion re-run on 2026-09-08 that was never committed. The extra ~17 assertions (additional classifier boundaries, edge cases, the 5000-day differential context) must be re-derived from the prose in `supply-engine-tests.md`, not recovered from the harness file.
- Several `file:line` citations across the specs have shifted (not broken) as later slices added code above them — e.g. `medications.ts:302` → `:417`, `:418` → `:590`, `:524` → `:769`. Content at the new locations matches the original claims. One citation (`medications.ts:317` for a recount-quantity clamp) was slightly misattributed at authoring time — the clamp it meant is now at `:451`, in `createMedication`, not `recordSupply`.

## Code References

- `src/lib/supply.ts:26-231` — `SupplyInputs`, `SupplyResult`, `doseInForce`, `computeSupply`, `SupplyStatus`, `classifySupplyStatus` — the whole Risk #1 surface.
- `src/lib/supply.ts:198` — the exhaustion-at-expiry tie resolution (strict `>`, resolves to `"consumption"`).
- `src/lib/supply.ts:159-167` — the zero-dose branch; never divides.
- `src/lib/decimal.ts:58-112` — `floorDivide`, `subtractExact`, `addExact`, `multiplyExact`, `clampScale`; scale factor `10^6`.
- `src/lib/dates.ts:38-160` — `resolveToday` (clock injectable), `addDays`, `daysBetween`, `toEpochDay` (three `RangeError` sites).
- `src/lib/db/medications.ts:236-249` — `deriveStatus`, module-private; not in `dashboard.ts` as the test-plan's phrasing implied.
- `src/lib/db/medications.ts:99-103` — `nextNonzeroPendingChange`, exported and pure.
- `src/lib/dashboard.ts:2-151` — `buildDashboard`, `nextVisitFor`, `cardStateFor`; pure, `today` injected, no clock read.
- `src/components/medications/MedicationsManager.tsx:118-124` — `discrepancyPhrase`; pure, fixed, not exported.
- `vitest.config.ts:10-17` — `@` alias (works today) and `include` glob (must be widened for this phase).
- `tests/integration/helpers/client.ts:7-28` — the local-stack guard; call-time, not import-time.
- `validation/medication.ts:58,64-66` — `MIN_NONZERO_DOSAGE` and its `.refine`, the precision floor.

## Architecture Insights

- The supply engine's entire pure-function surface (`supply.ts`, `decimal.ts`, the date-arithmetic functions in `dates.ts`, and `dashboard.ts`) was evidently designed for unit testability from the start — clock and "today" are always passed as arguments, never read internally, and every risky arithmetic operation already routes through `@/lib/decimal`'s exact-scale helpers. The gap this phase closes is that none of this well-designed surface has ever been exercised by a test, not that it needs redesigning to become testable.
- The one place the "route everything through `@/lib/decimal`" convention was _not_ automatically followed — the client-side display path — was already caught and fixed by a prior incident (`discrepancyPhrase`). The remaining gap is narrow: making that already-correct function reachable from a test, not correcting its arithmetic.
- The codebase has a working precedent for exactly the "extract a private helper to make it shared/testable" move this phase may need for `discrepancyPhrase` and/or `deriveStatus`: `nextNonzeroPendingChange` was pulled out for the same reason (avoid two implementations / enable reuse).

## Historical Context (from prior changes)

- `context/changes/supply-status-dashboard/follow-ups/supply-engine-tests.md` — the closest-scoped prior specification; worked examples 1–6 verified accurate (5 and 6 independently hand-checked), display-path section confirms the `discrepancyPhrase` fix and specifies its needed assertions.
- `context/changes/mid-supply-dosage-change/follow-ups/deferred-tests.md` — adds the S-05 future-dosage shapes; contains the two corrections documented above (wrong worked-example date, obsolete `deriveStatus` row) and the pgTAP policy assertion (out of scope for this phase — belongs to rollout Phase 3, "Migration and policy drift guards").
- `context/changes/supply-status-dashboard/scratch/engine-harness.md` — 32-assertion scratch script; re-run and confirmed 32/32 pass against current code; safe as a starting point, known to be an incomplete (32 vs. the later 49-assertion, never-committed) version.
- `context/changes/mid-supply-dosage-change/reviews/impl-review.md` (F5) — the finding that changed the `deriveStatus`/`not_started` rule after `deferred-tests.md` was written; `plan.md:451-467` (that change's plan) carries the current, correct contract and should be preferred over the follow-up's table for that one rule.
- `context/foundation/lessons.md` → "Confirm every migration reached cloud" and "State table privileges in the migration" — not directly relevant to this phase (unit tests, no DB), but relevant to rollout Phase 3.

## Related Research

- `context/changes/supply-status-dashboard/research.md` — prior research on date-library evaluation for S-04; establishes the `resolveToday`/timezone design this phase's `dates.ts` coverage must respect.

## Open Questions

1. **Export or extract `discrepancyPhrase` and `deriveStatus`?** Both are pure and both are module-private. Planning should decide once, consistently: minimal `export` keyword additions in place, versus extracting both to new/existing pure modules. The repo has a precedent for extraction (`nextNonzeroPendingChange`) but no established rule for when a private helper should stay private vs. move. Not blocking — either choice makes the functions testable; this is a planning-time decision, not a research gap.
2. **`npm test` scope split.** Should `npm test` continue to mean "the integration suite, needs a live stack" with unit tests under a separate script (e.g. `test:unit`), or should the single `include` glob and script be widened to run both, with the Supabase-dependent tests conditionally skippable? This affects local developer workflow and is worth deciding explicitly in the plan rather than defaulting silently.
3. **The 17 harness assertions that exist only in prose.** `supply-engine-tests.md`'s "edges" and "`addDays`/`daysBetween`" sections describe assertions beyond the committed 32-assertion harness (the 49-assertion run from `change.md` was never committed). These are specified narratively and were not independently re-derived here beyond the two "leading" worked examples and the deriveStatus table — planning should treat the prose specification as authoritative, not the harness file, for anything beyond the 32 confirmed assertions.
