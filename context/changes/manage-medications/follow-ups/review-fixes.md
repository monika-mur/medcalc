# Follow-ups — manage-medications (implementation review)

Queued during the S-02 implementation review, 2026-08-30, from findings that
were real but out of this slice's scope to fix. Each entry names the finding it
came from so the reasoning stays findable after this change is archived. The
review itself is at `../reviews/impl-review.md`.

## Mirror the failed-read empty state into the specialists page

**Source**: impl-review finding **F2**, fixed on the medications side and
deliberately left half-applied.

**What was fixed here**: `src/pages/medications.astro` now passes `loadFailed`
into `MedicationsManager`, which folds it into `canAdd` — so a failed read
withholds the add form — and branches the empty-state copy so the island no
longer prints "No medications yet. Add the first one above." directly beneath
"Your medications could not be loaded."

**What is left**: `src/pages/specialists.astro` has the identical shape and was
not touched. It resolves `loadFailed` the same way, renders the same error
paragraph, and then renders `SpecialistsManager` unconditionally, so a failed
`listSpecialists` produces the same self-contradicting pair.

**Why it was not fixed in S-02**: those are S-01 files. Editing them inside this
change would put an unrelated slice's fix into this PR, and the review's own
Scope Discipline dimension is the thing that would have flagged it. The
consequence is also milder there — a duplicate specialist is deletable, whereas
`medications` has no DELETE policy at all, so a duplicate medication can only be
archived. That asymmetry is exactly why the medications half was worth doing
immediately and this half can wait.

**What to do**: apply the same three edits to `specialists.astro` and
`SpecialistsManager.tsx` — pass `loadFailed`, gate the add form on it, branch the
empty-state string. Do it in whatever change next touches S-01's page, not as a
standalone commit.

**Verify with**: temporarily make `listSpecialists` return
`{ ok: false, error: "unknown" }`, load `/specialists`, and confirm the page
shows only the failure notice — no "No specialists yet" line, no add form. Revert
the stub.

## Record the widened `updated_at` clock-skew surface

**Source**: impl-review finding **F3**. Not a defect introduced by S-02 — the
slice follows S-01's established pattern correctly, and it improves on it by
logging the Postgres code before collapsing the error, which is what
`lessons.md` → _Log the database error before collapsing it to a domain kind_
asks for.

**The mechanism**: `created_at` is written by Postgres `now()` at INSERT.
`updated_at` is written by the application from the Worker's own clock, and
`20260821182457_grants_updated_at_guard_and_rls_perf.sql` added
`check (updated_at >= created_at)` on `medications`. Nothing reconciles the two
clocks. If the Worker's clock sits behind Postgres by more than the interval
between a row's creation and its first edit, the UPDATE raises `23514`, the data
module collapses it to `unknown`, and the route answers 500 — "Could not save the
medication" — for an edit that was perfectly valid. A create-then-immediately-
edit is the narrow window where the elapsed time is small enough for a modest
skew to matter.

**Why this entry exists**: `CLAUDE.md` → _Domain schema_ already records that
`updated_at` has no maintainer and is client-writable, and names S-01 as the
owner of giving it one. No follow-up file had ever been opened for that, so the
ownership note lived only in `CLAUDE.md`. This entry opens one, and adds the fact
the review surfaced: **the surface is now twice what it was**. The call sites
are

- `src/lib/db/specialists.ts` → `updateSpecialist` (S-01, pre-existing)
- `src/lib/db/medications.ts:288` → `updateMedicationDetails` (new)
- `src/lib/db/medications.ts:454` → `setArchived` (new — stamps `archived_at`
  from the same `now`, so archive and restore carry it too)

**What to do**: whoever gives the column a maintainer must change all three
together, and must not treat "the application sets it on every write" as
enforcement on its own — `database.types.ts` exposes `updated_at` on both
`Insert` and `Update`, and the UPDATE policies constrain no columns, so a client
can still send any value it likes. The schema-side half of the fix is the one
that actually binds. Note also that the no-trigger, no-function property is
asserted as a test (`CLAUDE.md` → _Domain schema_), so the obvious
`before update` trigger is not available without re-planning that decision
first — which is the reason this is a follow-up and not a two-line change.

**Verify with**: whatever lands must keep pgTAP at 70/70 and the integration
suite at 15/15, and should add an assertion that a client-supplied `updated_at`
cannot win over the maintained one.

## Carry the unbounded ledger embed into the S-04 views plan

**Source**: impl-review finding **F5**. Not a defect — the S-02 plan discloses
this as deliberate and names `listMedications` as the S-04 replacement point.
This entry exists so S-04 inherits it as a stated requirement rather than
rediscovering it while planning.

**The shape**: `MEDICATION_SELECT` in `src/lib/db/medications.ts:89-90` embeds
`dosage_changes(daily_dosage, effective_date)` and `supply_events(quantity_delta)`
with no filter and no limit, because the fold needs the latest dated dosage row
and the sum of every delta. Both tables are append-only by design — `CLAUDE.md`
→ _Domain schema_ — so the embed grows for the life of the account and nothing
caps it. It is paid twice: once per page load for every medication through
`listMedications`, and again for one medication after every single mutation
through `readMedication`. Ten medications with a dosage entry a day over three
years is on the order of eleven thousand rows per page load, to compute two
numbers.

**Why it is right for now**: at the PRD's volume it is invisible, and the
alternative in this slice would have been per-medication aggregate queries —
more round trips, more code, and all of it thrown away when the views land.
`medications_user_id_active_idx` is also partial on `archived_at is null` and is
deliberately bypassed here because the island owns the "Show archived" toggle;
that is a separate deliberate cost, recorded so nobody "fixes" the index.

**What to do in S-04**: the current-state views (latest dosage + current
balance) are the fix. `listMedications` and `readMedication` should end up
selecting the two folded values from the views instead of embedding the raw
child rows — `foldDosage`, the `reduce` over `supply_events`, and the
`MedicationRow` shape all disappear with them. The exported signatures of both
functions must not change; the plan already commits to that, and it is what
keeps the routes and the island untouched by the swap.

**Verify with**: after the swap, confirm a medication row still reports the same
`current_dosage` and `quantity_on_hand` for a history containing a future-dated
dosage change (which must be ignored), a `5 → 0 → 5` dosage series, and a
medication with no `dosage_changes` and no `supply_events` rows at all — the
three cases the TypeScript fold handles today and the ones a SQL rewrite is
most likely to get wrong.
