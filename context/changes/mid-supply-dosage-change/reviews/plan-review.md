<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Mid-supply Dosage Change (S-05)

- **Plan**: `context/changes/mid-supply-dosage-change/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-12
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 5 critical, 4 warnings, 1 observation — 9 fixed, 1 accepted

## Verdicts

| Dimension             | Verdict | After triage |
| --------------------- | ------- | ------------ |
| End-State Alignment   | WARNING | PASS         |
| Lean Execution        | PASS    | PASS         |
| Architectural Fitness | WARNING | WARNING      |
| Blind Spots           | FAIL    | PASS         |
| Plan Completeness     | WARNING | PASS         |

Architectural Fitness stays WARNING because F5 was accepted rather than fixed.

## Grounding

11/11 paths ✓, 12/12 symbols ✓, brief↔plan ✓, Progress↔Phase structure ✓ (34 rows, all
matched; re-validated at 37 rows after triage) — 1 cited script missing (F2).

## Findings

### F1 — Phase 1's migration breaks the pgTAP suite it promises to leave green

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Success Criteria / "What We're NOT Doing"
- **Detail**: `supabase/tests/constraints.test.sql:26` sets role `authenticated`, and the four
  `dosage_changes` inserts below it use hardcoded past dates — `'2026-03-01'` at `:130` and
  `:133`, `'2026-04-01'` at `:141`, `'2026-05-01'` at `:147`. All four are refused `42501`
  under `effective_date >= current_date`. The insert at `:130` is not wrapped in an assertion,
  so it aborts the transaction and takes every assertion after it. The `:133` and `:147`
  `throws_ok` calls use the four-argument form with a null message and compare only the
  SQLSTATE, so they would fail for the wrong code rather than erroring cleanly. The other three
  suites survive because RLS is not `FORCE`d and their past-dated fixtures sit above their own
  role switch; `tests/integration/` never touches `dosage_changes`, so `npm test` is
  unaffected. Criterion "70 assertions, no regression" cannot pass, and "What We're NOT Doing"
  forbids the fix.
- **Fix**: Move the four fixture dates to `current_date + N`, keeping `:130`/`:133` on one day
  so the `23505` assertion still collides; amend "What We're NOT Doing" to separate writing new
  coverage (deferred) from repairing fixtures the migration invalidates (Phase 1's job).
  - Strength: Keeps the four assertions under RLS, where they earn their keep.
  - Tradeoff: Reopens a scope boundary the plan drew deliberately.
  - Confidence: HIGH — verified by reading the role switch and the four inserts directly.
  - Blind spot: Assertion count after the change is unverified.
- **Decision**: FIXED — added Phase 1 §2 "Repair the pgTAP fixtures this policy invalidates";
  amended the tests bullet in "What We're NOT Doing"; rewrote criterion 1.3; added a note to
  Testing Strategy and Migration Notes.

### F2 — Phase 1's cloud-push gate does not exist in this repo

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — "Apply to cloud"
- **Detail**: The plan states "`scripts/check-migration-drift.mjs` gates the deploy on this; do
  not route around it." `scripts/` contains only `gen-db-types.mjs`, `package.json` declares no
  such script, and `ci.yml` has no such step. It exists only on the unmerged branch
  `ci/migration-drift-check` (`01a79d5`). `lessons.md` → _Confirm every migration reached
  cloud_ makes the same claim, so that lesson's mitigation is currently unbuilt — and the
  lesson records this failing twice in five weeks, once leaving a 500 live in production for
  eight days.
- **Fix**: Land `ci/migration-drift-check` before Phase 1, or restate the step as a purely
  manual `migration list` close-out.
- **Decision**: FIXED via "Land the CI branch first" — added as an explicit Phase 1 §3
  prerequisite, with a new criterion 1.1 and a note in Migration Notes that `lessons.md` is
  ahead of `master` on this point.

### F3 — Phase 1 turns `setDosage`'s compensating restore into a data-loss path

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: "Critical Implementation Details" / Phase 2 §2
- **Detail**: The plan says the UTC-midnight window "is sub-second and it fails closed — no
  corruption". It does not. `setDosage` DELETEs the target row first
  (`medications.ts:405-411`), then INSERTs. If the day rolls between the two, the DELETE has
  already succeeded and the INSERT is refused `42501`; the compensating restore at `:432-440`
  re-inserts at the same now-past date, so it is refused too. The row is destroyed while the
  route answers "nothing changed" — precisely the guarantee the function's header at
  `:385-392` says the chained `.select("daily_dosage")` exists to provide. The loss renders as
  the deliberate "I have stopped taking this" state. Today this is impossible because the
  INSERT policy has no date guard; Phase 1 creates it.
- **Fix A ⭐ Recommended**: Re-resolve the date on the restore path.
  - Strength: Keeps the decision the codebase already made — prevent the loss, don't report it.
  - Tradeoff: The restored row lands a day later, leaving a one-day seam in the series.
  - Confidence: MEDIUM — the mechanism is verified; the seam's rendered effect is reasoned.
  - Blind spot: The client-supplied-date branch must differ and was unspecified.
- **Fix B**: Map a refused restore to its own error kind and tell the user.
  - Strength: Minimal edit, no new control flow.
  - Tradeoff: The medication sits in `no_dosage` until the user re-enters it.
  - Confidence: HIGH — it is the logging pattern already in the file.
- **Decision**: FIXED via Fix A — rewrote the two-clock paragraph in Critical Implementation
  Details, the migration header's two-clock caveat, and Phase 2 §2's restore contract
  (retry once at a freshly-resolved `todayUtc()`, guarded to the server-derived default).

### F4 — The compiler forcing function does not reach the dashboard

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Key Discoveries / Phase 2 — Success Criteria
- **Detail**: The plan claims twice that adding a status variant "breaks the build until every
  surface labels it". Adding `not_started` to `MedicationStatus` (`medications.ts:31`) fails
  exactly two lines: `MedicationsManager.tsx:70` and `:78`. `CardState` (`dashboard.ts:27`) is
  structurally independent of `MedicationStatus`, so `CARD_ORDER` and `SupplyCard.astro`'s two
  maps keep compiling; and `cardStateFor` (`dashboard.ts:60-71`) — the only `switch` over
  `medication.status` in the tree — ends in `default:` with no `never` guard, so an unhandled
  variant falls through to `classifySupplyStatus` silently. Phase 4 is discretionary from the
  compiler's point of view, which is how S-04's defect reached this slice.
- **Fix**: Replace `default:` with explicit `case "active":` / `case "archived":` plus an
  exhaustiveness guard; correct the criterion's wording.
- **Decision**: FIXED — rewrote the Key Discoveries bullet with the verified blast radius,
  rewrote criterion 2.1 and Progress row 2.1, and folded the guard into Phase 4 §1.

### F5 — "Pending" and the date field's floor name different days

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §4 vs Phase 3 §1 and §3
- **Detail**: Phase 2 derives the pending series as `effective_date > today` in the **user's**
  zone; Phase 3 floors and defaults the date field at **UTC** today. West of UTC in the evening
  `utcToday > userToday`, so a medication's own current row — written at `todayUtc` — is
  classified as pending: it appears in the list with a Cancel control, and the field's default
  value collides with it, firing the replace-confirm on an ordinary dosage change. Criterion
  3.5 ("Choosing today still replaces today's dosage with no confirmation dialog") cannot hold
  in those zones. Separately, the plan's justification — "In zones east of UTC late in the
  evening this means the earliest selectable date reads as 'tomorrow'" — is backwards: east of
  UTC the floor reads as _yesterday_; it is west of UTC late in the evening where it reads as
  tomorrow, and only that direction produces the defect.
- **Fix A ⭐ Recommended**: Anchor the whole panel on UTC today; replaceable set becomes
  `>= todayUtc`, with the row at exactly `todayUtc` treated as today's dosage, not pending.
- **Fix B**: Display pending as `> userToday` but run the confirm against `>= utcToday`.
- **Decision**: ACCEPTED — no current user is in an affected zone, and the resolution is the
  same read-path question `follow-ups/timezone-classification.md` (S-04 finding F0b) already
  owns. Recorded in the plan as an explicit accepted risk under Critical Implementation
  Details, cross-referenced from Phase 2 §4. The backwards direction statement **was** corrected.

### F6 — `createMedication`'s swallowed insert failure has no backing phase item

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: "Critical Implementation Details" → Phase 2
- **Detail**: The plan commits to it by name — "`createMedication` logs a failed dosage insert
  and still reports success (`medications.ts:300-305`) … Phase 2 maps the RLS refusal to a
  domain error rather than letting it pass as success" — but none of Phase 2's six change items
  touches `createMedication`, and no success criterion or Progress row covers it. It compounds
  with the deploy shape: Phase 1 pushes the policy to cloud days before the PR merges, so
  production runs S-04's code against the tightened predicate in the meantime.
- **Fix**: Add a Phase 2 item for `createMedication` with a matching criterion and Progress row.
- **Decision**: FIXED — added Phase 2 §7, criterion, and Progress row 2.12.

### F7 — The cancel endpoint also erases today's in-force dosage

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §3 and §6
- **Detail**: The contract is a DELETE on `(medication_id, effective_date)` with no floor, and
  the DELETE policy permits `effective_date >= current_date` — today included. So
  `DELETE /api/medications/<id>/dosage/<today>` removes the dosage currently in force, on a
  route named "cancel a scheduled change". It is also the only in-app path to `not_started`: a
  UI-created medication always carries a row at `todayUtc`, so scheduling a change leaves two
  rows and the status stays `active`. The plan's "S-05's whole purpose is writing one" therefore
  overstates what the slice does.
- **Fix**: Decide explicitly — floor the route at `> todayUtc`, or keep today deletable and say
  so in the route header. Either way correct the Current State reachability claim.
- **Decision**: FIXED via "Keep today deletable" — Phase 2 §3 now records the absent floor as a
  decision, §6's route header must state it, criterion 2.10 exercises it, and the Current State
  Analysis reachability claim is corrected.

### F8 — `not_started` cards discard a classification the engine already computed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 4 §1
- **Detail**: The stated rationale — route `not_started` to its own card state "rather than
  letting it fall through to `classifySupplyStatus`, which would classify a supply nobody is
  consuming yet" — does not hold. Traced through `computeSupply` with 30 on hand and a single
  3/day row effective in seven days: today's dose is 0, the zero-dose branch
  (`supply.ts:159-167`) consumes nothing across the first span, and the walk returns a real
  `supplyEndDate`. The engine has a correct, actionable answer; Phase 4 throws it away and ranks
  the card near `stopped`, so a medication that runs out before the next visit reads neutral —
  the "you have enough" direction the PRD names as a product failure. The precedent does not
  transfer: `not_used` → `stopped` is right because consumption there is zero indefinitely.
- **Fix A ⭐ Recommended**: Let `not_started` fall through to `classifySupplyStatus` like
  `active`; carry "Starts &lt;date&gt;" in the reason line rather than the badge.
  - Strength: The user keeps the signal that says whether to act.
  - Tradeoff: No distinct card state, so the two screens diverge slightly.
  - Confidence: MEDIUM — the engine trace is verified; the badge-vs-colour call is a judgement.
- **Fix B**: Keep the dedicated state but derive its rank from the supply band.
- **Decision**: FIXED via Fix A — Phase 4 §1 is now "Make `cardStateFor` exhaustive" (no new
  `CardState`, `CARD_ORDER` unchanged); Phase 4 §2 leaves `STATE_LABEL`/`STATE_CLASS` untouched
  and moves the wording to the reason ternary; criterion 4.7 now asserts the band survives.

### F9 — Phase 3 reuses two existing pieces that do not do what it needs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §1 and §2
- **Detail**: §1 requires `min` on the date field. `FormField.tsx:7-20` destructures a closed
  prop list and forwards an explicit attribute set to `Input` (`:53-65`) — no `min` prop, no
  rest spread, and `min=` has zero hits app-wide. `src/components/form/FormField.tsx` is not in
  Phase 3's file list. §2 says cancel issues the DELETE "via the existing `applyRow`", but
  `send()` (`MedicationsManager.tsx:199-226`) is typed `"POST" | "PATCH"` and always serialises
  a body; the app's only DELETE precedent is an inline `fetch` in the sibling islands
  (`SpecialistsManager.tsx:172`, `VisitsManager.tsx:258`).
- **Fix**: Name `FormField.tsx` in Phase 3 §1 and add `min?: string`; widen `send()`'s method
  union and make the body optional.
- **Decision**: FIXED — both recorded in Phase 3 §1 and §2 with the evidence.

### F10 — Two second copies, in a codebase built around not having them

- **Severity**: ⓘ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 §1 and §4
- **Detail**: §4 put the soonest pending change on `MedicationView` alongside the array it is
  the head of. §1 exported a factory plus "a today-independent export for the island's
  field-level checks", then gave the island the factory anyway, leaving the second export with
  no consumer.
- **Fix**: Drop the convenience field; keep one schema export unless a second consumer is named.
- **Decision**: FIXED — both reduced to one, with the reasoning recorded inline.

## Triage summary

| Outcome  | Findings                                    |
| -------- | ------------------------------------------- |
| Fixed    | F1, F2, F3 (A), F4, F6, F7, F8 (A), F9, F10 |
| Accepted | F5                                          |

Nine fixed (F10 included), one accepted. Verdict after fixes: **SOUND**, with Architectural
Fitness left at WARNING by the accepted F5.
