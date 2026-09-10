---
change_id: supply-status-dashboard
title: Supply-status dashboard (S-04)
status: implementing
created: 2026-09-06
updated: 2026-09-10
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

### 2026-09-09 — Phase 2 closed

The dashboard landed as one commit, `4bf166f`, carrying `CLAUDE.md` alongside
the code it describes — so criterion 2.13's `git show --stat` evidence is
honest, which the 2026-09-08 toolkit-sync commit is what made possible.

All four automated criteria passed first time. Two extra mechanical checks were
run because both underpin a manual item that is otherwise a judgement call:
`.text-warning{color:var(--warning)}` is present in the built CSS (the
`:root`-without-`@theme` failure mode compiles clean and silently yields no
class), and no `client:*` directive exists anywhere in the dashboard tree.

**Nothing predicted by the plan went wrong.** Two small adaptations, neither
behavioural:

- `astro/prefer-class-list-directive` rejected `class={STATE_CLASS[state]}` on
  the badge span. Switched to `class:list={[...]}`; lint is a zero-warning gate
  here, so this had to be fixed rather than noted.
- Criterion 2.4's grep matched the word `amber-700` in a **comment** in
  `SupplyCard.astro` — prose, not a class. Reworded to point at `global.css`,
  where the shade argument now lives in full, rather than weakening the grep.
  The criterion is mechanical on purpose; a comment that trips it is a comment
  in the wrong file.

**2.5–2.12 confirmed by the developer in the browser.** 2.6 was walked through
five visit dates rather than the plan's four — the plan's own positions plus
both edges of the yellow band (`end-15` green, `end-14` yellow, `end-1` yellow,
`end` red, `end+3` red), so the band's width was verified as well as the
red-equality case. The engine's answers for all five were computed against the
real `src/lib/{dates,decimal,supply}.ts` through a scratch harness before the
developer walked them, so the expected values handed over were derived rather
than asserted.

Worth recording for S-05, which will need the same fixtures: **the plan's
literal Desired-End-State scenario cannot be seeded through the UI.** It wants a
refill dated ten days ago, and every refill writes `occurred_on = todayUtc()`.
Either back-date the row in Studio (`supply_events` has no UPDATE policy, so
that needs the service role) or — simpler, and what was done here — read the
supply-end date off the card and move the visit relative to it. The classifier
only ever sees those two dates, so both routes walk identical branches.

---
### 2026-09-10 — Phase 3 closed

The recount write path landed as `PLACEHOLDER_SHA`. All ten Progress rows
(3.1–3.10) are ticked; Phase 3 is complete and only Close-out remains.

**The environment came up as the previous session predicted.** Docker Desktop
was down at session start and had to be launched before `npx supabase start`.
Criterion 3.4 was run **first**, before seeding anything: `npm run db:reset`
from this worktree applied all three migrations, and `npm run db:test` returned
**70/70 across four files**. The reset destroyed the Phase 1 and Phase 2
fixtures, which is exactly why the plan orders it first — the manual scenario
was seeded fresh afterwards, once.

Today resolved to `2026-09-10` in **both** UTC and the user's zone
(Europe/Warsaw), so this session exercised no two-todays skew. A session run
late in a UTC-behind zone would; the divergence remains untested by hand.

**Every expected value handed to the developer was derived, not asserted.** The
real `src/lib/{dates,decimal,supply}.ts` were copied into a scratch harness and
run under `--experimental-strip-types` to produce the fixture supply-end dates,
the post-correction projection and the five classifier boundaries, before any
browser step was walked. Same technique as the Phase 2 session.

**3.5, 3.6, 3.8 and 3.9 passed first time.** 3.10 was verified against a clean
log baseline captured before the run: **zero `medications.*` lines** across the
whole session, so no successful correction logged an error.

#### Not predicted by the plan — the display path reintroduced the float class

**3.7 failed on its first walk, and the failure was on screen only.** The
`recount` row was written correctly — `quantity_delta = -0.2` exactly — while
the success notice read:

> Frac-Point3 corrected to 0.1 on hand — **0.19999999999999998** fewer than projected.

`discrepancyPhrase` in `MedicationsManager.tsx` computed its number with
`Math.abs(after - before)`. Phase 3 change 1 mandates `subtractExact` on the
write path and spends a paragraph on why; it says nothing about the display
path, because the display path did not exist when the plan was written — the
discrepancy phrase is itself a Phase 3 addition (change 2). So the island
reintroduced the precise float class the data module two files away exists to
prevent, in the one place the arithmetic is **visible to the user**.

Fixed by importing `subtractExact` into the island — it is pure, with no server
dependency, so the import is direct. Verified across five cases against the real
module: `0.3 → 0.1` now renders `0.2 fewer`, `0.1 → 0.3` renders `0.2 more`,
`1.005 → 0.9` renders `0.105 fewer`. The integer case (`30 → 18` → "12 fewer")
and the clamped case (`5 → 0.123457` → "4.876543 fewer") are **byte-identical
before and after**, so 3.5 and 3.8 did not need re-walking. `npm run typecheck`
(0 errors, 0 warnings) and `npm run lint` (exit 0) were re-run after the fix and
both still pass. The developer re-walked 3.7 and confirmed it.

**Why this is worth more than a one-line fix note.** The rule "arithmetic over
`numeric`-derived values goes through `@/lib/decimal`" was written down for the
server and followed there; the client-side half was never written down and was
never followed. Nothing in the type system distinguishes a `number` that came
from a `numeric` column from one that did not, so neither `typecheck` nor `lint`
could have caught it — and the database-level assertion the plan _does_ specify
passes with the defect live, because the row was always right. It took a human
reading a sentence. That is now the lead entry in the display-path section of
`follow-ups/supply-engine-tests.md`, with the general rule stated as a review
check rather than only as a test.

**`npm run build` was deliberately not re-run** after the fix. It was green at
3.3, and the dev server was live for the browser walk — `lessons.md` → _Never
run a production build against a live dev server_. The build gate for the fix is
CI on the pull request.

#### Two log lines that are not defects

The dev-server log carries two `AuthApiError: Invalid Refresh Token` entries at
12:30:51 — a stale session cookie from before `db:reset` wiped the auth users,
hit once on the first page load after the reset. Unrelated to this phase, and
distinct from the `medications.*` lines 3.10 looks for.

#### Files in this commit

- `src/lib/db/medications.ts` — the `recount` write path; `readMedication` split
  so `readRow` returns the raw row for the projection.
- `src/components/medications/MedicationsManager.tsx` — the discrepancy notice,
  including the `subtractExact` fix above.
- `context/changes/supply-status-dashboard/follow-ups/supply-engine-tests.md` —
  new; close-out item C.1.
- `context/changes/supply-status-dashboard/{plan.md,change.md}`.

`src/pages/api/medications/[id]/supply.ts` is **unchanged**, as the plan
predicted — verified, not edited.

---

## Resume here — Close-out

**Next:** Close-out items C.1–C.4. Phase 3 is closed; no phase work remains.

- **C.1 is done** — `follow-ups/supply-engine-tests.md` is written and leads
  with the red-equality case and worked example 5, per the plan's instruction.
  It also carries the display-path defect found today and the
  exhaustion-at-`bound` tie-resolution case, neither of which is in the plan's
  _Testing Strategy_ list.
- **C.2 — the pull request.** The branch `feat/supply-status-dashboard` has
  **never been pushed**. Push it, open a PR against `master`, let CI run, merge
  there, and close [#5](https://github.com/monika-mur/medcalc/issues/5) from the
  PR body. **Never fast-forward `master`** — `lessons.md` → _Open a pull request
  for every slice_ records that S-02 and S-03 both landed as local
  fast-forwards, and that the gate cannot be reinstated afterwards: once
  `master` carries the commits the branch is 0 ahead and GitHub refuses to open
  a PR. This is the first slice planned since that lesson was written.
- **C.3 — `roadmap.md`.** S-04 currently reads `in-progress` in both the
  At-a-glance row (`:36`) and the item body, committed in `f75ee41`. Flip both
  to `done` and add the `## Done` entry **citing the PR**, from the PR rather
  than afterwards.
- **C.4** — this file, kept current.

### Environment state at hand-off

Docker, the local Supabase stack and `npm run dev` on 4321 were all left
**running** at the end of this session. The database holds the Phase 3 manual
fixtures (one specialist, `Recount-30`, `Frac-Point3`, `Seven-Dec`, one visit)
plus the recount rows the walk produced. Nothing downstream needs them — the
next `db:reset` from any worktree may take them.

The scratch harness is still not in the repo; it lives in a temp directory and
holds **copies** of `src/lib/{dates,decimal,supply}.ts`, so it is stale the
moment those change. `scratch/engine-harness.md` is the in-repo record, and
`follow-ups/supply-engine-tests.md` is now the specification that outlives both.
