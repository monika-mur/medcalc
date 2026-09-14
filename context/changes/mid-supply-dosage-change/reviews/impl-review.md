<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Mid-supply Dosage Change (S-05)

- **Plan**: context/changes/mid-supply-dosage-change/plan.md
- **Scope**: Full plan (Phases 1-4)
- **Date**: 2026-09-13 · triaged 2026-09-14 · verified 2026-09-14
- **Verdict**: REJECTED → **APPROVED**
- **Findings**: 3 critical, 6 warnings, 4 observations — all 13 triaged: 9 fixed, 4 accepted

## Verdicts

Left column as first written; right column after triage.

| Dimension           | At review | After triage                      |
| ------------------- | --------- | --------------------------------- |
| Plan Adherence      | WARNING   | PASS — F4, F5 fixed               |
| Scope Discipline    | PASS      | PASS                              |
| Safety & Quality    | FAIL      | PASS — F1, F2, F3, F6, F7 fixed   |
| Architecture        | PASS      | PASS                              |
| Pattern Consistency | WARNING   | PASS — F8, F9 fixed               |
| Success Criteria    | PASS      | PASS — `db:test` and manual re-walk both green |

## Post-triage verification (2026-09-14)

The one item left open after triage has been closed:

- **Docker Desktop started, local stack brought up, `npm run db:reset` applied all four
  migrations cleanly** (including `20260912210543_guard_dosage_effective_date_on_insert.sql`).
- **`npm run db:test` — 70/70, `Files=4, Tests=70`, `Result: PASS`.** Same count as `master`,
  confirming F7's literal swap in `supabase/tests/rls.test.sql` added no assertion and the
  `dosage_changes: A cannot insert a row owned by B` case still passes inside a fully green
  file — isolated to ownership alone, per F7's fix.
- App started (`npm run dev`) against the freshly reset local stack and confirmed responding.
- **Manual steps 3.5 and 4.7 re-walked by the user against the F6/F9 code and reported
  passing.** 3.5: choosing today — both untouched and explicitly re-picked — submits with no
  replace-confirmation dialog. 4.7: a not-started medication reads "Starts &lt;date&gt;" (never
  "Not used"/"Dosage is set to 0"), reachable through the panel's cancel-today's-row path, and
  a not-started medication seeded to run out before its next visit keeps an actionable
  "Order now" band rather than falling to a neutral state.

No outstanding items remain. Nothing else in the gate needs re-running — `typecheck`, `lint`,
and `build` were already re-verified green during triage and no further code changed since.

## Success criteria verification (re-run, not trusted from Progress checkboxes)

- `npm run typecheck` — 0 errors, 0 warnings
- `npm run lint` — 0 errors, 0 warnings
- `npm run build` — succeeds (dev server stopped first, restarted after)
- `npm run db:test` — 70/70, `plan(18)` unchanged vs `master`
- Cloud migration state: confirmed earlier in-session (`20260912210543` present in the remote
  column); could not be re-confirmed at review time (`supabase migration list` returned 401,
  CLI session expired — environment state, not a code finding). `scripts/check-migration-drift.mjs`
  confirmed present and wired ahead of the deploy step in `.github/workflows/ci.yml`.
- Scope guardrails from "What We're NOT Doing": `src/lib/supply.ts` unchanged, `src/db/database.types.ts`
  unchanged, no new test files — all verified via `git diff --name-only master...HEAD`.
- Merge readiness: master has not moved (0 commits behind), branch is 7 commits ahead, working
  tree clean, branch not yet pushed to origin.

## Findings

### F1 — The restore-retry guard disables itself for the exact case it exists to protect

- **Severity**: CRITICAL
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/db/medications.ts:530,578; src/components/medications/MedicationsManager.tsx:412
- **Detail**: `serverDerived = effectiveDate === undefined` is meant to distinguish "the caller
  asked for a specific day" from "today, whichever day that turns out to be", and the
  two-clock restore-retry is deliberately restricted to the latter. But the island never
  sends `undefined` for "whichever day today turns out to be" — it sends `undefined` only
  when `dosageDate === utcToday`, and `utcToday` is a prop frozen at page render
  (`MedicationsManager.tsx:412`). A page left open across UTC midnight submits an ordinary,
  untouched dosage save as an _explicit_ stale date once the clock turns. `serverDerived` is
  then `false`, the retry does not fire, and the value the DELETE just removed is destroyed
  while the response is a 400 saying "check the highlighted fields".
- **Fix**: Drop the `serverDerived` condition from the retry guard — gate on
  `restoreError.code === RLS_VIOLATION && retryDate !== written` only. Restoring the value the
  DELETE captured is never "silently relocating the caller's request": the caller never asked
  for that specific row to move, and the alternative destroys data for a case the code's own
  comment already claims to guard against.
  - Confidence: HIGH — traced the exact call path from `requestDosage` through `setDosage`.
  - Blind spot: A user who deliberately re-types today's now-stale date is indistinguishable
    from one who never touched the field; both should get the retry, and this fix gives both
    of them that, which is correct either way.
- **Decision**: FIXED — `serverDerived` dropped from the retry guard and removed as an unused
  binding; the function header and the inline comment that both asserted the server-derived
  rule were rewritten to record why the gate is gone.

### F2 — The restore retry can itself collide and destroy the value with no further compensation

- **Severity**: CRITICAL
- **Impact**: HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/db/medications.ts:577-584
- **Detail**: The retry inserts at `retryDate` without clearing that slot first.
  `unique (medication_id, effective_date)` means a pre-existing row at the new UTC today
  (plausible — the whole flow this serves is "replace today's dosage") makes the retry raise
  `23505`, logged and then dropped with no further attempt. The primary path is
  DELETE-then-INSERT specifically to make this unreachable; the retry the plan added does not
  carry that shape forward.
- **Fix**: DELETE-then-INSERT the retry too, mirroring the primary path.
  - Confidence: HIGH — `unique (medication_id, effective_date)` is asserted directly in the
    schema; the collision is not hypothetical.
  - Blind spot: None significant.
- **Decision**: FIXED DIFFERENTLY — the proposed fix was rejected during triage as harmful. A
  row occupying `retryDate` is one that has just become effective today, typically a change
  this slice scheduled; DELETE-then-INSERT would destroy it and write the stale
  `previous.daily_dosage` over it, which is the exact loss the retry exists to prevent. The
  primary path may clear its slot because the caller explicitly asked to replace that date —
  the retry carries no such mandate. Resolved instead by recognising the collision as a benign
  terminal state: a `23505` on the retry means a dosage IS in force, so there is nothing left
  to restore. Added a `UNIQUE_VIOLATION` constant and branched the retry's log so the benign
  case is no longer reported as a failure; the unrecovered row at `written` remains the
  one-day seam the function header already documents. No DELETE added.

### F3 — `createMedication`'s refusal-mapping silently drops the starting quantity too

- **Severity**: CRITICAL
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/db/medications.ts:387-402; src/pages/api/medications/index.ts:63-71
- **Detail**: `createMedication` returns early the moment the dosage insert is refused `42501`
  — the supply-events insert (`:408-419`) never runs. `supply_events_insert_own` carries no
  date predicate at all (confirmed: `20260821182457:140` is ownership-only), so that insert
  would have succeeded had it been attempted. The route's error message names only the
  dosage ("Set the dosage from the list") while the starting quantity is silently gone too,
  with nothing in the UI ever saying so.
- **Fix**: Let the supply-events insert run before returning `date_not_allowed`, and widen the
  message to cover both figures if either failed.
  - Confidence: HIGH — confirmed the policy has no date predicate and confirmed the early
    return precedes the quantity insert in source order.
  - Blind spot: None significant.
- **Decision**: FIXED — the refusal is now recorded in a `dosageRefused` flag and returned
  after the supply-events block instead of before it, so the starting quantity is written on
  the path that loses the dosage. The route's message needed no widening: with the quantity
  saved, "The medication was saved but its dosage was not" became accurate rather than
  half-true. Comment added explaining that only `dosage_changes` is date-guarded and why the
  return is deferred.

### F4 — `plan.md` still specifies a `replaced` return value that was deliberately dropped

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/mid-supply-dosage-change/plan.md:410-411
- **Detail**: Phase 2 §2 says `setDosage` should "return whether the DELETE removed anything,
  so the caller can distinguish 'scheduled' from 'replaced'". Never implemented — a deliberate,
  discussed decision (the same "no second copy without a consumer" reasoning the plan applies
  elsewhere via F10) — but the plan text was never amended, so it now disagrees with the code
  with no recorded reason.
- **Fix**: Amend Phase 2 §2 to state the decision: the island already distinguishes
  scheduled-vs-immediate from `effectiveDate !== undefined`, and the replace case is already
  gated behind an explicit confirm naming both values — a server-side flag would have no
  consumer.
- **Decision**: FIXED — Phase 2 §2 now records the drop as a deliberate decision with its
  reasoning, rather than specifying a return value the code does not have.

### F5 — `plan.md`'s `not_started` contract describes the narrow, superseded trigger

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/mid-supply-dosage-change/plan.md:440-445
- **Detail**: The plan describes the trigger as "every row is future-dated" vs "a row in force
  says 0". The shipped code (`medications.ts:214`) is deliberately broader —
  `currentDosage === 0 && hasNonzeroPending` — found during manual testing (4.7, the Metypred
  repro) and recorded in `change.md`, but the plan's contract text for this exact behavior was
  never updated. This slice ships no automated tests, so the plan's prose is the only written
  specification a future test-writer has, and it currently names the wrong rule.
- **Fix**: Replace Phase 2 §4's contract paragraph with the value-gated rule that shipped,
  cross-referencing `change.md`'s session-log entry.
- **Decision**: FIXED — Phase 2 §4 now states the shipped `currentDosage === 0 &&
hasNonzeroPending` rule, why value-gating (not shape-gating) is load-bearing, the 4.7 repro
  that forced it, the consequence for consumers naming the start date, and that the paragraph
  is the specification the deferred test slice inherits.

### F6 — The pending-changes date field infers "untouched" from a stale render-time prop

- **Severity**: WARNING
- **Impact**: HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/components/medications/MedicationsManager.tsx:412
- **Detail**: Same root cause as F1, different symptom. On a page left open across UTC
  midnight, every subsequent _ordinary_ dosage save (field never touched) sends an explicit
  stale date and gets refused with a 400, until the user reloads.
- **Fix**: Track a "date field touched" boolean alongside `dosageDate`, and pass
  `effective_date: undefined` whenever it is `false`, regardless of what `dosageDate` equals.
  This also makes F1's server-side fix land correctly, since the server then genuinely never
  sees a stale date on an untouched field.
  - Confidence: HIGH — the comparison is literally string equality against a prop that is
    never refreshed after mount.
  - Blind spot: None significant.
- **Decision**: FIXED — added `dosageDateTouched`, reset to `false` each time the dosage panel
  opens and set by the field's own `onChange`. Triage found the symptom understated: `utcToday`
  is the zod floor as well as the seed, so a stale seeded value sits _below its own floor_ and
  an ordinary dosage change failed client-side with a field error on a date the user never
  chose — it never reached the 400. The untouched field is therefore parsed as no date at all,
  not merely sent as none. The `=== utcToday` comparison is kept but now only decides the case
  where the user deliberately picked today. `submitDosage`'s doc comment, which justified
  omitting the date by F1's now-removed server-derived gate, was rewritten around a reason that
  does not depend on the server's internals.

### F7 — `rls.test.sql`'s ownership assertion now passes for two reasons, not one

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/rls.test.sql:199-204
- **Detail**: The `throws_ok(..., '42501', ...)` asserting "A cannot insert a row owned by B"
  inserts at hardcoded `'2026-06-01'` — now a past date. The assertion still passes, but for
  either of two independent reasons (wrong owner, or past date), so a regression that broke
  ownership-checking specifically would not be caught — the past-date refusal would mask it.
- **Fix**: Move `'2026-06-01'` to `current_date + 1`, isolating the assertion to ownership alone.
- **Decision**: FIXED — **not verified by a run.** The literal is now `current_date + 1`, with a
  comment recording why a past-dated literal makes the assertion pass for two reasons since
  S-05 tightened the INSERT policy. Docker Desktop was not running at triage time, so the local
  stack was down and `npm run db:test` could not execute. The change is a single literal swap
  inside an existing `throws_ok` and adds no assertion, so the plan count is unchanged — but
  that is reasoning, not a green suite. **Run `npm run db:reset && npm run db:test` before
  merging.**

### F8 — The date-segment path validation duplicates a pattern already centralised once

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/medications/[id]/dosage/[date].ts:48
- **Detail**: `src/lib/api/params.ts`'s own header states its purpose: "every id-addressed
  route in the app needs it" (referring to `readId`). This route validates a date segment
  inline instead of adding a sibling `readDateParam`. Note `src/pages/api/visits/[id].ts`
  already carries its own inline duplicate of `readId` predating this slice, so this is the
  third instance of the same shape.
- **Fix**: Add `readDateParam(params)` to `src/lib/api/params.ts` beside `readId`, and use it here.
- **Decision**: FIXED — `readDateParam` added beside `readId`, and the route now calls it; the
  route's local `zod` import is gone with its last use. The parser's doc comment carries the
  404-not-400 reasoning that had been inline, and records that it deliberately applies no date
  floor: a route addressing an existing row by date must accept past dates, or an effective row
  becomes unaddressable and 404s for the wrong reason.

### F9 — "First nonzero pending change" is computed independently in three places

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/db/medications.ts:282; src/components/dashboard/SupplyCard.astro:74; src/components/medications/MedicationsManager.tsx:696-705
- **Detail**: `deriveStatus`'s trigger, the dashboard reason line, and the medications-list
  label all independently derive "the first pending row that isn't 0/day" — the exact class
  of duplication `nextVisitFor` (`dashboard.ts:38-45`) exists to prevent, per its own comment:
  "Defining it twice is how they end up disagreeing about one row." Here it is defined three times.
- **Fix**: Export one `nextNonzeroPendingChange(pending)` helper and call it from all three sites.
- **Decision**: FIXED — `nextNonzeroPendingChange` exported from `@/lib/db/medications` beside
  the `MedicationView` type it reads, and called from all three sites; `deriveStatus`'s trigger
  becomes `nextNonzeroPendingChange(pendingChanges) !== undefined`, so the boolean and the two
  labels can no longer disagree about a row. The three long comments explaining the zero-skip
  collapse into one on the helper, cross-referencing the plan's Phase 2 §4 contract (F5).
  Checked before committing to it that importing a _runtime value_ from the db module into a
  client island is safe: `SupabaseClient` there is a type-only import, so `@/lib/supabase` and
  its secrets never enter the browser graph. `npm run build` confirms.

### F10 — `createMedication`'s new refusal branch logs unconditionally

- **Severity**: OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: src/lib/db/medications.ts:388
- **Detail**: `logDbError("create.dosage", ...)` fires before checking whether the code is
  `RLS_VIOLATION` (an expected, documented outcome per this module's own convention),
  inconsistent with how `setDosage` handles the identical code.
- **Fix**: Only log when `dosageError.code !== RLS_VIOLATION`, matching `setDosage`'s pattern.
- **Decision**: SKIPPED — triage surfaced a counterpoint that inverts the finding. `setDosage`
  deliberately _does_ log its `42501`, on the stated grounds that reaching it means either a
  raw request or the two-clock midnight window and "both are worth a trace". The create path
  reaches it the same two ways, so the unconditional log matches `setDosage` rather than
  diverging from it; the inconsistency the finding saw is with `no_specialist`, which is a
  routine user error rather than a rare diagnostic one. Left as shipped. Note F3 restructured
  this block and kept the log unconditional on purpose.

### F11 — Cancel-on-a-just-cancelled row can show a spurious "not found" error

- **Severity**: OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: src/components/medications/MedicationsManager.tsx:889-891
- **Detail**: Cancel buttons gate on the global `pending` flag, not per-row state; a double-click
  during the render window can double-fire, and the second call's 404 shows as an error for a
  change that was already successfully cancelled.
- **Fix**: Gate the specific row's button on the date being cancelled, or treat a 404 here as benign.
- **Decision**: SKIPPED — narrow race with a benign outcome: the row is gone either way and the
  list already reflects it, so the cost is one misleading notice after a deliberate
  double-click. Left as shipped.

### F12 — `send()`'s `body: unknown` accepts a silently-bodyless POST/PATCH

- **Severity**: OBSERVATION
- **Dimension**: Pattern Consistency
- **Location**: src/components/medications/MedicationsManager.tsx:230
- **Detail**: `body: unknown` doesn't distinguish "intentionally no body" from "forgot to pass
  one" for POST/PATCH. Acceptable looseness for an island-local helper; flagging as a seen
  tradeoff, not an accident.
- **Fix**: Optional — `body?: unknown` with the pairing left implicit.
- **Decision**: SKIPPED — accepted as the seen tradeoff the finding itself describes. The
  helper is island-local with three call sites, all in view of each other.

### F13 — The bare fixture insert in `constraints.test.sql` still risks masking its own failure mode

- **Severity**: OBSERVATION
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/constraints.test.sql:141-142
- **Detail**: The unasserted `insert` above the 23505/lives_ok/23514 block would abort the
  whole file if the policy ever regresses, reporting as a plan-count failure rather than the
  real cause. Named and deliberately left as-is in the migration's own header.
- **Fix**: Optional — wrap in `lives_ok` for a clearer failure message if this file is touched again.
- **Decision**: SKIPPED — accepted as already-named in the migration header. It degrades a
  failure message, not a guarantee, and with Docker down at triage time any change here could
  not have been verified by a run.
