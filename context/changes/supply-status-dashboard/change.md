---
change_id: supply-status-dashboard
title: Supply-status dashboard (S-04)
status: implementing
created: 2026-09-06
updated: 2026-09-09
archived_at: null
---

## Notes

Roadmap slice **S-04** — see `context/foundation/roadmap.md` → `### S-04: Supply-status dashboard`.
Outcome: per medication, the calculated supply-end date and a green/yellow/red status
relative to the next visit with the assigned specialist. PRD refs: FR-011, US-01.
GitHub issue [#5](https://github.com/monika-mur/medcalc/issues/5).

Folder opened by `/10x-research` (not `/10x-new`) to hold `research.md`, which answers a
pre-planning question: whether `@internationalized/date` is worth adopting for this slice.
Verdict: no — see `research.md`. Status advanced `new` → `preparing` per the lifecycle table.

Prerequisites S-02 and S-03 are both `done` and live in production.

## Session log

### 2026-09-06 — Phase 1, plan amended before implementation

Branched `feat/supply-status-dashboard` off `master` before any commit, per
`lessons.md` → _Open a pull request for every slice; never fast-forward master_.

**Not predicted by the plan.** Walk step 4 specified that exhaustion terminates
the walk. That is wrong whenever a supply event lands after the exhaustion —
the ordinary "ran out, refilled a fortnight later" case, reachable from the
normal UI because `occurred_on` is always `todayUtc()`. The walk would never
reach the later refill or the `today` breakpoint, so a user holding a nearly
full box would be shown a past supply-end date, a projected quantity of 0 and
an "Out of stock" badge. None of the five worked examples exercised it, so
Progress 1.8 would have passed with the defect live.

Chose _stop and re-plan_. `plan.md` amended before any engine code was written:

- Walk steps 3–5 rewritten — exhaustion sets a flag and records a provisional
  date; a later event that raises `remaining` above 0 clears both and resumes.
  The answer is the last exhaustion the walk records.
- The expiry cap moved from an on-arrival exit test to a single post-walk
  clamp (new step 6), which is correct in both directions without a second
  exit condition. `expiryDate < start` split out as an up-front return (step 7).
- _Critical Implementation Details_ → the termination paragraph reworded: the
  walk is **bounded** by expiry, it does not exit on it.
- Worked example 6 (exhaustion then refill) added; examples 1–5 re-verified by
  hand against the amended rules and all still produce their stated dates.
- Criterion 1.8 and Progress 1.8 widened from five examples to six.

**Verified mechanically, not only by eye.** The six worked examples, seven
classifier boundaries, the engine's edge cases and the date/decimal primitives
(including a 5000-day differential run of `addDays` against `Date`) were run
against the real modules through a scratch harness outside the repo, using
Node's `--experimental-strip-types`. 32/32 pass. Nothing was committed — this
slice ships no tests by decision — but the assertions are the seed for
`follow-ups/supply-engine-tests.md` at close-out.

That harness caught one defect the six examples alone would not have: supply
running out exactly at `bound` finishes its final span fully covered, so
`exhausted` never got set and the post-walk cap reported `"expiry"` for a date
consumption had actually produced. `plan.md` step 6 already specified that ties
resolve to consumption; the code did not. Fixed in `computeSupply` by treating
`remaining === 0` at the end of the walk as exhaustion at `bound`.

**Known transient across the Phase 1 → Phase 3 boundary.** Phase 1 change 7
switches the correction pre-fill to `projected_quantity`, but `recordSupply`
keeps deriving its delta from `quantity_on_hand` (the ledger sum) until Phase 3
change 1 replaces that branch. Between the two commits, accepting the
pre-filled figure writes an adjustment of `projected − ledger` and the number
subtracts twice: a medication at ledger 30 / projected 20, corrected to 20,
comes back reading 10. The phasing is the plan's, all three phases land in one
PR, and nothing deploys in between — but it is a real defect in the working
tree at the Phase 1 gate, so do not spend a correction there expecting it to
behave. Phase 3 closes it.

### 2026-09-08 — Phase 1 closed

Manual verification run by the developer. **1.4–1.7 confirmed by hand**;
**1.8 accepted on the mechanical run** rather than re-walked through the UI.

The harness was re-run from scratch this session against the real
`src/lib/{dates,decimal,supply}.ts` — **49/49 pass**, up from the 32 assertions
of 2026-09-06 (the classifier boundaries, the engine's edge cases, the
`5 → 0 → 5` series and the 5000-day `addDays` differential were broadened).
Examples 5 and 6 each carry their failure mode in the assertion name, so a
later reader who "corrects" the bounded breakpoint set or re-adds an early
return sees which one broke.

`npm run typecheck` (0 errors, 0 warnings) and `npm run lint` (exit 0) were
re-run before the commit and both still pass. `npm run build` was **not**
re-run — it was green at 1.3 and nothing in `src/` changed since; the dev
server was up for the browser checks, and rebuilding under it is the failure
`lessons.md` → _Never run a production build against a live dev server_
records.

**Nothing predicted by the plan went wrong in this session.** No adaptation
was needed; the four browser checks and the harness all behaved as the plan
described.

Phase 1 landed as **three** commits rather than one, at the developer's
request, because the working tree carried two unrelated dirty sets:

- `b0600ad` — the engine, the data module, the six callers, the island and
  this change folder.
- `f75ee41` — `prd.md` (the red-equality reading, written up as a partition on
  days of cover after the visit) and the `roadmap.md` S-04 flip. The roadmap
  flip therefore **is** committed, contrary to the note left on 2026-09-06
  saying it would be held back.
- `530be8e` — the `@przeprogramowani/10x-cli` sync to Module 2 Lesson 4,
  including every `CLAUDE.md` edit, all of which sit inside the managed block
  at lines 112-163. **This clears the Phase 2 staging question** below: the
  toolkit churn is gone, so the Phase 2 commit can carry `CLAUDE.md` alone and
  criterion 2.13's `git show --stat` evidence stays honest.

The transient below is now the only known defect in the working tree, and
Phase 3 closes it.

---

## Resume here — paused 2026-09-08, end of Phase 1

**Next command:** `/10x-implement supply-status-dashboard phase 2`

Phase 1 is complete and committed. Phase 2 (the dashboard) and Phase 3 (the
recount write path) are untouched.

### State on disk

- **Branch:** `feat/supply-status-dashboard`, created off `master` before any
  commit. Phase 1 is **committed**; the branch is ahead of `master` by that one
  commit and has never been pushed. `master` must not be fast-forwarded onto it
  — `lessons.md` → _Open a pull request for every slice_.
- **Progress 1.1–1.8 all ticked.** Phase 1 is closed.
- `context/foundation/roadmap.md` S-04 reads `in-progress` in both the
  At-a-glance row and the item body, **committed** in `f75ee41`.
- **The working tree is clean.** Nothing is left dirty from this run.

### Files committed in Phase 1

New: `src/lib/decimal.ts`, `src/lib/supply.ts`.
Modified: `src/lib/dates.ts`, `src/lib/db/medications.ts`,
`src/components/medications/MedicationsManager.tsx`, `src/pages/medications.astro`,
`src/pages/visits.astro`, and the five `src/pages/api/medications/**` routes.
Plus the whole `context/changes/supply-status-dashboard/` folder.

### Environment, for the next session

Docker Desktop was **down** at the start of this session and had to be started
before `npx supabase start`. Expect the same. The local stack is shared with
the `MedCalc-s02-medications` and `MedCalc-s03-visits` worktrees, so run
`npm run db:reset` from **this** worktree before anything that reads the
database — `lessons.md` → _Reset the database from your own worktree_.

Phase 2 needs no database claim at all: it is a new page, two presentation
components, a CSS token and two `CLAUDE.md` lines. Its manual checks need
seeded data, so the stack has to be up for those, but nothing in the phase
writes a migration. **Phase 3's 3.4 is the one that needs the reset**, and the
plan says to run it _before_ seeding, because `db:reset` destroys the scenario
the manual steps need.

The `/medications` fixtures seeded for Phase 1 (`Stale-40`, `Fresh-10`,
`Stopped-Zero`, `Gap-NoDosage`) survive only until the next `db:reset`. Phase 2
needs a second specialist and at least one visit on top of them.

### Two carried-forward cautions

1. **The Phase 1 → Phase 3 transient is live in the working tree.** Phase 1
   switched the correction pre-fill to `projected_quantity` while
   `recordSupply` still derives its delta from `quantity_on_hand`, so accepting
   the pre-filled figure subtracts twice — ledger 30 / projected 20, corrected
   to 20, comes back reading 10. Do not spend a correction expecting it to
   behave, on `/medications` or via the dashboard, until Phase 3 lands.
2. **The harness is not in the repo.** It lives at
   `%TEMP%\medcalc-p1-harness\check.ts` and holds _copies_ of the three
   modules, so it is stale the moment `src/lib/` changes — re-copy before
   re-running. `%TEMP%` is not durable; `scratch/engine-harness.md` is the
   in-repo record of what it asserts, and close-out item C.1 turns it into
   `follow-ups/supply-engine-tests.md`.

### Resolved before Phase 2

The `CLAUDE.md` staging conflict flagged on 2026-09-06 is **gone**. The toolkit
churn, `.claude/**` and `prd.md` were all committed in this session, so Phase 2
change 5 can amend `CLAUDE.md` lines 65 and 94 and commit the file alongside
the dashboard code with nothing extra riding along.
