---
change_id: mid-supply-dosage-change
title: Mid-supply dosage change (S-05)
status: impl_reviewed
created: 2026-09-10
updated: 2026-09-14
archived_at: null
---

## Notes

Roadmap slice **S-05** — see `context/foundation/roadmap.md` → `### S-05: Mid-supply dosage change`.
The roadmap's **north star**: the smallest end-to-end slice whose delivery proves the core
product hypothesis. Outcome: the user schedules a future dosage change (new daily amount,
effective date) and the dashboard recalculates the supply-end date and status segmentally.
PRD refs: FR-006, US-02. GitHub issue [#6](https://github.com/monika-mur/medcalc/issues/6).

Folder opened by `/10x-plan`. No `research.md` and no `frame.md` — the codebase questions
this slice had were answered by reading `src/lib/supply.ts` and the three migrations
directly, and the problem framing has been settled since the PRD.

Prerequisites S-02 and S-04 are both `done` and live in production.

**The arithmetic already exists.** `computeSupply` was written during S-04 with this slice
named in its header comment — future `effective_date` rows are already breakpoints and the
set is already bounded at `max(today, expiryDate)`. S-02's `plan.md:61` put it exactly:
S-05 "adds a control rather than a mechanism".

## Session log

**2026-09-12 — `/10x-plan-review`.** Deep mode. 5 critical, 4 warnings, 1 observation;
verdict REVISE → SOUND after triage. Nine fixed in `plan.md`, one accepted. Report at
`reviews/plan-review.md`.

Three things it changed that matter before Phase 1 starts:

- **Phase 1 breaks `npm run db:test`.** Four past-dated fixtures in
  `supabase/tests/constraints.test.sql` sit below that file's `set local role authenticated`,
  and the bare insert at `:130` aborts the file under the new predicate. Repairing them is now
  Phase 1 §2, and "What We're NOT Doing" distinguishes new coverage (still deferred) from
  fixture repair (in scope).
- **`scripts/check-migration-drift.mjs` did not exist on `master`** — it was on the unmerged
  `ci/migration-drift-check` (`01a79d5`), and `lessons.md` cited it as though it were live.
  **Resolved same day:** opened and merged PR #38 (`dbb772c`), so the script and its `ci.yml`
  step are now live on `master` — the Phase 1 prerequisite is satisfied, not merely recorded.
- **The two-clock window does not fail closed.** `setDosage`'s DELETE commits before the INSERT
  is refused, and the compensating restore is refused at the same date — destroying the row
  while the route reports "nothing changed". Phase 2 §2 re-resolves the date on the restore
  path.

Accepted rather than fixed: F5, the disagreement between the UTC-anchored date field and the
user-zone pending series west of UTC. It belongs to the same read-path question S-04's F0b
follow-up already owns, and no current user is in an affected zone.

**2026-09-13 — all four phases implemented.** `578ad56` (p1), `c155dc3` + `2ed0897` (p2),
`c854df0` + `dfcb735` (p3), `859ee16` (p4).

**Manual testing at Phase 4 (4.7) surfaced a gap the plan's own scope line missed.** A
medication created at 0/day with the real dose scheduled later (a normal thing to try through
`/medications`'s create form, since 0 is a legal dosage there) read "Stopped" instead of naming
the start date. The plan had scoped `not_started` as reachable "by API, not through the panel"
— true only for the narrower trigger it specified ("every dosage row is future-dated"), which
missed that the create form's own row can itself be 0. Fixed in the same commit as the rest of
Phase 4 (`859ee16`): `deriveStatus`'s trigger widened to "nothing in force today, and a
_nonzero_ row is pending" — the value-gated form, so a second pending 0/day row (re-confirming
a stop) still reads `not_used`. Both the dashboard and `/medications` labels were updated to
find the first nonzero pending row rather than trust the soonest one, since a stop-then-resume
series can have a 0/day row ahead of the real one. No plan-review finding number — found and
fixed within the phase, not carried over from `reviews/plan-review.md`.

**2026-09-13 — `/10x-impl-review`, full plan.** Verdict REJECTED: 3 critical, 6 warnings, 4
observations. Report at `reviews/impl-review.md`.

**2026-09-14 — findings triaged.** 9 fixed, 4 accepted; verdict REJECTED → APPROVED (see the
following entry for the check this left open, now closed). All three criticals were the same two-clock UTC-midnight seam Phase 2 was
meant to close, approached from three sides:

- **F1/F6 — the client cannot signal "server-derived", and the server trusted it to.** The retry
  that preserves a deleted dosage was gated on `effectiveDate === undefined`, but the island only
  sends `undefined` when the field equals `utcToday` — a prop frozen at page render. A tab open
  across UTC midnight therefore sent an ordinary save as an explicit stale date, disabling the
  guard for the exact case it exists for. Fixed on both sides: the server gate is gone (the caller
  never asked for the removed row to move), and the island now tracks whether the field was
  actually touched. Triage found the client symptom understated — `utcToday` is the zod floor as
  well as the seed, so the save failed client-side with a field error on a date the user never
  chose, never reaching the 400 the report described.
- **F2 — the reported fix was rejected as harmful.** Mirroring the primary path's
  DELETE-then-INSERT onto the restore retry would clear a row that had just become effective today
  — typically a change this slice scheduled — and write a stale value over it. A collision there
  instead _means_ a dosage is in force and there is nothing left to restore, so it is now
  recognised as benign rather than logged as a failure. The primary path may clear its slot
  because the caller asked to replace that date; the retry carries no such mandate.
- **F3 — a second figure was being lost silently.** `createMedication` returned on the refused
  dosage insert before attempting the supply-events insert, which would have succeeded
  (`supply_events_insert_own` is ownership-only). The refusal is now returned after that insert,
  which also makes the route's existing message — "the medication was saved but its dosage was
  not" — true rather than half-true.

F4 and F5 amend `plan.md` where it still specified behaviour that was deliberately dropped or
superseded; F5 in particular writes the shipped value-gated `not_started` rule into the contract,
since this slice ships no automated tests and that prose is what the eventual test slice inherits.
F9 then collapsed the three independent derivations of that rule into one exported helper.

**2026-09-14 — post-triage verification closed out.** Docker Desktop started, local stack
brought up, `npm run db:reset` applied all four migrations cleanly, `npm run db:test` ran
70/70 (`Files=4, Tests=70`, same count as `master`) — confirming F7's fix in
`supabase/tests/rls.test.sql` in a real run rather than by reasoning alone. App started
against the freshly reset stack. The user re-walked manual steps 3.5 and 4.7 by hand against
the F6/F9 code and confirmed both pass: today submits with no replace-confirm dialog whether
the date field was touched or not, and a not-started medication both names its start date
instead of reading "Not used" and keeps an actionable "Order now" band when seeded to run out
before its next visit. No outstanding items remain — the plan's Phase 4 merge gate is
satisfied and the branch is ready to push.
