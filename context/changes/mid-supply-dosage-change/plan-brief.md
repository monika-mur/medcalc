# Mid-supply Dosage Change (S-05) — Plan Brief

> Full plan: `context/changes/mid-supply-dosage-change/plan.md`

## What & Why

The user schedules a future dosage change — a new daily amount from a chosen date — and the
dashboard recalculates the supply-end date segmentally: the old dose through the day before
the change, the new dose from the change onward. FR-006 and US-02.

This is the roadmap's **north star**. The Vision names mid-supply dosage changes as the hard
case existing medication apps get wrong, so this is the slice that decides whether the product
has a reason to exist. It is also, in code terms, one of the smaller ones — the arithmetic was
built during S-04 and already handles this.

## Starting Point

`computeSupply` (`src/lib/supply.ts`) was written with this slice named in its header:
_"Written so S-05's future-dated dosage rows are simply more breakpoints."_ Every
`effective_date` is already a breakpoint, and the set is already bounded at
`max(today, expiryDate)`. The schema is ready too — `dosage_changes` allows one row per
medication per day, and the DELETE policy was relaxed in `20260829071323` with a header stating
its `> current_date` half exists **for this slice**, so a scheduled change stays cancellable.

What is missing is a way to write such a row. `dosageInputSchema` is
`strictObject({ daily_dosage })` — a body carrying a date is rejected — and `setDosage`
hardcodes `todayUtc()`. Two more gaps sit behind that: the INSERT policy has **no date guard at
all**, so accepting a date would also permit back-dating; and a medication whose dosage rows are
all future-dated currently reads **"Stopped"**, a defect S-04 found, could not trigger, and
handed here in writing.

## Desired End State

The "Change dosage" panel on `/medications` carries a date field defaulting to today. Today
behaves exactly as it does now; a future date schedules instead. The panel lists pending changes
with a Cancel on each, and confirms before replacing one already scheduled for the chosen date.
On `/dashboard`, a card with a scheduled change names it — "Changes to 1.5 / day on 2026-09-21"
— and one whose dosage has not begun reads "Starts 2026-09-21", not "Stopped". At the database,
a dosage row dated before today cannot be inserted at all.

## Key Decisions Made

| Decision                     | Choice                                                     | Why (1 sentence)                                                                                                                 | Source |
| ---------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Back-dating guard            | Migration tightening the INSERT policy **and** a zod bound | The DELETE policy already guards the past; leaving INSERT open means history is immutable only by the app's good manners.        | Plan   |
| Route shape                  | Extend `POST …/dosage` with an optional `effective_date`   | One dosage write path and one schema shared by island and route; `setDosage` already keys on a date, so it becomes a parameter.  | Plan   |
| Pending changes per med      | **Many**                                                   | The unique `(medication_id, effective_date)` gives each date its own slot and the engine walks any number — no artificial cap.   | Plan   |
| Managing a scheduled change  | Cancel, and re-schedule to replace                         | Maps 1:1 onto what RLS permits (DELETE + INSERT, no UPDATE); "replace" falls out of pairing the two, so there is no third verb.  | Plan   |
| Not-yet-started medication   | New `not_started` status + card state                      | Both label maps are exhaustive `Record`s, so adding a variant makes the compiler find all four surfaces rather than a reviewer.  | Plan   |
| Minimum selectable date      | UTC today, server-resolved and server-authoritative        | The picker, the zod floor and the RLS predicate must name one day, and the policy's day is Postgres's.                           | Plan   |
| Date collision on schedule   | Replace, behind an `AlertDialog` confirm                   | Keeps `23505` unreachable by construction while making an overwrite deliberate; reuses the Archive dialog already in the island. | Plan   |
| S-04 finding F0b (timezones) | Out of scope; strengthen the existing follow-up            | It under-reports, exposure is currently nil, and its own file argues a partial fix under pressure is the wrong shape.            | Plan   |
| Tests                        | **Deferred entirely**, pgTAP for the new policy included   | The standing "tests are their own slice" decision, reaffirmed explicitly during planning with the cost stated.                   | Plan   |

## Scope

**In scope:** the INSERT-policy migration and its cloud push; an optional `effective_date`
through the schema, `setDosage` and the dosage route; a cancel endpoint; the `not_started`
status and the pending series on `MedicationView`; the date field, pending list, cancel controls
and replace-confirm on `/medications`; the `not_started` card and the scheduled-change line on
`/dashboard`.

**Out of scope:** any change to `src/lib/supply.ts`; every automated test, the new policy's
pgTAP assertion included; S-04's deferred timezone finding F0b; liquid medications (S-06);
editing a pending row in place; `clampScale` on `daily_dosage`; any island on `/dashboard`.

## Architecture / Approach

Four phases, database outward. The ordering is forced once: **the INSERT guard must land before
any route accepts a date**, because the gap between the two is a window in which the historical
series is writable. Everything after that moves outward so each phase leaves the app working —
Phase 2 makes the capability reachable by `curl`, Phase 3 lets the user drive it, Phase 4
explains it on the dashboard.

The engine is untouched throughout. A scheduled change is one more row in a table the walk
already reads, and one more breakpoint in a set it already bounds.

## Phases at a Glance

| Phase                               | What it delivers                                                  | Key risk                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1. Guard the past                   | INSERT policy refuses a back-dated row; applied to cloud          | The only migration and the only cloud push; `lessons.md` records this step being silently skipped twice |
| 2. Domain layer + API               | Date through schema → `setDosage` → routes; `not_started`; cancel | `deriveStatus` precedence and the 404-on-zero-rows check are both invisible when wrong                  |
| 3. `/medications` schedule + cancel | Date field, pending list, per-row cancel, replace-confirm         | Largest UI change, in an 839-line island, on a layout the NFR pins at 320px                             |
| 4. `/dashboard` surface             | `not_started` card state and the scheduled-change line            | Small, but it is where the north-star walk is actually verified                                         |

**Prerequisites:** S-02 and S-04 both `done` and live in production (they are). A local Supabase
stack, reset from this worktree before any db command — `lessons.md` → _Reset the database from
your own worktree_. Cloud `db push` access for Phase 1.

**Estimated effort:** ~4 sessions, one per phase. Phase 3 is the largest; Phase 4 is under an
hour of edits plus the end-to-end walk.

## Open Risks & Assumptions

- **Nothing asserts the new INSERT policy.** If the predicate is later loosened, the app keeps
  working — it never tries to back-date — and the hole reopens in silence. Specified in
  `follow-ups/deferred-tests.md` and named in the migration header, which is the whole of the
  mitigation.
- **The segmental arithmetic ships with no automated coverage**, on the slice that exists to
  prove it. S-04's impl-review found two defects by reading code that a green CI run and a full
  manual walk both passed over; the same exposure applies here.
- **Two clocks now meet.** `todayUtc()` is the Worker's, `current_date` is Postgres's. A request
  crossing UTC midnight between them is refused — sub-second, fails closed, and Phase 2 surfaces
  it rather than letting `createMedication` swallow it as it does today.
- **The replace-confirm is a client-side check** against the list in props, so two tabs can race
  it. The server replaces regardless; the confirm exists to catch a mistyped date, not to
  serialise concurrent edits.
- **This slice widens F0b's seam** without fixing it: the user now picks dates near a boundary
  two clocks disagree about. Still under-reporting only, still nil exposure.

## Success Criteria (Summary)

- A user schedules "3/day from next Monday" and the supply-end date moves to the segmentally
  correct day — old dose through Sunday, new dose from Monday — with the status reclassifying.
- The dashboard says why: the card names the coming change rather than silently showing a
  different number.
- A medication whose dosage starts next week says so, instead of claiming the user stopped
  taking it.
