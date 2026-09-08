<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Supply-status dashboard (S-04)

- **Plan**: `context/changes/supply-status-dashboard/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-06
- **Verdict**: REVISE → **SOUND** after triage (all 8 findings fixed 2026-09-06)
- **Findings**: 2 critical, 4 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | FAIL    |
| Plan Completeness     | WARNING |

## Grounding

14/14 existing paths ✓ (`src/lib/supply.ts`, `src/lib/decimal.ts`, `src/lib/dashboard.ts`, `src/components/dashboard/` correctly absent — this plan creates them), 11/11 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓ (one `## Progress` heading, 3 phases matched, no stray checkboxes outside Progress). `docs/reference/contract-surfaces.md` absent — contract-surface check skipped.

Verified in addition, producing no finding:

- **The caller list in Phase 1 §6 is complete.** A repo-wide sweep found no call site of the seven changed functions outside the six named files — nothing under `tests/`, `scripts/`, or `supabase/`. `MedicationsManager.tsx:21` imports types only. The four `quantity_on_hand` reads in the island are exactly `:218`, `:321`, `:342`, `:515`.
- **The PRD amendment has landed.** `prd.md:45`, `:128` and `:150-152` all read "on or before", so the red-boundary case is no longer a deviation from the PRD.
- **`medications.ts:385-399` is an exact cite**; `:388-389` reads verbatim "an honest recount needs the `projected_quantity` only S-04's consumption engine can supply".
- **The recount CHECKs match the plan's assumptions** (`domain_schema.sql:180-196`): `recount` requires both `counted_quantity` and `projected_quantity` non-null and enforces `quantity_delta = counted_quantity − projected_quantity`; non-recount rows must have both null.
- **The Phase 2 grep criterion passes today** — `grep -rnE "(amber|green|red|yellow)-[0-9]{3}" src/components src/pages src/layouts` returns nothing on the current tree.

## Findings

### F1 — Worked example 2 states the wrong date

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots (testing gaps)
- **Location**: Testing Strategy → worked example 2; Progress gate 1.8
- **Detail**: "+30 on 2026-09-01, +30 on 2026-09-11, dose 1/day … Supply-end is 2026-10-20." It is **2026-10-30**. 60 units at 1/day from 09-01 cover 09-01 through 10-30; the plan's own narrative (holds 50 on 09-11 → 09-11 + 49) also lands on 10-30. Brute-forced against a day-by-day simulation: examples 1, 3 and 4 reproduce exactly (2026-09-30, 2026-09-20, 2026-12-09); only example 2 disagrees. This is not a slip in prose — tests are deferred, so these four examples _are_ the verification suite and Progress 1.8 gates on them. An implementer who trusts the number bends a correct engine to produce it, in exactly the arithmetic the PRD guards hardest.
- **Fix**: Change example 2's expected supply-end from `2026-10-20` to `2026-10-30`.
- **Decision**: FIXED — example 2 corrected to `2026-10-30`, with the last-event-anchor contrast (`2026-11-09`) spelled out so the example still teaches what it was written for.

### F2 — The walk is never bounded by expiry, contradicting the plan's own termination claim

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details vs. Phase 1 §3 walk steps 2–5
- **Detail**: Critical Implementation Details asserts "The walk terminates at `expiry_date` … doing so is what keeps every intermediate quantity bounded." Step 2 never puts `expiryDate` in the breakpoint set and applies no upper bound ("keeping only dates ≥ start"); step 3 meets expiry only as the _final_ span's end. So expiry caps the walk only when the last breakpoint precedes it. With a breakpoint after expiry the walk sails past it:

  > today `2026-09-06`, expiry `2026-09-15`, a dosage row effective `2026-09-20` → breakpoints `[09-01, 09-06, 09-20]`. The span `[09-06, 09-19]` consumes 14 days beyond expiry and can return `supplyEnd = 09-18` — past the cap, over-reporting cover. The next span `[09-20, 09-15]` then has negative length.

  Reachable two ways. **Today**: `occurred_on` is derived in UTC and the plan itself notes it "can be one day ahead of the user's own date", so an expired medication refilled today yields a last breakpoint after `max(today, expiryDate)`. **By design at S-05**: the plan promises future-dated dosage rows are "simply more breakpoints and need no change here" — which is precisely the case that breaks.

- **Fix A ⭐ Recommended**: Bound the breakpoint set, and make expiry one of them. Add `expiryDate` to the breakpoints; set the walk's upper bound to `max(today, expiryDate)`; drop every breakpoint beyond it and clamp the final span's end there. Supply-end is capped at `expiryDate` separately, so the walk still runs on to `today` when expiry is in the past and `projectedQuantity` is unaffected.
  - Strength: Makes the Critical Implementation Details claim true by construction rather than by assumption, and keeps S-05's "more breakpoints, no engine change" promise honest.
  - Tradeoff: Step 5's exit test changes from "the final span ended at expiry" to "passed the expiry breakpoint without exhausting" — a real edit to the spec, not a footnote.
  - Confidence: HIGH — all four worked examples still produce their stated dates under this rule (verified).
  - Blind spot: No worked example exercises a breakpoint after expiry, so the manual gate would not catch a regression here. Add a fifth example.
- **Fix B**: Clamp each span end at the earlier of the next breakpoint and `expiryDate`, stopping the walk there, and compute `projectedQuantity` in a separate short pre-pass to `today`.
  - Strength: The supply-end walk provably cannot pass expiry.
  - Tradeoff: Two passes; surrenders the "one walk answers both questions" property the whole design is built on.
  - Confidence: MED — correct, but it reopens the structure S-05 and S-06 are meant to extend.
- **Decision**: FIXED via Fix A — `expiryDate` added to the breakpoint set, `bound = max(today, expiryDate)` introduced in step 2, breakpoints beyond it dropped, step 5 re-expressed as "passes the `expiryDate` breakpoint". A fifth worked example (breakpoint past the expiry cap) added and named in criterion 1.8.

### F3 — The zero-dose branch never says what supply-end is

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3, walk step 4
- **Detail**: "if `d === 0`, nothing is consumed and the span is covered only while `remaining > 0`." Every other branch names the date it yields — `addDays(b_i, covered − 1)`. This one does not, and `covered` is undefined when `d` is 0, so `remaining === 0` under a zero dose leaves the implementer to invent the answer. It is a live case: the plan names the `5 → 0 → 5` series as the shape to get right, and `CLAUDE.md` → _Domain schema_ says the supply-end date is "undefined, not computed, when dosage is 0". Two readings — the day before the pause versus carrying the previous segment's date forward — differ by a day on the green/yellow boundary.
- **Fix**: State both halves explicitly — under `d === 0` with `remaining > 0` the whole span is covered and nothing is consumed; with `remaining === 0` the walk stops and supply-end is `addDays(b_i, −1)`. Add the exhausted-then-paused case to the deferred unit-test list.
- **Decision**: FIXED (modified) — step 4 split into explicit `d === 0` and `d > 0` branches, with `addDays(b_i, −1)` named for the exhausted-then-paused case. Per triage, the entry was deliberately NOT added to the deferred unit-test list.

### F4 — The 6-decimal clamp has a `23514` path on the recount write

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 (`decimalPlaces` clamp) × Phase 3 §1
- **Detail**: The plan treats the clamp as a precision note — "rounds at the seventh decimal, which is documented rather than guarded" — and separately spends a paragraph warning that a delta disagreeing with Postgres's exact arithmetic fails `supply_events_recount_delta_is_discrepancy` with `23514`. They are the same path. `counted` reaches the database as sent (`counted_quantity numeric`, unbounded scale, `domain_schema.sql:166-168`), while `quantity_delta` comes from `subtractExact`, which rounds at 6 places. A `counted` of `0.1234567` therefore stores exactly but subtracts approximately, and the CHECK rejects the row. The plan's own brief concedes zod "bounds magnitude but not precision", so this is reachable from the API, not hypothetical.
- **Fix A ⭐ Recommended**: Add a decimal-places refinement to `supplyInputSchema`'s `counted` (and `amount`), rejecting more than 6 places as a 400 in the contract's shape.
  - Strength: Puts the guard at the boundary the codebase already uses for hostile input, and turns an unexplained "Could not record the supply change" into a field error the user can act on.
  - Tradeoff: One more validation rule to keep in step with the clamp constant — they must not drift apart.
  - Confidence: HIGH — matches how `MAX_QUANTITY` / `MAX_DAILY_DOSAGE` are already enforced (`validation/medication.ts:29-30`).
  - Blind spot: Rows already written with finer precision, if any exist, are unaffected either way.
- **Fix B**: Round `counted` through the same clamp before insert so all three figures agree by construction.
  - Strength: No schema change; the CHECK can never fail.
  - Tradeoff: Silently alters the number the user counted, and stores a count they did not enter.
  - Confidence: HIGH on mechanics, LOW as a product call for a medication count.
- **Decision**: FIXED via Fix B — `clampScale` added as a fifth export of `src/lib/decimal.ts`; Phase 3 stores `counted_quantity` through it so the column and its delta agree by construction. Cost stated in the plan: the row records the six-place rounding, not the raw input. Verification bullet 3.8 added.

### F5 — No close-out: the deferred-test spec gets no tracked home, and the slice has no landing path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: document-wide — no `## Close-out` section
- **Detail**: Both prior slice plans carry a `## Close-out` section, and both produced `follow-ups/*.md` on disk (`manage-medications/follow-ups/deferred-tests.md`, `manage-doctor-visits/follow-ups/visits-tests.md`). This plan has neither. Three gaps follow:
  1. The brief calls the follow-up test slice "load-bearing, not optional", but nothing creates it. Its specification lives only inside Testing Strategy — and `/10x-archive` moves this folder into `context/archive/`, which the toolkit treats as immutable. The spec gets buried by the act of finishing.
  2. No PR / branch step. `lessons.md` → _Open a pull request for every slice; never fast-forward master_ is marked **Applies to: plan**, and was written after the 2026-08-30 lapse the lesson describes as unrecoverable. This is the first plan written since.
  3. No roadmap or issue close. `roadmap.md:36` still reads `planning` and issue #5 is open; both prior slices left that to hand-fixing, which the same lesson names as a symptom.

  Related, and worth stating here: CI runs only `lint` and `build` (`ci.yml:20-21`) — `npm run typecheck` is **not** enforced (open follow-up `manage-doctor-visits/follow-ups/typecheck-in-ci.md`). So of this slice's three automated gates, one is local-only and none tests behaviour, which sharpens why (1) matters.

- **Fix**: Add a `## Close-out` section in the shape the two prior plans use: create `follow-ups/supply-engine-tests.md` from the Testing Strategy content (leading with the `classifySupplyStatus` equality case and the corrected example 2), land the slice through a pull request against master that closes #5, and flip `roadmap.md:36` to `done` from that PR. Mirror each as a Progress item.
- **Decision**: FIXED — `## Close-out` section added after Phase 3 with four items (follow-up test contract, PR closing #5, roadmap flip, `change.md`), plus the note that CI enforces neither typecheck nor any behavioural test. Mirrored as Progress C.1–C.4.

### F6 — Phase 3's automated `db:reset` wipes the data its own manual steps need

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Success Criteria; Progress 3.4 vs 3.5–3.9
- **Detail**: 3.4 is `npm run db:reset` then `npm run db:test`. 3.5–3.9 then ask for a correction against a real medication, a fractional correction, and a shifted supply-end date on the dashboard — all against fixtures the reset just destroyed. Read top-to-bottom, the phase asks you to rebuild the whole scenario twice.
- **Fix**: Note the ordering in the phase — run 3.4 first on a clean stack, then seed and walk 3.5–3.9 — or move the reset to a pre-phase step.
- **Decision**: FIXED — Phase 3 now states the reset runs first on an empty stack, before seeding; Progress 3.4 carries the same note inline.

### F7 — The safe-integer argument rests on a bound that does not hold

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details → Safe-integer bound
- **Detail**: "`dose × spanLength ≤ remaining ≤ MAX_QUANTITY` — so the scaled product never exceeds `1e11`". `remaining` is the running sum of every event's delta, not one event, and `MAX_QUANTITY` (100_000) bounds a single event. The conclusion survives easily — it takes roughly 9×10⁴ max-size refills to reach `MAX_SAFE_INTEGER` after 10⁶ scaling — but the stated premise is the load-bearing half of a decision to leave this unguarded.
- **Fix**: Restate the bound in terms of the ledger sum, e.g. `remaining ≤ MAX_QUANTITY × eventCount`, and give the headroom explicitly.
- **Decision**: FIXED — bound restated as `remaining ≤ MAX_QUANTITY × eventCount`, with the ~9×10⁴-refill headroom given explicitly and the per-event reading named as the thing that made it look guaranteed.

### F8 — Two document-hygiene slips

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress → Phase 2; Phase 1 §7
- **Detail**: (a) Progress `2.13` ("`CLAUDE.md` lines 65 and 94 amended…") has no matching bullet in Phase 2's Success Criteria — the only Progress item in the document without one, leaving Phase 2 change 5 otherwise unverified. (b) `MedicationsManager.tsx:55-61` is cited for the no-amber-token comment; the docblock is `:56-62` (`:55` is `GENERIC_ERROR`). The other seven cites in that change are exact.
- **Fix**: Add the `CLAUDE.md` amendment as a Manual Verification bullet under Phase 2, and correct the one line cite.
- **Decision**: FIXED — Phase 2 gained the `CLAUDE.md`-amendment Manual Verification bullet matching Progress 2.13; the `MedicationsManager.tsx` cite corrected to `:56-62`.
