<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Supply-status dashboard (S-04)

- **Plan**: `context/changes/supply-status-dashboard/plan.md`
- **Scope**: Full plan — Phases 1, 2 and 3 (all complete)
- **Date**: 2026-09-10
- **Verdict**: NEEDS ATTENTION → **all findings triaged and closed** (post-hoc; see the note below)
- **Findings**: 1 critical, 3 warnings, 3 observations — 5 fixed, 1 deferred to a follow-up, 2 recorded

> **This review ran AFTER the merge and the production deploy**, not before.
> PR [#34](https://github.com/monika-mur/medcalc/pull/34) merged as `d9f7596`
> and deployed to `medcalc.medcalc.workers.dev` before `/10x-impl-review` was
> invoked. The review gate was skipped in the chain, not failed — the developer
> caught the omission immediately afterwards and asked for the review anyway.
> Everything below is therefore post-hoc: nothing here blocked a merge, and each
> finding is triaged as fix-forward, follow-up, or accept. Rollback remains cheap
> (`git revert`, no migration), so a severe finding is still actionable.
>
> **Two findings did reach that bar** (F0a, F0b — the second downgraded to
> WARNING during triage, for reasons recorded on the finding). Both are reachable
> only in circumstances the manual walk could not produce from this machine — a
> raw request carrying a sub-scale dosage, and a user in a zone west of UTC while
> UTC is a day ahead — which is why a green CI run, a full manual browser walk and
> a merged PR all passed over them. Neither is a plan-adherence failure: the plan
> does not specify either behaviour, and the implementation follows what it does
> specify. They are gaps the plan did not anticipate, found by reading the code
> rather than by running it. **This is the concrete answer to "was there any point
> reviewing after the merge?"**
>
> The **Safety & Quality — FAIL** verdict below records the state the review
> found, not the state the code is in now: F0a is fixed, F0b is deferred with its
> reasoning, and the remaining findings are fixed or recorded. Triage is complete
> and no finding is left PENDING.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

**Plan Adherence — PASS.** All three phases MATCH on every planned change. No
MISSING items. Every walk step (1–8) verified against the code line by line,
including the three that carry the plan's own warnings: the bounded breakpoint
set (`supply.ts:108`), the absence of any `return` inside the walk loop
(first `return` after the loop is `:199`), and ties resolving to `"consumption"`
(`:198` tests `>` not `>=`).

**Scope Discipline — PASS.** All eight "What We're NOT Doing" guardrails hold:
no tests, no CI change by this slice, no Postgres view, no future-dated dosage
UI, no liquid-column involvement, no new date dependency, threshold hardcoded at
`supply.ts:230`, no `client:*` in the dashboard tree, no consumption event type.

**Success Criteria — PASS.** All automated criteria re-run independently during
this review: `typecheck` 0 errors / 0 warnings, `lint` exit 0, `build` exit 0
(dev server stopped first), pgTAP 70/70, the 2.4 palette grep returns nothing,
`.text-warning{color:var(--warning)}` is present in the built CSS, and
`git show --stat 4bf166f` lists `CLAUDE.md` alongside the dashboard code
(criterion 2.13's evidence).

## Findings

### F0a — A dosage below `5e-7` divides by zero in `floorDivide`, producing either a false "lasts until expiry" or a literal `"0NaN-NaN-NaN"` supply-end date

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/decimal.ts:58-61`, call site `src/lib/supply.ts:169`, root cause `src/lib/validation/medication.ts:39-42`
- **Detail**:
  `floorDivide` computes `Math.floor(Math.round(a * factor) / Math.round(b * factor))`
  with `factor` capped at `10^6`. For any `0 < b < 5e-7`, `Math.round(b * factor)`
  is **0**. The docstring's contract — "callers guarantee `b > 0`" — is satisfied
  by every call site; the contract is simply the wrong one. What the function
  needs is `Math.round(b * factorFor(a,b)) !== 0`.

  `dailyDosageField` bounds magnitude (`.min(0).max(1000)`) but not precision, so
  `POST /api/medications/{id}/dosage` with `{"daily_dosage": 0.0000004}` is
  accepted end-to-end. Each link verified independently during this review:

  ```
  z.number().min(0).max(1000).safeParse(4e-7)  -> ACCEPTED
  Postgres:  select 0.0000004::numeric         -> returns 4e-07 (exponential)
  decimalPlaces(4e-7)                          -> 6   (exponential -> MAX_SCALE)
  Math.round(4e-7 * 1e6)                       -> 0   (divisor is zero)
  floorDivide(10, 4e-7)                        -> Infinity
  floorDivide(0,  4e-7)                        -> NaN
  fromEpochDay(NaN)                            -> "0NaN-NaN-NaN"
  ```

  Two distinct failures follow:
  1. **`remaining > 0`** → `covered = Infinity`, so `Infinity >= spanLength` is
     true and the "fully covered" branch runs. `multiplyExact(4e-7, days)` also
     scales to 0, so `remaining` never decrements, the walk ends unexhausted, and
     the post-walk cap reports **`"expiry"`** — a "you have enough until the
     printed expiry" answer produced by dividing by zero. **This is the
     over-report class the PRD names as a product failure**, and the one direction
     the plan's own worked example 5 exists to guard.
  2. **`remaining === 0`** → `covered = NaN`, `NaN >= spanLength` is false, so
     `addDays(at, NaN - 1)` runs. `addDays` validates its _date_ argument but not
     its _days_ argument, so `fromEpochDay(NaN)` returns the string
     `"0NaN-NaN-NaN"`, which is returned as `supplyEndDate`, compares
     lexicographically as `<= "2026-10-01"` (landing in `red` by accident), and is
     rendered verbatim into `<time datetime="0NaN-NaN-NaN">` at `SupplyCard.astro:79-81`.

  Reachable only by raw request — the same vector criterion 3.8 already
  legitimises — not through the UI. But `dates.ts:88-94` states that the throw
  exists precisely so "a silent `NaN` would propagate into a supply-end date
  instead of stopping"; the guard was placed on the date argument and not the
  offset, so the stated intent is not achieved.

- **Fix A ⭐ Recommended**: Defend at both ends — add a precision floor to `dailyDosageField` (a dosage that rounds to zero at `10^6` cannot be stored), and make `floorDivide` throw a `RangeError` when the scaled divisor is 0 rather than returning `Infinity`/`NaN`. Also reject a non-finite `days` in `addDays`.
  - Strength: The validation floor closes the reachable path; the two assertions
    convert any _future_ route to this code from a silently wrong number into a
    loud failure, which is the discipline `toEpochDay` already sets one function
    away.
  - Tradeoff: Three files rather than one, and a dosage below 0.000001/day
    becomes a 400. No clinical dosage is in that range.
  - Confidence: HIGH — every link verified against the live stack and the real
    schema, not reasoned about.
  - Blind spot: Any dosage row already stored below the floor keeps its value;
    the engine assertion would then throw on read rather than over-report. That
    is the intended direction, but it turns a bad row into a 500 until corrected.
- **Fix B**: Validation floor only, leaving `floorDivide` and `addDays` permissive.
  - Strength: One-line change, closes the only reachable path today.
  - Tradeoff: Leaves the trap armed for the next caller — S-05 extends this
    engine and will add dosage write paths of its own.
  - Confidence: MEDIUM — correct for today, silent for tomorrow.
  - Blind spot: Whether S-05's future-dated dosage UI reuses this schema.
- **Decision**: FIXED via Fix A — precision floor `MIN_NONZERO_DOSAGE` on `dailyDosageField`, `floorDivide` throws on a zero scaled divisor, `addDays` rejects a non-finite offset. Verified: 0/0.25/0.000001/1000 still accepted, 4e-7 rejected, `0.9/0.3` still 3.

### F0b — A medication created or refilled while UTC is a day ahead reads "Stopped / 0 on hand" for zones west of UTC

- **Severity**: ⚠️ WARNING — _downgraded from the CRITICAL first proposed; see "On the severity" below_
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `src/lib/db/medications.ts:317` (create), `:437` (setDosage), `:475` and `:537` (recordSupply)
- **Detail**:
  Writes are stamped `todayUtc()` — correct, and required, because the RLS
  policies compare `effective_date` and `occurred_on` against Postgres
  `current_date`, which this review confirmed is UTC:

  ```
  select current_date, current_timestamp at time zone 'UTC';
   2026-09-10 | 2026-09-10 16:57:25
  ```

  But the `MedicationView` returned to the caller is folded against the **user's**
  `today`. For a user in UTC−8 after 16:00 local, that is one calendar day
  _earlier_ than the row just written, so the row is in the future relative to its
  own classification date. `doseInForce` skips it (`effective_date > at` →
  `continue`, `supply.ts:58`) and returns 0; `deriveStatus` then sees
  `dosageCount === 1` with `currentDosage === 0` and reports **`not_used`**.

  Effect: a user who creates "30 tablets, 2/day" immediately sees the row labelled
  **"Not used"** with **0 on hand**, and the dashboard renders "Dosage is set to 0,
  so nothing is being consumed." The app states as fact something the user did not
  do, on their first interaction.

  The refill path is worse for being plausible rather than obviously broken: the
  walk excludes the just-written refill event, so the success notice reports the
  **pre-refill** figure — the user is told they have fewer tablets immediately
  after adding them.

  **This is not the sanctioned two-todays divergence.** `CLAUDE.md` → _Dates_
  permits two todays differing by a day for _classification vs. policy-compared
  writes_, and is explicit that the divergence must not be reconciled by routing
  writes through the user's zone. It does not sanction classifying a row against a
  date **earlier than that row's own write stamp**. The engine is right and the
  write stamp is right; the pairing of the two is what is wrong.

  **The window, measured rather than assumed.** It is when UTC has ticked over to
  tomorrow and the user's zone has not — so it sits in UTC's _early morning_, not
  the user's evening as this finding was first written up:

  | Zone                  | In-window UTC hours |
  | --------------------- | ------------------- |
  | `America/New_York`    | 00:00 – 04:00       |
  | `America/Los_Angeles` | 00:00 – 07:00       |
  | `Pacific/Honolulu`    | 00:00 – 10:00       |
  | `Etc/GMT+12`          | 00:00 – 12:00       |

  Every zone **at or east of UTC — Europe/Warsaw included — is never affected**,
  which is why no manual walk from this machine could have surfaced it, and why
  reproducing it on demand needs a test account's stored `timezone` changed
  rather than a wait.

  **On the severity — downgraded from CRITICAL to WARNING.** The sub-agent that
  surfaced this rated it CRITICAL. That overstates it on three counts, each
  checked before downgrading:
  1. **It under-reports, never over-reports.** The user is told they have _less_
     than they do. F0a's failure is the opposite and is the one the PRD's
     guardrail names; this one is not that class.
  2. **The exposure is narrow.** Zones west of UTC only, for part of the UTC day.
     The current userbase is the developer, in Warsaw, permanently outside the
     window.
  3. **The proposed fix is partial, and calling it CRITICAL invites shipping a
     partial fix under pressure.** `max(today, written)` corrects the response to
     the write; the next page load still classifies against the user's `today`,
     so the row reverts until UTC catches up. It converts a persistent wrong
     state into a transient one — a real improvement, not a cure.

  The honest resolution is a dedicated timezone slice that revisits the
  classification date itself, not a four-line patch applied during a review.

- **Fix ⭐**: At each of the four mutation returns, fold against `max(today, written)` rather than raw `today` — e.g. `readMedication(client, id, today > written ? today : written)`.
  - Strength: Preserves the deliberate UTC write stamp and the deliberate
    user-zone classification everywhere else, and establishes the missing
    invariant in one place: _a view never classifies against a date earlier than
    the row it just wrote_. Both dates are `YYYY-MM-DD`, so `max` is a string
    comparison — no `Date` enters the path.
  - Tradeoff: A fifth concept ("the view's date") joins the two todays, and it
    needs a comment or the next reader will "simplify" it back.
  - Confidence: HIGH — mechanism verified line by line; the fix touches only the
    four return sites and changes nothing for users at or east of UTC.
  - Blind spot: `listMedications` on a subsequent page load still classifies
    against the user's `today`, so the row reverts to "Stopped" until UTC
    catches up. Fully closing that needs the classification date itself
    reconsidered — larger than this fix, and worth its own decision.
- **Decision**: FOLLOW-UP ONLY — no code change, 2026-09-10. Recorded in
  `follow-ups/timezone-classification.md` for a dedicated slice. Chosen over the
  partial fix deliberately: `max(today, written)` would half-touch the
  two-todays rule `CLAUDE.md` is emphatic about while leaving the page-load path
  wrong, and a design decision about which date classifies a row is not one to
  take under review pressure. The developer declined a reproduction walk and
  decided on the analysis.

### F1 — The refill and create paths write `quantity_delta` unclamped, reopening the `23514` class Phase 3 closed for corrections

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/db/medications.ts:466` (refill), `src/lib/db/medications.ts:309` (create)
- **Detail**:
  Phase 3 change 1 clamps `counted` through `clampScale` before storing it, and
  the plan devotes a full paragraph to why: `counted_quantity` is `numeric` with
  unbounded scale, `subtractExact` works at six places, and a value stored raw
  makes the column and the delta disagree at the seventh decimal — which
  Postgres, comparing in exact `numeric`, answers with `23514`.

  The **refill** path does not do this. `:466` inserts `quantity_delta: input.amount`
  raw. The **create** path is the same at `:309` (`quantity_delta: input.quantity`).
  Zod bounds magnitude, not precision (`validation/medication.ts:49-52`), so
  `{"kind":"refill","amount":2.0000005}` is a body the route accepts.

  The consequence is not in the refill itself — it lands fine. It is that the
  engine's `projectedQuantity` then carries seven decimals, and the **next
  correction** on that medication computes its delta through `subtractExact` at
  `10^6` against a 7-dp projection. Verified against the live local database:

  ```
  select (1.000001::numeric - 2.0000005::numeric) = (-1)::numeric;
   ?column?
  ----------
   f
  ```

  Postgres computes `-0.9999995`; the JS path sends `-1`; the CHECK rejects the
  row with `23514`, surfacing as an unexplained "Could not record the supply
  change" — the exact failure shape Phase 3 exists to prevent, reached by a
  different door.

  Not reachable through the UI (`<input type="number">` will not realistically
  produce seven decimals), but reachable by raw request — which is the same
  vector the plan itself legitimises and tests in criterion 3.8. Phase 3 closed
  the front door and left the side door open.

- **Fix A ⭐ Recommended**: Clamp at both write sites — `quantity_delta: clampScale(input.amount)` at `:466` and `clampScale(input.quantity)` at `:309`.
  - Strength: Two-line change, uses the helper already imported in this file, and
    makes the ledger uniformly ≤6 dp so every projection derived from it is too.
    Matches the reasoning the plan already wrote for `counted`.
  - Tradeoff: Same honesty cost the plan already accepted for corrections — a
    7-dp refill records the six-place rounding. Three orders of magnitude past
    anything dispensable.
  - Confidence: HIGH — verified the failure against the live CHECK; the fix is
    the identical pattern applied one function up.
  - Blind spot: Existing rows written before the fix keep their precision. A
    correction against one of those still fails until it is corrected once.
- **Fix B**: Bound decimal places in zod instead, rejecting a >6-dp body with a 400.
  - Strength: Refuses bad precision at the boundary rather than silently
    rounding, so the caller learns their value was not stored verbatim.
  - Tradeoff: Changes the route's accepted contract — a body that currently
    succeeds would start returning 400. The plan explicitly chose rounding over
    rejection for `counted` ("no input the route previously accepted now 400s"),
    so this diverges from a decision already taken.
  - Confidence: MEDIUM — correct in isolation, but inconsistent with the
    sibling path unless `counted` is changed to match.
  - Blind spot: Whether any caller depends on the current permissiveness.
- **Decision**: FIXED via Fix A — `clampScale` applied at `medications.ts:310` (create) and `:475` (refill), 2026-09-10.

### F2 — Two artifacts written today state that CI does not enforce `typecheck`; it has since 2026-09-06

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `context/changes/supply-status-dashboard/follow-ups/supply-engine-tests.md:251-256`, `context/changes/supply-status-dashboard/change.md:305-308`
- **Detail**:
  Both passages read "`npm run typecheck` is a named script but is not enforced
  — see the open follow-up `manage-doctor-visits/follow-ups/typecheck-in-ci.md`",
  and conclude that "one of this slice's three automated criteria never runs in
  CI".

  That was true when `plan.md` was written and is no longer true.
  `.github/workflows/ci.yml:28` runs `npm run typecheck` between `lint` and
  `build`, added in `668b675` on **2026-09-06** — four days before PR #34. The
  referenced follow-up is not open: its first line reads
  "**Status**: ✅ **RESOLVED 2026-09-06**".

  So PR #34's green check did include typecheck. The claim understates what CI
  proved and points a future reader at a closed follow-up as though it were
  outstanding. The substantive point behind the passage survives — CI still runs
  no test of behaviour, and this slice ships none — but the specific mechanism
  cited is wrong.

  `plan.md:400` carries the same stale claim. It is deliberately **not** included
  in the fix: the plan is a completed contract that was accurate when written,
  and rewriting it retroactively would misrepresent what was known at planning
  time. The two live documents are what a future reader will treat as current.

- **Fix**: Correct both passages to say CI runs `lint`, `typecheck` and `build`, and that what it still does not run is any test of behaviour. Drop the reference to the resolved follow-up.
- **Decision**: FIXED — corrected in `follow-ups/supply-engine-tests.md`, `change.md` and (at the developer's direction) `plan.md`, the last carrying a visible amendment note rather than a silent rewrite.

### F3 — `quantityOnHand` sums the ledger with raw `+` rather than `addExact`

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/db/medications.ts:177`
- **Detail**:
  `supply_events.reduce((sum, event) => sum + event.quantity_delta, 0)` uses raw
  float addition over values that came from `numeric` columns, so a ledger of
  `0.1` and `0.2` yields `0.30000000000000004`. This is the same class as the
  display-path defect found during Phase 3 manual verification, and the same
  class `src/lib/decimal.ts` exists to remove.

  Severity is only OBSERVATION because the blast radius is now small:
  `quantity_on_hand` is **not rendered anywhere** (grep over `src/components`
  and `src/pages` returns nothing) — Phase 1 change 7 moved every display and
  the correction pre-fill to `projected_quantity`. It survives on
  `MedicationView` because the create and refill paths still reason in ledger
  terms, and it is serialised into the API JSON.

  It is worth fixing not for today's behaviour but because it is a loaded gun for
  the next reader: the field is public on the view, and the first surface to
  render it inherits the float.

- **Fix**: `supply_events.reduce((sum, event) => addExact(sum, event.quantity_delta), 0)` — `addExact` is already exported and already imported in this file's dependency graph.
- **Decision**: FIXED — `medications.ts:177` now reduces with `addExact`.

### F4 — The plan states the engine is O(breakpoints); it is O(breakpoints × events)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/supply.ts:120`, described at `plan.md:452`
- **Detail**:
  The walk re-scans the full `events` array at every breakpoint
  (`for (const event of events) if (event.occurred_on === at)`), so the cost is
  breakpoints × events. Since breakpoints ≈ events + dosages, that is quadratic
  in the ledger length, not linear as _Performance Considerations_ states.

  Irrelevant at the PRD's volume — 20 medications with a handful of events each
  — and the NFR conclusion ("a far-future expiry costs the same as a near one")
  still holds, because iterations are bounded by the breakpoint count and never
  by a day count. That was the property worth protecting and it is intact.

  Recorded so the claim is not carried forward as fact into S-05, which extends
  this engine and may add breakpoints per medication.

- **Fix**: No code change. Note the real complexity in `follow-ups/supply-engine-tests.md` so S-05 inherits an accurate figure; bucketing events by date would make it linear if a future volume ever justifies it.
- **Decision**: RECORDED — real complexity noted in `follow-ups/supply-engine-tests.md` so S-05 inherits the accurate figure. No code change.

### F5 — `addDays` rejects well-formed but non-existent dates, which is stricter than the plan specified

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/dates.ts:108-121`
- **Detail**:
  The plan's contract says both primitives "throw on a string that is not a valid
  `YYYY-MM-DD`". The implementation adds a round-trip check that also rejects
  `2026-02-30` — syntactically well-formed, calendrically non-existent.

  This is a strengthening, not drift, and it is the right call: every caller
  passes either a `z.iso.date()`-gated value or a `resolveToday` output, so the
  throw is a programming-error signal exactly as the plan intended. Recorded only
  so a future reader does not mistake the extra guard for an accident and remove
  it.

- **Fix**: None. Documented here.
- **Decision**: RECORDED — asserted in `follow-ups/supply-engine-tests.md` alongside the new non-finite-offset guard, so neither is removed as accidental. No code change.
