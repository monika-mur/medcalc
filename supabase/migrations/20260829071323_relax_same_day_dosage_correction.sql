-- Relax the dosage-change DELETE lock from "immutable once set" to "immutable
-- once past" — roadmap S-02 (change: manage-medications), Phase 1.
--
-- WAS: `dosage_changes_delete_future_own` permitted DELETE only while
--   `effective_date > current_date`. A dosage recorded today therefore became
--   uncorrectable the instant it was written, and stayed so until tomorrow.
--   `dosage_changes` has no UPDATE policy either (20260813185255:285-296), so
--   there was no second route: a typo in the first dosage a user ever entered
--   could not be fixed on the day it was made. That is the likeliest first-day
--   mistake in the whole slice.
--
-- IS: DELETE is permitted while `effective_date >= current_date`. Today's row
--   can be removed and replaced; every already-past row stays immutable, which
--   is the invariant that actually matters — FR-006's segmental calculation
--   reads the historical series and must not find it rewritten underneath.
--   S-02 uses this as an explicit DELETE-then-INSERT in
--   `src/lib/db/medications.ts` → `setDosage`. It cannot use PostgREST's
--   `.upsert()`: that compiles to `INSERT … ON CONFLICT DO UPDATE` and the
--   conflict branch needs an UPDATE policy this table does not have and is not
--   getting.
--
-- S-05 (mid-supply dosage change) depends on the `>` half of this predicate
--   surviving unchanged: a future-dated row it schedules must stay deletable
--   until it takes effect. Widening `>` to `>=` preserves that strictly — every
--   date the old policy admitted, the new one still admits. Narrowing it back,
--   or replacing it with an equality on `current_date`, would break S-05.
--
-- UTC CAVEAT, carried forward from the original policy at
--   20260813185255:288-289 and now load-bearing rather than merely noted.
--   `current_date` is UTC on Supabase, so any `effective_date` the application
--   writes must also be resolved in UTC. A date taken from the visitor's local
--   clock disagrees with this predicate for part of every day: at 22:00 in
--   UTC-8 a browser-derived "today" is yesterday in UTC, the inserted row fails
--   `effective_date >= current_date`, and the dosage just set is uncorrectable
--   again — reintroducing precisely the bug this migration removes, invisibly
--   and only for western zones near midnight. S-02's data module therefore
--   derives `today` server-side in UTC and no route or island sends a date.
--   See CLAUDE.md → _Domain schema_ for the column-scoped rule agreed with S-03.
--
-- Behaviour only: no table, column, type, grant, or other policy is touched, so
-- `npm run db:types` is not part of this change. Safe against a populated
-- database — a policy relaxation needs no backfill.
--
-- ROLLBACK: rename back, then restore the `> current_date` predicate. Neither
-- direction destroys data.

alter policy dosage_changes_delete_future_own on public.dosage_changes
  using ((select auth.uid()) = user_id and effective_date >= current_date);

-- The old name asserts the old rule. Renaming keeps the policy set
-- self-describing; no pgTAP assertion references a policy by name, so nothing
-- downstream is pinned to the old one.
alter policy dosage_changes_delete_future_own on public.dosage_changes
  rename to dosage_changes_delete_uncommitted_own;
