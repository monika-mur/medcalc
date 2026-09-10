---
change_id: supply-status-dashboard
title: Supply-status dashboard (S-04)
status: impl_reviewed
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

The recount write path landed as `9afc946`. All ten Progress rows
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

### 2026-09-10 — Close-out: the slice landed through PR #34

**C.1–C.4 are complete. S-04 is done and live in production.**

#### The pull request — the first one since the lesson that demanded it

`feat/supply-status-dashboard` was pushed (7 commits, never previously pushed),
[PR #34](https://github.com/monika-mur/medcalc/pull/34) was opened against
`master`, CI passed in 1m04s, and the PR was **merged on GitHub**.

**`master` was not fast-forwarded, and that is checkable rather than asserted.**
The merge commit `d9f7596` has **two parents** — `0c2715f` (the previous master
tip) and `4b2b146` (the branch tip). A fast-forward would have left `master`
pointing at `4b2b146` with one parent. `--merge` was chosen over `--squash`
deliberately: squashing would have collapsed the seven commits into one, and
every per-phase SHA recorded in `plan.md`'s Progress section would then point at
a commit not reachable from `master`.

This is the first slice planned since `lessons.md` → _Open a pull request for
every slice; never fast-forward master_ was written, and the first to honour it.
The payoff is visible in `roadmap.md`'s Evidence column: S-04's row cites
`[PR #34]` in the same shape as S-01's `[PR #26]`, where S-02 and S-03 can only
name commit ranges followed by "no PR".

**Issue [#5](https://github.com/monika-mur/medcalc/issues/5) closed itself** from
the PR body's `Closes #5` — state `CLOSED`, reason `COMPLETED`. Not closed by
hand afterwards, which is the failure mode the same lesson names.

#### The production deploy, verified by name

Merging pushed to `master`, which fired the deploy job (PRs deliberately do not
deploy — that step was removed after `--env preview` was found shipping every PR
straight to production). Run `34499290266` succeeded, and per `lessons.md` →
_Read the deploy log for the target name_ the target was confirmed **in the log
rather than inferred from the config**:

```
Uploaded medcalc (6.13 sec)
Deployed medcalc triggers (1.24 sec)
  https://medcalc.medcalc.workers.dev
Current Version ID: 81b33092-7b3a-4b64-a951-ef99e3156378
```

`curl -k` against the deployed Worker returns **200** on `/` and **302** on
`/dashboard` (the auth redirect, as expected when signed out). The `-k` is the
corporate TLS proxy, per `CLAUDE.md` → _Commands_; without it a healthy endpoint
reports `000` and reads as unreachable.

So "live in production" in the roadmap's Evidence column is a verified statement,
not an optimistic one.

#### What CI actually proved

`lint`, `typecheck` and `build`, on Node 22 — and **no test of behaviour**,
because this slice ships none. The green check means the code compiles,
type-checks and lints.

**Corrected during the 2026-09-10 implementation review.** This section first
read "not `npm run typecheck` — still unenforced, per the open follow-up
`manage-doctor-visits/follow-ups/typecheck-in-ci.md`". That was stale: the gate
landed in `668b675` on **2026-09-06**, four days before PR #34, and the follow-up
it cited has read `RESOLVED` since. So PR #34's green check was stronger than the
first version of this entry claimed. The substantive point is unchanged — CI runs
nothing that would catch a wrong number.

Everything that actually verified this slice was manual: the developer's browser
walk of 3.5–3.10, the pgTAP 70/70 run, and a scratch harness that is not in the
repo. `follow-ups/supply-engine-tests.md` is the durable record of what a real
suite must assert, and it now outlives all three.

One CI annotation, unrelated and not actionable here: `actions/checkout@v4`,
`actions/setup-node@v4` and `cloudflare/wrangler-action@v3` target Node 20, which
GitHub deprecated; the runner forced them onto Node 24. It affects every workflow
run in the repo, not this slice.

#### The close-out edits went through their own pull request

`roadmap.md`'s flip and this entry are themselves changes to `master`, and the
same lesson applies to them — plus any direct push to `master` triggers a
production deploy. They were therefore branched as `docs/s-04-close-out` off the
merge commit and taken through a second PR rather than pushed straight.

**One thing worth knowing for next time.** `git checkout master` was attempted
while `plan.md` carried the uncommitted C.1 tick, so the checkout aborted — but
the `git pull` chained after it still ran, on the feature branch, fast-forwarding
`feat/supply-status-dashboard` up to `d9f7596`. Harmless: the branch caught up to
`master`, which is the opposite direction from the one the lesson forbids, and
`master` itself was untouched. The general shape is worth remembering — a `&&`
chain whose first command aborts on a dirty tree does not necessarily stop the
rest from doing something on the branch you are still standing on.

#### Slice state

- **S-04 is done** in `roadmap.md` — At-a-glance row, item body, and a `## Done`
  entry citing PR #34.
- `change.md` → `status: implemented`. `archived_at` stays `null`; archival is
  `/10x-archive`'s to stamp, and the folder should not move until then.
- **The next slice is S-05 (mid-supply dosage change)**, the roadmap's north
  star. Two things in this folder are addressed to it specifically: the
  `not_used` / "Stopped" label is wrong for a medication whose dosage rows are
  all future-dated (unreachable today, S-05's whole purpose), and the Phase 2
  note that the plan's literal Desired-End-State scenario cannot be seeded
  through the UI — every refill writes `occurred_on = todayUtc()`, so a
  back-dated fixture needs the service role, or the visit gets moved relative to
  the card's own supply-end date instead.

#### Environment left running

Docker, the local Supabase stack (Studio on `:54323`) and `npm run dev` on
`:4321` are all still up, holding the Phase 3 manual fixtures and the recount
rows the walk produced. Nothing downstream needs them; the next `db:reset` from
any worktree may take them.

### 2026-09-10 — Implementation review, run after the merge

`/10x-impl-review` was run **after** PR #34 merged and deployed, not before. The
developer noticed the gate had been skipped in the chain and asked for it anyway.
Report at `reviews/impl-review.md`; S-04 is no longer the only slice of five
without one.

**It was worth running.** Seven findings, two of which no automated gate could
have caught — a green CI run (lint + typecheck + build), a full manual browser
walk of 3.5–3.10 and a merged PR all passed over both, because both need
circumstances this machine cannot produce.

**F0a — CRITICAL, fixed.** `floorDivide` scales operands by `10^6`, so any
divisor below `5e-7` rounds to **zero**. Its docstring promised only that
"callers guarantee `b > 0`" — true at every call site, and the wrong guarantee.
`dailyDosageField` bounds magnitude and not precision, so
`{"daily_dosage": 0.0000004}` was accepted end to end, Postgres returned it as
`4e-07`, `decimalPlaces` read exponential notation as 6 places, and the divisor
became 0. With stock on hand that yields `covered = Infinity`, the walk never
decrements and reports **"lasts until expiry"** — the over-report the PRD calls a
product failure. With nothing on hand it yields `NaN`, which reached `addDays`
and produced the literal string `"0NaN-NaN-NaN"`, rendered into
`<time datetime=…>` on the card. Fixed at both ends: a `MIN_NONZERO_DOSAGE` floor
on the schema, plus fail-loud `RangeError`s in `floorDivide` (zero scaled
divisor) and `addDays` (non-finite offset), matching the discipline `toEpochDay`
already set one function away. Verified that `0`, `0.25`, `0.000001` and `1000`
are still accepted and `0.9 / 0.3` is still 3.

**F0b — downgraded to WARNING, deferred.** A row written with `todayUtc()` and
classified against the user's `today` is dated in the future relative to its own
classification date whenever UTC has ticked over and the user's zone has not, so
`doseInForce` skips it and a just-created medication reads "Not used / 0 on
hand". The sub-agent rated it CRITICAL; that overstates it. It under-reports
rather than over-reports, the window is 00:00–12:00 UTC for zones **west** of UTC
only (Warsaw is never affected — the window was measured, not assumed, correcting
an initial write-up that had the direction backwards), and the obvious patch —
`max(today, written)` at the four mutation returns — fixes the write response
while leaving the next page load wrong. Deferred whole to
`follow-ups/timezone-classification.md` rather than half-fixed under review
pressure: which date classifies a row is a design decision that touches
`CLAUDE.md` → _Dates_, and that section has a documented history of a bug caused
by getting it wrong.

**F1 — fixed.** The refill and create paths wrote `quantity_delta` raw while
Phase 3 clamped `counted`, so a 7-decimal refill entered the ledger and the
**next** correction's `subtractExact` disagreed with Postgres. Confirmed against
the live database: `(1.000001 - 2.0000005) = -1` is false. `clampScale` now
applied at both sites, so all three write paths are scale-safe.

**F2 — fixed, and it corrects this file.** Three documents claimed CI does not
enforce `typecheck`. It has since `668b675` on 2026-09-06 — four days before
PR #34 — and the follow-up they cited has read `RESOLVED` since. Corrected in
`follow-ups/supply-engine-tests.md` and here; `plan.md` carries a visible
amendment note rather than a silent rewrite, at the developer's direction.

**F3 — fixed.** `quantity_on_hand` summed the ledger with raw `+`. Nothing
renders it, but it is public on `MedicationView`, so the drift would have been
inherited rather than introduced. Now reduces with `addExact`.

**F4, F5 — recorded.** The engine is `O(breakpoints × events)`, not
`O(breakpoints)` as the plan states (harmless at this volume; the NFR conclusion
survives because iterations are bounded by breakpoints and never by days), and
`addDays` rejects calendrically non-existent dates like `2026-02-30`, which is
stricter than the plan specified and deliberate. Both noted in
`follow-ups/supply-engine-tests.md` so S-05 inherits accurate information and
neither guard is removed as accidental.

**What passed.** Plan Adherence is a clean MATCH across all three phases — no
missing items, no scope creep in `src/`, and the three assertions the plan warned
would be silently "corrected" are all intact. All eight scope guardrails hold.
Every automated criterion was re-run independently during the review.

**The ordering lesson.** Every finding above was found by reading the code, and
none by running it. The review belongs before the merge — not because these were
unfixable afterwards (rollback is `git revert`, and five were fixed in place),
but because F0a shipped a path that over-reports supply, which is the one failure
this product's PRD says it exists to prevent.
