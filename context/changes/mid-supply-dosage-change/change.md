---
change_id: mid-supply-dosage-change
title: Mid-supply dosage change (S-05)
status: implemented
created: 2026-09-10
updated: 2026-09-13
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
