# Supply-status dashboard (S-04) Implementation Plan

## Overview

Turn the placeholder `/dashboard` into the PRD's Primary Success Criterion: for every medication the user has, a calculated supply-end date and a green / yellow / red status against the next visit with that medication's prescribing specialist — or "no visit scheduled" when there is none.

The calculation is a pure TypeScript engine that walks the append-only ledger and the dosage series chronologically. It is the first implementation of the arithmetic the PRD guards hardest ("an incorrect 'you have enough' result is a product failure regardless of how smooth the rest of the experience is"), and it is the engine S-05 and S-06 extend rather than replace.

## Current State Analysis

**What exists.** F-01's schema, S-01 (specialists), S-02 (medications) and S-03 (visits) are all done and live in production. `src/lib/db/medications.ts` already folds dosage and quantity on read — `foldDosage` at `:121-130` picks the latest non-future `dosage_changes` row, and `:148` sums `supply_events.quantity_delta`. `toView` at `:139-143` names itself the S-04 replacement point and promises "the exported signatures do not change".

**What is missing, and why it is not just a rendering job.**

- **The ledger sum is not the quantity on hand.** There is no consumption event type, so `Σ quantity_delta` is "everything ever added, net of corrections" — it equals real on-hand only on the day of the first event. Today's `quantity_on_hand` therefore never decays, which is precisely the "you have enough" over-report the guardrail forbids.
- **There is no day arithmetic.** `src/lib/dates.ts` exports three functions and none of them can add a day. `isFarFuture` at `:58-61` gets away with splicing the year field only because the month/day substring is untouched; that trick does not generalise across a month boundary.
- **`numeric` reaches JS as `number`.** `daily_dosage` and `quantity_delta` are unbounded Postgres `numeric`. `0.9 / 0.3` evaluates to `2.9999999999999996` in JS, so a naive `Math.floor` yields 2 where 3 is correct — a one-day error landing exactly on the green/yellow boundary.
- **The dashboard's "today" is undecided.** `foldDosage` and `is_expired` use UTC with an explicit apology at `medications.ts:159-163`; `/visits` classifies in the user's stored zone. S-02's and S-03's plans both flagged this seam and handed it here.
- **`/dashboard` is chrome only.** `dashboard.astro` renders a welcome card and mounts no island.

**Constraints inherited.** No triggers, functions or RPC in the schema. `dosage_changes` has no UPDATE policy and `supply_events` has neither UPDATE nor DELETE — corrections are new rows. `medications` has no DELETE policy. Data modules take a `SupabaseClient` first, never filter by `user_id`, return `Result<T>`, and log through `logDbError` before collapsing a Postgres error to a domain kind.

## Desired End State

A signed-in user opens `/dashboard` and sees their medications grouped by prescribing specialist, groups ordered by soonest upcoming visit. Each group header names the specialist and their next visit date. Inside a group, medications are ordered most-urgent-first, and each card shows the medication name, the date its supply lasts until, why that date (consumption or expiry), the projected quantity on hand today, and a green / yellow / red status badge — or "no visit scheduled" for a specialist with no upcoming appointment.

Correcting a count on `/medications` now writes a `recount` row carrying `counted_quantity` and the engine's `projected_quantity`, so the discrepancy between what was projected and what was counted is recorded rather than silently folded into an adjustment.

**Verification**: a medication refilled with 30 units 10 days ago at 1/day is projected at 20 on hand and reads "lasts until \<19 days out\>". Moving the next visit through four positions walks the whole classifier: 4 days out → green (19 > 4+14); 10 days out → yellow (19 ≤ 10+14 but still past the visit); **19 days out → red** (supply ends exactly on the visit, so nothing covers the day after); 25 days out → red.

### Key Discoveries:

- `src/lib/db/medications.ts:139-143` — the self-declared swap point; the exported signatures were promised stable, and this plan breaks that promise deliberately (see Phase 1, change 5).
- `src/lib/db/medications.ts:148` — `quantity_on_hand` as the raw ledger sum, with no consumption applied.
- `src/lib/dates.ts:38-44` — `resolveToday(tz)`, the only place a timezone is interpreted. The zone is an argument, not a second implementation.
- `src/lib/dates.ts:47-49` — `isPast` uses strict `<`, so a visit dated today is Upcoming. The dashboard's "next visit" must agree or the two screens disagree about the same row.
- `supabase/migrations/20260813185255_domain_schema.sql:191-193` — `supply_events_recount_delta_is_discrepancy` holds `quantity_delta = counted_quantity − projected_quantity` in exact `numeric`.
- `supabase/migrations/20260813185255_domain_schema.sql:155-158` — F-01's reason the engine is TypeScript: duplicating the arithmetic in SQL "would create a second implementation of the PRD's guarded calculation".
- `src/lib/validation/medication.ts:29-30` — `MAX_DAILY_DOSAGE = 1000`, `MAX_QUANTITY = 100_000`. These bound magnitude but not decimal places.
- `src/pages/visits.astro:39-40` — the `user_metadata.timezone` narrow, currently written inline and about to be needed in eight more places.
- `src/components/visits/VisitsManager.tsx:30-36` — "The island must never call `new Date()` for this."

## What We're NOT Doing

- **No unit or integration tests, and no CI change.** Deferred to a follow-up slice by explicit decision. `vitest.config.ts` and `.github/workflows/ci.yml` are untouched. See _Open Risks_ in the brief.
- **No Postgres view.** `CLAUDE.md` → _Domain schema_ says current-state views land at S-04; this plan does not create one, and Phase 2 change 5 amends that line rather than leaving the repo documenting a design it does not have.
- **No future-dated dosage changes.** The engine handles them structurally, but no UI writes one — that is S-05.
- **No liquid medications.** The four nullable columns stay untouched; `container_capacity` and `estimated_daily_consumption` play no part in the engine. That is S-06.
- **No new date-library dependency.** Settled in `research.md`.
- **No configurable thresholds.** 14 days is hardcoded, per PRD Non-Goals.
- **No island on the dashboard.** The screen is read-only; nothing on it needs hydration.
- **No consumption event type.** Consumption stays projected, never written.

## Implementation Approach

One pure engine, one chronological walk, three phases.

The engine's whole job is to answer two questions about a medication: _how much is on hand on a given date_, and _what is the last date a full dose is available_. Both fall out of a single walk over a merged timeline of breakpoints — the dates on which either a supply event landed or a dosage came into force. Between breakpoints the dose is constant, so a span is one division rather than a loop over days.

Everything else is comparison. The status is four string comparisons against the next visit date and a `+14` offset; the expiry cap is a `min`; the grouping is a sort. `YYYY-MM-DD` strings compare lexicographically as they compare chronologically, so no `Date` object appears anywhere on this path.

## Critical Implementation Details

**State sequencing — the recount's projection precedes its own delta.** `projected_quantity` on a recount row is the walk's answer _excluding_ that row. Applying the recount's delta first would make the projection self-referential and the CHECK would still pass, silently recording a zero discrepancy for every correction. Compute the projection, then derive `quantity_delta = counted − projected`, then insert.

**Two todays inside one function.** `recordSupply` needs both: `occurred_on` and the projection date are UTC (`todayUtc()`), because `occurred_on` follows `effective_date` by symmetry and the projection must be as-of the date it is stamped with; the `MedicationView` it returns is classified in the user's zone, because it replaces a row the page rendered that way. These may differ by one calendar day and that is intended.

**Safe-integer bound.** The scaling helper multiplies by up to `10^6`. `dose × spanLength` is computed only in the branch where the span is fully covered, which requires `dose × spanLength ≤ remaining`. `remaining` is the running **ledger sum**, not one event, so `MAX_QUANTITY` does not bound it directly — `remaining ≤ MAX_QUANTITY × eventCount`, and the scaled product is therefore bounded by `10^6 × 100_000 × eventCount = 1e11 × eventCount`. Against `Number.MAX_SAFE_INTEGER` (`≈ 9.007e15`) that leaves headroom of roughly **9×10⁴ max-size refills on a single medication** before the scaling overflows. Unreachable at the PRD's volume, but state the bound in ledger-sum terms rather than per-event terms: the per-event reading is what makes this look guaranteed when it is only very safe. The exponent is clamped at 6 so a hostile caller sending 13 decimal places cannot push it out; the consequences of that clamp are handled at the write boundary (Phase 3 change 1).

**The walk is bounded by `expiry_date`, and the breakpoint set is what makes that true.** Supply-end is capped at expiry regardless, so there is no reason to walk past `max(today, expiryDate)` — and not doing so is what keeps every intermediate quantity bounded. A medication whose supply outlives its expiry gets `expiry_date` with reason `"expiry"`. That cap is applied **after** the walk rather than as an exit test inside it (step 6): the walk has to reach `today` to report a projection even when expiry is long past, so expiry bounds where the walk stops but never why it stops.

That termination is **constructed, not assumed**: `expiryDate` is itself a breakpoint and every breakpoint beyond `bound = max(today, expiryDate)` is dropped (step 2). Without that, a breakpoint dated after expiry — an `occurred_on` one day ahead of the user's date through the UTC skew step 6 describes, or any future `effective_date` once S-05 writes one — leaves a span that straddles the expiry date, and the walk consumes straight through the cap. Concretely: `today` `2026-09-06`, `expiryDate` `2026-09-15`, a dosage row effective `2026-09-20` gives breakpoints `[09-01, 09-06, 09-20]`, and the span `[09-06, 09-19]` runs fourteen days past expiry and can return a `supplyEndDate` of `09-18` — a date the cap forbids, over-reporting cover in exactly the direction the PRD's guardrail names. The following span `[09-20, 09-15]` then has negative length. Both disappear once the set is bounded.

---

## Phase 1: The supply engine and the data module

### Overview

Add the two missing date primitives, an exact-arithmetic helper, the engine itself, and wire it through `src/lib/db/medications.ts`. Ends with `/medications` behaving as before except that its status labels and expiry flag now resolve in the user's zone and reflect projected rather than ledger quantity.

### Changes Required:

#### 1. Date primitives

**File**: `src/lib/dates.ts`

**Intent**: Supply the only two date operations the codebase lacks. Both stay inside the module's existing discipline — `YYYY-MM-DD` in, `YYYY-MM-DD` or an integer out, no `Date` object escaping.

**Contract**: `addDays(date: string, days: number): string` and `daysBetween(from: string, to: string): number` (signed; `to − from`, so a `to` before `from` is negative). Both convert to an epoch-day integer internally via a Gregorian day-number formula and back — not via `Date`, because a `Date` on this path is how the off-by-one-day bug the module's header warns about gets in. Both throw on a string that is not a valid `YYYY-MM-DD`; every caller in this plan passes either a value already gated by `z.iso.date()` or a value produced by `resolveToday`, so the throw is a programming-error signal, not a runtime path.

#### 2. Exact decimal arithmetic

**File**: `src/lib/decimal.ts` (new)

**Intent**: Remove the float-division class rather than mask it. Postgres `numeric` is exact decimal; JS `number` is binary, so `0.9 / 0.3` is `2.9999999999999996` and `0.3 − 0.1` is `0.19999999999999998`. Both appear on this slice's critical path — the first in the day count, the second in the recount CHECK.

**Contract**: Five functions. The first four operate by scaling both operands to integers by `10^max(decimalPlaces(a), decimalPlaces(b))` and rounding:

- `floorDivide(a: number, b: number): number` — exact `⌊a / b⌋`. Callers guarantee `b > 0`.
- `subtractExact(a: number, b: number): number`
- `addExact(a: number, b: number): number`
- `multiplyExact(a: number, times: number): number` — `times` is an integer day count.
- `clampScale(n: number): number` — rounds `n` to the module's 6-place limit and returns it. Exported because the clamp has to be applied to a value **before it is written**, not only inside an operation: Phase 3 stores `counted_quantity` through this so the column and the delta derived from it cannot disagree.

`decimalPlaces` reads the count from `String(n)`'s shortest round-trip representation and clamps at 6. Exponential notation (`1e-7`) is treated as 6 places rather than parsed, since nothing in range produces it.

**The clamp is a write-boundary concern, not only a precision note.** Anywhere a clamped result is compared by Postgres against an unclamped stored value, the two disagree and a CHECK fires. That is one place in this slice — the recount row — and Phase 3 change 1 handles it by clamping the input rather than by widening the module. A future caller storing a raw `number` alongside a value this module produced has the same problem and the same fix.

#### 3. The engine

**File**: `src/lib/supply.ts` (new)

**Intent**: One walk answers both questions the dashboard asks — what is on hand today, and what is the last day a full dose is available. Structured so S-05's future-dated dosage rows are simply more breakpoints and need no change here.

**Contract**:

```ts
export interface SupplyInputs {
  events: { quantity_delta: number; occurred_on: string }[];
  dosages: { daily_dosage: number; effective_date: string }[];
  expiryDate: string;
  today: string;
}

export interface SupplyResult {
  /** Last day a full dose is available. `null` only when no supply event exists. */
  supplyEndDate: string | null;
  /** Which constraint produced the date. Ties resolve to `"consumption"`. */
  supplyEndReason: "consumption" | "expiry" | null;
  /** On hand on the morning of `today`, before that day's dose. Never negative. */
  projectedQuantity: number;
}

export function computeSupply(inputs: SupplyInputs): SupplyResult;
```

The walk:

1. `start = MIN(events.occurred_on)`. With no events, return `{ supplyEndDate: null, supplyEndReason: null, projectedQuantity: 0 }` — there has never been anything to consume.
2. Set `bound = max(today, expiryDate)` — the last date the walk has any reason to reach. Build the breakpoint set: every distinct `occurred_on`, every `effective_date`, plus `today`, **plus `expiryDate`**; keep only dates in `[start, bound]`; sort ascending. `today` is included so the projection can be read off mid-walk even when nothing else happens that day; `expiryDate` is included so the cap is a breakpoint the walk lands on rather than a comparison it might straddle; and the upper bound drops rows dated past `bound` — a future `effective_date`, or an `occurred_on` a day ahead through the UTC skew of step 8 — which would otherwise produce a span running past expiry and a following span of negative length. Dropping them loses nothing: a dose that comes into force after `bound` cannot affect any day the walk covers.
3. Walk spans `[b_i, b_{i+1} − 1]`, with the final span running to `bound` inclusive. At each `b_i`: add the deltas of all events dated `b_i` (flooring `remaining` at 0), then record `projectedQuantity` if `b_i === today`, then consume across the span at the dose in force (the greatest `effective_date ≤ b_i`; 0 when none). Because `expiryDate` is a breakpoint whenever it lies in `[start, bound]`, no span ever crosses it. **The walk runs the whole breakpoint set — exhaustion records a date, it does not terminate the walk.** See step 5 for why.
4. Consumption within a span of length `L` at dose `d`, skipped entirely while `exhausted` (step 5) — `remaining` is 0 there, so consuming would only re-record a later date for a supply that already ended:
   - **`d === 0`** — nothing is consumed, and the two cases are distinct. With `remaining > 0` the whole span is covered at zero cost: carry `remaining` forward unchanged. With `remaining === 0` there is no full dose to be had on any day of the span, so the supply ended the day before it started: `supplyEndDate = addDays(b_i, −1)` and `exhausted = true`. This is the case a `5 → 0 → 5` series produces when the first segment exhausts exactly at the pause, and it is why the zero-dose branch must never divide — `CLAUDE.md` → _Domain schema_.
   - **`d > 0`** — `covered = floorDivide(remaining, d)`; if `covered ≥ L` the whole span is covered and `remaining -= multiplyExact(d, L)`; else the supply ends at `addDays(b_i, covered − 1)`, `remaining = 0` and `exhausted = true`. `covered === 0` yields the day before `b_i`, which is the same shape as the zero-dose exhaustion above.
5. **Exhaustion is provisional until the walk ends, because a later refill un-ends it.** `occurred_on` is always `todayUtc()`, so a user who runs out and refills a fortnight later produces exactly this shape: +30 on `2026-09-01` at 1/day exhausts on `09-30`, +30 lands on `10-15`, and `today` is `10-20`. A walk that stopped at the first exhaustion would never reach either the refill or the `today` breakpoint — reporting `2026-09-30` and a projected 0 for a user holding 25 units with cover through `2026-11-13`. So exhaustion sets a flag rather than returning: on arriving at a breakpoint whose deltas push `remaining` back above 0, clear `exhausted` and discard the recorded `supplyEndDate`, and resume consuming. The answer is the **last** exhaustion the walk records. (It errs toward under-reporting cover rather than over-reporting it, so it is not the failure the PRD guardrail names — but it is a wrong number on the one screen this slice exists for.)
6. **The expiry cap is applied once, after the walk.** If the walk ends with `exhausted === false`, supply outlives `bound ≥ expiryDate`: `supplyEndDate = expiryDate`, reason `"expiry"`. If it ends exhausted at a date later than `expiryDate` — reachable when `bound` is `today` because the medication expired in the past — clamp to `expiryDate`, reason `"expiry"`. Otherwise the recorded exhaustion day, reason `"consumption"` — including when it equals `expiryDate` exactly, since ties resolve to consumption. Applying the cap after the walk rather than on arrival at the `expiryDate` breakpoint is what keeps it correct in both directions without a second exit test.
7. **`expiryDate < start` returns before the walk.** Nothing can be usable after expiry, and expiry precedes every event, so the answer is `expiryDate` with reason `"expiry"` and a projected quantity of 0. Handled up front because `expiryDate` would otherwise be filtered out of the breakpoint set by the `≥ start` bound, taking the cap with it.
8. `projectedQuantity` is clamped at 0 and, when `today < start`, is the untouched sum of deltas dated at or before `today` (which is 0). A `today` before `start` is reachable: `occurred_on` is derived in UTC and can be one day ahead of the user's own date.

Also here, because both are pure and both belong to the same domain rule:

```ts
export type SupplyStatus = "green" | "yellow" | "red" | "no_visit";

export function classifySupplyStatus(supplyEndDate: string | null, nextVisitDate: string | null): SupplyStatus;
```

`null` visit → `"no_visit"`. `null` supply-end (nothing ever on hand) → `"red"`. Otherwise: `supplyEnd <= visit` → red; `supplyEnd > addDays(visit, 14)` → green; else yellow.

**The three bands partition on days of cover _after_ the visit** — green is more than 14, yellow is 1 through 14, red is none. That is what puts `supplyEnd === visit` in red: every medication in the yellow band has some cover left after the appointment, and this one has none — the day after the visit it is at zero, and the visit is the last chance to prevent that. It also makes yellow exactly 14 days wide rather than 15 with a ragged edge.

**This is a deliberate one-case deviation from the PRD**, which reads "Red: supply-end date is before the next specialist visit" and would put the equality in yellow. Read as an ambiguity the PRD did not consider rather than a decision it made — the PRD's yellow gloss, "supply ends ≤ 14 days after the visit date", is written in days-after-the-visit terms and `supplyEnd === visit` is zero days after, not one through fourteen. Green's boundary is untouched: `visit + 14` is yellow, `visit + 15` is green.

#### 4. Shared user-zone resolution

**File**: `src/lib/dates.ts`

**Intent**: `visits.astro:39-40` narrows `user_metadata.timezone` from `any` to `string | undefined` inline before calling `resolveToday`. Phase 1 needs that narrow in eight more places; duplicating it eight times is how one of them ends up passing the `any` and tripping `no-unsafe-argument`.

**Contract**: `resolveTodayForUser(userMetadata: unknown): string` — performs the narrow and delegates to `resolveToday`. `visits.astro` switches to it, so there is exactly one narrow in the codebase.

#### 5. Wire the engine into the data module

**File**: `src/lib/db/medications.ts`

**Intent**: Replace the two folds with the engine and thread the user-zone `today` in from the caller instead of resolving UTC internally. Every function that returns a `MedicationView` needs it, because a mutation's response replaces a row the page rendered in the user's zone; a UTC-classified row landing in that list is how the two disagree.

**Contract**:

- `MEDICATION_SELECT` gains `occurred_on` on the `supply_events` embed. That is the only query change.
- `MedicationView` gains `supply_end_date: string | null`, `supply_end_reason: "consumption" | "expiry" | null`, and `projected_quantity: number`. `quantity_on_hand` stays and keeps its current meaning — the raw ledger sum — because `recordSupply`'s refill path and the create path still reason in ledger terms.
- Every exported function takes `today: string` as its **last** parameter: `listMedications(client, today)`, `createMedication(client, input, today)`, `updateMedicationDetails(client, id, input, today)`, `setDosage(client, id, dailyDosage, today)`, `recordSupply(client, id, input, today)`, `setArchived(client, id, archived, today)`. `readMedication` takes it too.
- `todayUtc()` stays, and stays used for exactly what it is for: `effective_date` and `occurred_on` on the write paths. It is no longer used for classification. Its doc comment says so.
- `deriveStatus`'s `out_of_stock` test moves from the ledger sum to `projectedQuantity <= 0`. A medication refilled 30 days ago at 1/day now correctly reads as out of stock.
- **`MedicationStatus` gains `"no_dosage"`, and `deriveStatus` takes the dosage-row count.** Today a dosage of 0 means two different things and reports as one: the user set it to 0 — the schema's first-class "I have stopped taking this" (`domain_schema.sql:126-129`) — or there is no `dosage_changes` row at all, which `foldDosage` also returns 0 for (`medications.ts:120`). The second is reachable: `createMedication` logs a failed dosage insert and still reports success (`:208-222`), so a medication can exist having never had a dosage recorded. Collapsed into one label it reads as a deliberate choice, and on the dashboard it would sort last as "no action needed" while the app has in fact lost the user's data. The test is `dosage_changes.length === 0`, not `current_dosage === 0`. New precedence: archived → `no_dosage` → `not_used` → `out_of_stock` → `active`. (`no_dosage` and `not_used` are mutually exclusive; the order documents intent rather than resolving a clash.)
- **Handed to S-05:** a medication whose dosage rows are _all_ future-dated has `length > 0` and folds to 0 today, so it lands in `not_used` / "Stopped". No S-04 surface can create that row, so it is unreachable here — but S-05's whole purpose is writing one, and "Stopped" is the wrong word for "starts next Monday". S-05 splits it; this plan names it so it is found by reading rather than by bug report.
- `is_expired` becomes `expiry_date < today` against the user-zone `today`. The apology comment at `:159-163` is replaced by a statement of what now holds.

#### 6. Callers of the changed signatures

**Files**: `src/pages/medications.astro`, `src/pages/api/medications/index.ts`, `src/pages/api/medications/[id].ts`, `src/pages/api/medications/[id]/archive.ts`, `src/pages/api/medications/[id]/dosage.ts`, `src/pages/api/medications/[id]/supply.ts`

**Intent**: Pass the user's `today`. Each already has the user in scope — `Astro.locals.user` on the page, `context.locals.user` on the routes, guarded by the 401 check that already runs first.

**Contract**: `resolveTodayForUser(locals.user?.user_metadata)` at the top of each handler, threaded into the data-module call. No other behaviour changes.

#### 7. Island display fields

**File**: `src/components/medications/MedicationsManager.tsx`

**Intent**: The "on hand" figure the user reads and the value that pre-fills the correction form must both be the projected quantity. Pre-filling the correction with the ledger sum would invite the user to confirm a number the engine already knows is stale, and the recount would then record a zero discrepancy for a real one. The new status variant also needs a label here, not only on the dashboard — the same silent gap exists on this screen.

**Contract**: `:218` (correction pre-fill), `:515` ("On hand" display), `:321` and `:342` (success notices) switch from `quantity_on_hand` to `projected_quantity`. `STATUS_LABEL` (`:63`) and `STATUS_CLASS` (`:70`) gain a `no_dosage` entry — "No dosage recorded", styled `text-destructive` because it is a data gap the user must act on, not the muted treatment `not_used` gets. Both maps are `Record<MedicationStatus, string>`, so the compiler refuses the build until each is updated; that exhaustiveness is the reason the variant goes on `MedicationStatus` rather than being derived ad hoc on the dashboard. No structural change to the component.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes at zero errors and zero warnings: `npm run lint`
- Production build succeeds: `npm run build` (dev server stopped first — `lessons.md` → _Never run a production build against a live dev server_)

#### Manual Verification:

- `/medications` still lists, creates, edits, archives, restores, refills and corrects with no visible regression
- A medication whose last refill predates today by more than its supply now shows "0" on hand and the out-of-stock label, where it previously showed the ledger figure
- The correction panel pre-fills with the projected figure, not the ledger sum
- A medication with no `dosage_changes` row reads "No dosage recorded" on `/medications`, distinct from one whose dosage was explicitly set to 0, which still reads "Not used" (delete the row directly in Studio to produce the first case)
- Walk the six worked examples in _Testing Strategy_ by hand against the implementation and confirm each produces the stated date — examples 5 (a breakpoint past the expiry cap) and 6 (exhaustion then refill) deliberately, since those are the two whose failures are invisible to the other four

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: The dashboard

### Overview

Replace the placeholder in `dashboard.astro` with the real screen: medications grouped by prescribing specialist, groups ordered by soonest upcoming visit, urgency-ordered within.

### Changes Required:

#### 1. Grouping and ordering

**File**: `src/lib/dashboard.ts` (new)

**Intent**: Keep the page's frontmatter to fetching and delegation. The grouping rule is a domain rule with real edge cases and belongs beside the engine, not inline in an `.astro` file.

**Contract**:

- `nextVisitFor(visits: Visit[], specialistId: string, today: string): string | null` — the smallest `visit_date` for that specialist that is not past. Uses `isPast` so the definition of "upcoming" is literally the one `/visits` renders; a visit dated today counts as next.
- `buildDashboard(medications: MedicationView[], visits: Visit[], today: string): SpecialistGroup[]` where a group carries the specialist, its `nextVisitDate: string | null`, and its ordered medications each paired with a `card` state.
- Card state is `"no_dosage" | "stopped" | "out_of_stock" | SupplyStatus`, derived in `MedicationView.status`'s existing precedence — `no_dosage` → `"no_dosage"`, `not_used` → `"stopped"`, `out_of_stock` → `"out_of_stock"`, otherwise `classifySupplyStatus(...)`. Reusing that precedence rather than inventing a second one is what keeps `/medications` and `/dashboard` agreeing about the same row.
- Archived medications are excluded.
- Group order: by `nextVisitDate` ascending, groups with no upcoming visit last, ties broken by specialist name. Within a group: `no_dosage` → `out_of_stock` → `red` → `yellow` → `green` → `no_visit` → `stopped`, ties broken by medication name. `no_dosage` sorts above everything, including `out_of_stock`: the others are answers, and this one is the app admitting it has none — an unknowable medication is worse than a known-empty one, and it is the only state on the screen that means "something is wrong with your data" rather than "here is your situation".

#### 2. The page

**File**: `src/pages/dashboard.astro`

**Intent**: Fetch, resolve one `today`, delegate, render. No island — nothing on this screen is interactive, so hydrating it would cost bytes on the exact NFR-constrained path ("dashboard loads and displays all calculated supply statuses within one second for up to 20 medications on a standard mobile network") for no behaviour.

**Contract**: Mirrors `medications.astro`'s shape — `createClient`, a `Promise.all` over `listMedications` and `listVisits`, a `loadFailed` flag rendered as the same bordered error paragraph the other pages use, `Topbar`, and the same `max-w-3xl` main column. `today` comes from `resolveTodayForUser` once and is passed down; no component calls `new Date()`. Empty states: no medications at all links to `/medications`; medications but no specialist with an upcoming visit renders the groups with "no visit scheduled" headers rather than an empty screen.

#### 3. Presentation components

**Files**: `src/components/dashboard/SpecialistGroup.astro`, `src/components/dashboard/SupplyCard.astro` (both new)

**Intent**: One component per level of the structure, both pure presentation over props the page already computed.

**Contract**:

- `SpecialistGroup` renders an `<h2>` with the specialist's name and specialty, the next visit date as a `<time>` element or the words "No visit scheduled", and a `<ul>` of cards.
- `SupplyCard` renders the medication name, the supply-end date as `<time>`, a short reason line distinguishing consumption from expiry, the projected quantity and current dosage, and the status badge.
- Status is never carried by colour alone — each badge pairs its colour with a word ("Enough", "Tight", "Order now", "Out of stock", "No dosage recorded", "Stopped", "No visit scheduled"), matching the `aria-current`-plus-underline precedent in `Topbar.astro:13-15`.
- A `no_dosage` card shows no supply-end date and no quantity — both would be fabrications. It carries the reason ("No daily dosage has been recorded, so supply cannot be calculated") and a link to the medication on `/medications` so the fix is one click away. It is the only card that tells the user to do something to the app rather than about their medication.
- Colours come from the `:root` tokens per `CLAUDE.md` → _Design conventions_ — `text-primary` for green, `text-destructive` for red, `text-warning` for yellow (added in change 4 below), `text-muted-foreground` for the neutral states. Never a hardcoded `amber-*` or `green-*`.
- The badge is **coloured text, not a filled pill.** That is what `MedicationsManager`'s `STATUS_CLASS` map already does (`:70`), and it is what the rationing rule requires — "a screen where green is a background is a screen where green has stopped meaning anything", and this screen renders one badge per medication. A badge needing more weight gets size or font weight, never a background.
- The date is rendered as the stored `YYYY-MM-DD` string, as `VisitsManager.tsx:346-350` does and for the same reason: formatting it means parsing it into a `Date`.

#### 4. The warning colour token

**File**: `src/styles/global.css`

**Intent**: There is no amber token in the palette. S-02 left the gap on purpose — `MedicationsManager.tsx:56-62` records "There is no amber token in `:root`, and this slice deliberately does not invent one: the green/yellow/red supply scale belongs to S-04." This is that slice, so the token is defined here once and every yellow in the app reads from it.

**Contract**: Two edits, and **both are required** — Tailwind v4 resolves utility classes from the `@theme inline` block, not from `:root`, so a token added only to `:root` compiles without error and yields no `text-warning` class at all:

1. `:root` (after `--destructive`): `--warning: oklch(0.555 0.163 48.998); /* amber-700 #B45309 */`
2. `@theme inline` (after `--color-destructive`): `--color-warning: var(--warning);`

**amber-700, not amber-500.** Measured on white: amber-500 is **2.15:1** — it fails even the 3:1 non-text threshold, let alone AA for text; amber-600 is **3.19:1**, the same "borders and rings only" band `--ring` sits in; amber-700 is **5.02:1**, which is the identical ratio `--primary` (green-700) already achieves. Since the badge is text, 700 is the only shade that works. It reads as burnt orange rather than a bright warning yellow, and that is the same cost the palette already pays for green — `--primary` is a deep forest green, not a vivid one. Extend the header comment in `global.css` with this reasoning; without it the next reader "fixes" the token to the shade their eye expects, and the fix is the failure.

**No `--warning-foreground`.** That token would only earn its place with a filled amber background, and change 3 above rules those out. Adding it now would be an unused token inviting exactly the filled badge the rationing rule forbids.

**The `.dark` block is deliberately not touched.** `CLAUDE.md` → _Design conventions_: "Only `:root` is live... Leave it alone rather than tuning it; a slice that wants dark mode starts by populating it." An unreviewed dark-mode amber guessed here would be worse than the `:root` value it would fall through to. Do not flag its absence in review.

#### 5. Documentation amendments

**Files**: `CLAUDE.md`

**Intent**: Two lines in `CLAUDE.md` describe a codebase this slice makes untrue. Left alone they read as instructions, and the next agent follows them.

**Contract**:

- `:94` — "**Current-state views** (latest dosage + current balance) are to be created once, at first need in S-04, and reused — not reimplemented per slice." No view exists after this slice. Replace with the decision actually taken: the supply calculation lives in `src/lib/supply.ts` as the single implementation, F-01's "duplicating that arithmetic in SQL would create a second implementation" being the reason, and a view remains available later if a read pattern demands one.
- `:65` — the green-700/600 contrast rule. Extend it to state the general form (the 700 shade for anything with a letter in it, the 600 for rings and borders) and name `--warning` as the second token following it, with amber-500's 2.15:1 called out as the trap.

Both are amendments to a live contract, not notes — make them in the same commit as the code they describe, or the repo documents a design it does not have.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes at zero errors and zero warnings: `npm run lint`
- Production build succeeds: `npm run build`
- No hardcoded palette colour in any component: `grep -rnE "(amber|green|red|yellow)-[0-9]{3}" src/components src/pages src/layouts` returns nothing

#### Manual Verification:

- With two specialists, medications on each, and a visit scheduled for one: groups appear in visit-date order and the visit-less specialist's group is last with "No visit scheduled"
- Moving one visit date through the four positions in _Desired End State_ drives the badge green → yellow → red → red, including the equality case where the supply ends exactly on the visit day
- A medication whose printed expiry precedes its consumption-end shows the expiry date with the expiry reason
- A medication with dosage 0 shows "Stopped" and no status colour; one at zero projected quantity shows "Out of stock" and sorts above the coloured cards
- A medication with no dosage row shows "No dosage recorded", sorts above everything in its group, shows neither a date nor a quantity, and links to `/medications`
- The yellow badge renders in amber-700 and is legible against the card; confirm `text-warning` resolves to a real class rather than silently doing nothing (a token added to `:root` but not to `@theme inline` produces no class and no error)
- The page is usable at a 320 px viewport with no horizontal scrolling
- View source confirms no `client:*` directive and no hydration script for this page
- `CLAUDE.md` lines 65 and 94 are amended per change 5, in the same commit as the code they describe — `git show --stat` on that commit lists `CLAUDE.md` alongside the dashboard files

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: The recount write path

### Overview

Close F-01's carried-forward item. `recordSupply`'s correction currently reads the ledger, computes a difference, and appends an `adjustment` — a shape S-02 chose only because "an honest recount needs the `projected_quantity` only S-04's consumption engine can supply" (`medications.ts:385-399`). The engine now supplies it.

### Changes Required:

#### 1. The correction path

**File**: `src/lib/db/medications.ts`

**Intent**: Record what was projected alongside what was counted, so the discrepancy is a fact in the ledger rather than a number folded away. This also removes the stale-base race the current path documents: the projection is derived from the same read that produces the row, and the CHECK rejects any row where the three figures disagree.

**Contract**: The `kind === "correction"` branch reads the medication, takes `projected_quantity` as of `todayUtc()` — not the user-zone `today`, because it is stamped on a row dated `occurred_on = todayUtc()` — and inserts:

```
const counted = clampScale(input.counted);

event_type:         'recount'
counted_quantity:   counted
projected_quantity: <engine>
quantity_delta:     subtractExact(counted, projected)
occurred_on:        todayUtc()
```

`quantity_delta` **must** come from `subtractExact`. `supply_events_recount_delta_is_discrepancy` compares in exact `numeric`: a JS-computed `0.3 − 0.1` serialises as `0.19999999999999998`, Postgres computes `0.2`, and the insert fails `23514`. That failure would surface as an unexplained "Could not record the supply change" — the exact shape `lessons.md` → _Log the database error before collapsing it to a domain kind_ was written about.

**`counted` is stored through `clampScale`, not raw, and that is what closes the clamp's second failure path.** `subtractExact` scales at `10^6`, so it computes against a value rounded to six decimal places — but `counted_quantity` is `numeric` with unbounded scale and would otherwise store whatever arrived. Zod bounds magnitude and not precision, so an API caller sending `counted: 0.1234567` stores exactly and subtracts approximately, the three figures disagree, and the CHECK rejects the row with the same `23514` this section spends a paragraph preventing. Rounding `counted` once, up front, and using that same value in both the column and the delta makes all three agree by construction — no schema change, and no input the route previously accepted now 400s. What it costs is honesty about the seventh decimal: the row records `0.123457`, not what was sent. That is acceptable for a medication count, where six decimal places is already three orders of magnitude past anything dispensable, and it is the reason the clamp is described in _Critical Implementation Details_ as handled here rather than as merely documented.

A zero delta stays a successful no-op returning the unchanged row, as today — appending a recount that records no discrepancy says nothing, and the current behaviour is already correct.

**Note on the projection date.** `projected_quantity` must be the engine's answer for `todayUtc()`, which is not necessarily the `projected_quantity` on the `MedicationView` the same call returns (classified in the user's zone). Compute it explicitly rather than reading it off the view.

#### 2. Route and island

**Files**: `src/pages/api/medications/[id]/supply.ts`, `src/components/medications/MedicationsManager.tsx`

**Intent**: Confirm the existing contract still fits, and surface the discrepancy when there is one.

**Contract**: `supplyInputSchema`'s `correction` variant already carries `counted`, so neither the schema nor the route's shape changes — the route is verified unchanged, not edited. In the island, the correction success notice states the discrepancy when the delta is non-zero (e.g. "corrected to 18 on hand — 2 fewer than projected"), which is the first time the user sees that the app was tracking a projection at all.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes at zero errors and zero warnings: `npm run lint`
- Production build succeeds: `npm run build`
- pgTAP still passes against the local stack: `npm run db:reset` then `npm run db:test` (claim the shared stack from this worktree first — `lessons.md` → _Reset the database from your own worktree before you use it_)

**Run this criterion first, before seeding anything.** `db:reset` re-applies migrations from scratch and takes the database with it, so it destroys every medication, refill and visit the manual steps below need — and the manual steps are the only behavioural gate this phase has. Reset and run pgTAP on the empty stack, then seed and walk the manual list. Running them in written order means building the whole scenario twice.

#### Manual Verification:

- Correcting a count to a figure differing from the projection writes a `recount` row; confirm in Studio that `counted_quantity`, `projected_quantity` and `quantity_delta` are all populated and consistent
- Correcting to exactly the projected figure writes no row and returns 200 with the unchanged medication
- A correction with a fractional projection (e.g. counted 0.3 against projected 0.1) succeeds rather than failing `23514`
- A correction posted directly to `/api/medications/<id>/supply` with seven decimal places (e.g. `counted: 0.1234567`) succeeds, and Studio shows `counted_quantity` stored as the six-place rounding — the `clampScale` path, which no UI can produce and only a raw request reaches
- The dashboard's supply-end date shifts as expected after the correction
- The Workers log carries no `medications.recordSupply.*` line for either successful case

---

## Close-out

Not a phase — the wrap-up after Phase 3's gate closes. Two of the four items exist because this slice ships no tests: what it defers has to survive in something that is not this file.

- **`follow-ups/supply-engine-tests.md`** — the test contract this slice does not write, in the shape of `manage-medications/follow-ups/deferred-tests.md`. Lift _Testing Strategy_'s three lists into it verbatim; the section below is the specification, and once this folder is archived that specification is immutable and out of the working tree. **Lead with the two assertions most likely to be silently "corrected" by a later reader**: `classifySupplyStatus` putting `supplyEnd === visit` in **red** (the deliberate PRD reading, which needs its reasoning in the test name), and worked example 5 — a breakpoint past the expiry cap — whose failure mode over-reports cover rather than under-reporting it. Then the rest.
- **The pull request.** Push the `feat/supply-status-dashboard` branch, open a PR against `master`, let CI run on it, and merge there. Close [#5](https://github.com/monika-mur/medcalc/issues/5) from the PR body rather than by hand. `lessons.md` → _Open a pull request for every slice; never fast-forward master_ is the reason this is written down at all: S-02 and S-03 both landed as a local fast-forward, and the lesson records that the gate cannot be reinstated afterwards — once `master` carries the commits the branch is 0 ahead and GitHub refuses to open a PR for them. This is the first slice planned since that was written.
- **`roadmap.md`** — flip `### S-04: Supply-status dashboard` → `**Status:**` and the row at `:36` from `planning` to `done`, and add the `## Done` entry citing the PR. Do it from the PR, not afterwards; the same lesson records the roadmap losing its evidence column precisely because S-02 and S-03 had no PR to cite.
- **`change.md`** — session state per phase, adaptations, and anything found that the plan did not predict.

**Worth knowing while doing this**: CI runs only `lint` and `build` (`.github/workflows/ci.yml:20-21`). `npm run typecheck` is a named script but is **not** enforced — see the open follow-up `manage-doctor-visits/follow-ups/typecheck-in-ci.md`. So of this slice's three automated criteria, one never runs in CI and none of the three tests behaviour. A green PR check says the code compiles and lints, nothing more, which is the whole reason the first item above is not optional.

### Success Criteria:

#### Manual Verification:

- `follow-ups/supply-engine-tests.md` exists and leads with the red-equality case and worked example 5
- The slice landed through a pull request against `master` that closed #5; `master` was never fast-forwarded onto the branch
- `roadmap.md` reads `done` for S-04 in both places and the `## Done` entry cites the PR
- `change.md` records per-phase session state and anything the plan did not predict

---

## Testing Strategy

Automated tests are **deliberately deferred to a follow-up slice** by explicit decision. This section records what that slice must cover and what has to be checked by hand in the meantime — it is the specification for the deferred work, not a description of work in this plan.

### Worked examples to verify by hand (Phase 1)

Each states inputs and the expected `supplyEndDate`. Walk them against the implementation.

1. **Single refill, constant dose.** Refill +30 on `2026-09-01`, dosage 1/day from `2026-09-01`, expiry `2027-01-01`. Days covered are `09-01` through `09-30`, so supply-end is `2026-09-30`, reason `consumption`. Projected on `2026-09-06` is 25.
2. **Two refills — the case that breaks a last-event anchor.** +30 on `2026-09-01`, +30 on `2026-09-11`, dose 1/day. On `2026-09-11` the walk has already consumed 10, so it holds 50, not 60. Supply-end is `2026-10-30` — 60 units at 1/day from `09-01` cover `09-01` through `10-30`. A last-event anchor would answer `2026-11-09`, exactly the ten days of consumption it discarded; that gap, not the absolute date, is what this example exists to catch.
3. **Dosage change between events.** +30 on `2026-09-01` at 1/day; dosage becomes 2/day on `2026-09-11`. Ten days at 1 leaves 20, then ten days at 2 leaves 0 — supply-end `2026-09-20`.
4. **Expiry cap.** +100 on `2026-09-01` at 1/day, expiry `2026-10-01`. Consumption would reach `2026-12-09`, so supply-end is `2026-10-01`, reason `expiry`.
5. **A breakpoint past the expiry cap.** +100 on `2026-09-01` at 1/day, expiry `2026-09-15`, and a dosage row effective `2026-09-20`, with `today` `2026-09-06`. `bound` is `2026-09-15`, so the `09-20` breakpoint is dropped and `expiryDate` is itself a breakpoint: supply-end is `2026-09-15`, reason `expiry`. Getting `2026-09-18` — or any date after the expiry — means the breakpoint set was not bounded and the walk consumed through the cap. This is the one example whose failure mode over-reports cover, so walk it deliberately rather than by pattern.
6. **Exhaustion, then a refill — the case that breaks a terminating walk.** +30 on `2026-09-01` at 1/day, +30 on `2026-10-15`, expiry `2027-01-01`, `today` `2026-10-20`. The first stretch exhausts on `09-30`; the `10-15` refill un-ends it. Supply-end is `2026-11-13` and the projection on `10-20` is 25. A walk that returned at the first exhaustion answers `2026-09-30` and 0 — telling a user holding a nearly full box that they are out of stock. Unlike example 5 this fails toward under-reporting cover, which is why it survives a guardrail read but not a user.

### Unit tests (deferred slice)

- `addDays` / `daysBetween`: month and year boundaries, leap years (2024, 2100 non-leap, 2000 leap), negative offsets, and a differential run against `Date.toISOString()` over several thousand consecutive days.
- `floorDivide` / `subtractExact`: the failing pairs by name — `0.9 / 0.3` must be 3, `0.3 − 0.1` must be exactly `0.2` — plus the 6-decimal clamp boundary.
- `computeSupply`: the six worked examples above, plus zero-dose spans (a `5 → 0 → 5` series is three spans with no consumption in the middle, never a gap to skip), no supply events at all, a `today` before the first event, and an expiry preceding the first event. Example 6 (exhaustion then refill) needs its reasoning in the test name for the same reason the red-equality case does — a reader who sees the walk continue past an exhaustion will otherwise read it as a missing `return`.
- `classifySupplyStatus`: all three boundaries explicitly — supply-end equal to the visit date is **red**, equal to visit + 1 is yellow, equal to visit + 14 is yellow, equal to visit + 15 is green. The first of these is the deliberate PRD deviation and is the one most likely to be "corrected" back by a later reader, so it needs the reasoning in its test name.

### Integration tests (deferred slice)

- A recount round-trip through PostgREST with fractional values, asserting the row lands rather than tripping `23514`.
- A dashboard render for a user with two specialists, asserting group order and card states.
- `deriveStatus` over all four dosage/quantity combinations plus the empty-series case, asserting that "no dosage row" and "dosage set to 0" do not collapse onto the same status.

### Manual testing steps

1. Sign in, add two specialists, a medication against each, and a visit for one of them.
2. Open `/dashboard`; confirm grouping, ordering, and the "no visit scheduled" group.
3. Edit the visit date through each of the four positions and reload; confirm green → yellow → red → red.
4. Set a medication's dosage to 0; confirm "Stopped" and no colour.
5. Correct a count to a figure below the projection; confirm the discrepancy in the notice and the shifted supply-end date on the dashboard.
6. Narrow the viewport to 320 px; confirm no horizontal scrolling.

## Performance Considerations

The NFR is one second for 20 medications on a mobile connection. Two queries total (`listMedications` with its embeds, `listVisits`), both already indexed — `medications_user_id_active_idx`, `supply_events_medication_occurred_idx`, `dosage_changes_medication_effective_idx`, `visits_specialist_visit_date_idx` were all created by F-01 for exactly these access patterns. The engine is O(breakpoints) per medication, where breakpoints is the count of supply events plus dosage changes, and each span is one division rather than a loop over days — so a far-future expiry costs the same as a near one. Server-rendering with no island means no hydration cost on the critical path.

## Migration Notes

No migration. No schema change, no `npm run db:types` run, nothing to backfill.

Two behaviour changes land without a data change and should be expected rather than reported as regressions:

- **Out-of-stock now reflects projected quantity.** Medications refilled long ago at a positive dose flip to out-of-stock on `/medications` the first time this deploys. That is the correction, not a fault.
- **`is_expired` moves to the user's zone.** For a user whose stored zone is behind UTC, a medication expiring today may read as not-yet-expired for a few hours longer than before.

Rollback is `git revert` — nothing is written that the previous code cannot read, and the one new row shape (`recount`) is already legal under the F-01 schema and already asserted by `supabase/tests/supply_ledger.test.sql`.

## References

- Research: `context/changes/supply-status-dashboard/research.md`
- Roadmap slice: `context/foundation/roadmap.md` → `### S-04: Supply-status dashboard`
- PRD: `context/foundation/prd.md` → FR-011, US-01, Business Logic, Color status thresholds
- The two-todays rule: `context/changes/manage-medications/plan.md:393-401`, `context/changes/manage-doctor-visits/plan.md:344-350`
- Current-state views deferred here: `context/changes/domain-schema-foundation/plan.md:39`
- The swap point: `src/lib/db/medications.ts:139-143`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The supply engine and the data module

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes at zero errors and zero warnings: `npm run lint`
- [x] 1.3 Production build succeeds: `npm run build`

#### Manual

- [x] 1.4 `/medications` still lists, creates, edits, archives, restores, refills and corrects with no visible regression — b0600ad
- [x] 1.5 A long-stale medication shows 0 on hand and the out-of-stock label — b0600ad
- [x] 1.6 The correction panel pre-fills with the projected figure — b0600ad
- [x] 1.7 "No dosage recorded" and "Not used" are distinguishable on `/medications` — b0600ad
- [x] 1.8 The six worked examples produce the stated dates, examples 5 and 6 walked deliberately — b0600ad

### Phase 2: The dashboard

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes at zero errors and zero warnings: `npm run lint`
- [ ] 2.3 Production build succeeds: `npm run build`
- [ ] 2.4 No hardcoded palette colour in any component (grep returns nothing)

#### Manual

- [ ] 2.5 Groups appear in visit-date order; the visit-less specialist's group is last
- [ ] 2.6 Moving a visit through the four positions drives the badge green → yellow → red → red, equality case included
- [ ] 2.7 An early printed expiry shows the expiry date with the expiry reason
- [ ] 2.8 Dosage 0 shows "Stopped"; zero projected quantity shows "Out of stock"
- [ ] 2.9 No dosage row shows "No dosage recorded", sorts first, shows no date or quantity, links to `/medications`
- [ ] 2.10 The yellow badge renders in amber-700 and `text-warning` resolves to a real class
- [ ] 2.11 Usable at 320 px with no horizontal scrolling
- [ ] 2.12 No `client:*` directive and no hydration script on this page
- [ ] 2.13 `CLAUDE.md` lines 65 and 94 amended in the same commit as the code

### Phase 3: The recount write path

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes at zero errors and zero warnings: `npm run lint`
- [ ] 3.3 Production build succeeds: `npm run build`
- [ ] 3.4 pgTAP passes: `npm run db:reset` then `npm run db:test` — run FIRST, before seeding the manual scenario

#### Manual

- [ ] 3.5 A differing correction writes a consistent `recount` row
- [ ] 3.6 A correction to the projected figure writes no row and returns 200
- [ ] 3.7 A fractional correction succeeds rather than failing `23514`
- [ ] 3.8 A seven-decimal `counted` posted directly to the route stores as the six-place rounding
- [ ] 3.9 The dashboard's supply-end date shifts after the correction
- [ ] 3.10 No `medications.recordSupply.*` line in the Workers log for either successful case

### Close-out

#### Manual

- [ ] C.1 `follow-ups/supply-engine-tests.md` exists and leads with the red-equality case and worked example 5
- [ ] C.2 Landed through a pull request against `master` that closed #5; `master` never fast-forwarded
- [ ] C.3 `roadmap.md` reads `done` for S-04 in both places and `## Done` cites the PR
- [ ] C.4 `change.md` records per-phase session state and anything the plan did not predict
