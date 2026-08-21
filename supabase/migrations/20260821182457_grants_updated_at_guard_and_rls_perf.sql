-- Explicit table grants, an `updated_at` floor, and the F4 RLS performance
-- rewrite. Three concerns, one migration, because all three are DDL against a
-- schema that carries no rows in any environment yet — nothing can be rejected
-- retroactively, and the policy set is still small enough to rewrite in one
-- pass.
--
-- 1. GRANTS — these REPLACE AN INHERITED DEFAULT; they do not widen access.
--    20260813185255_domain_schema.sql issues no GRANT at all and has always
--    relied on Supabase historically granting DML on new `public` tables to
--    `anon` and `authenticated`. That default changed: the Postgres image
--    bundled with CLI 2.115.0 ships a restricted default ACL for the `postgres`
--    role in `public` (`authenticated=Dxtm` — TRUNCATE/REFERENCES/TRIGGER/
--    MAINTAIN but no SELECT/INSERT/UPDATE/DELETE). Migrations run as `postgres`
--    and these tables are owned by `postgres`, so on a freshly reset stack
--    every domain table became unreachable and pgTAP fell from 57/57 to 14/57.
--    RLS policies grant no privileges — a working table needs BOTH a GRANT and
--    a permissive policy, and this schema only ever had the second.
--
--    The grants are uniform (all four DML on all five tables) rather than
--    mirrored to each table's policy set. Mirroring is strictly stronger and
--    was measured at 44/57: withholding a privilege turns "RLS matched zero
--    rows" into `42501`, which append_only.test.sql, CLAUDE.md and the API
--    error contract all encode differently. Tightening is queued as S-05 in
--    context/changes/domain-schema-foundation/follow-ups/review-fixes.md.
--
--    Nothing is granted to `anon`. Every policy is `to authenticated`; an
--    anonymous visitor reaching a domain table is a middleware bug, not a
--    supported path. There are no sequences to grant — every PK is
--    gen_random_uuid().
--
-- 2. UPDATED_AT FLOOR — settles the maintainer decision F-01's plan review
--    deferred to S-01 by name. The CHECK closes BACKDATING only. The column
--    stays client-writable forward in time; that half is closed in the
--    application layer, by the data module building its update payload
--    explicitly instead of spreading a request body (see S-01 Phase 3).
--
-- 3. F4 POLICY REWRITE — behaviour-identical. Wrapping `auth.uid()` in a
--    scalar subquery lets the planner hoist it into an InitPlan evaluated once
--    per statement rather than once per row. 19 bare occurrences across 16
--    policies; the 5 `default auth.uid()` column clauses are deliberately NOT
--    touched, since a column default is evaluated per inserted row regardless
--    and the optimisation cannot apply. `alter policy` rather than
--    drop-and-recreate, so no window exists in which a table is unprotected.
--
-- The existing suites are the regression net for all three: 57 pgTAP
-- assertions and 15 Vitest integration tests, none of which should change
-- behaviour as a result of this migration.

-- ---------------------------------------------------------------------------
-- 1. Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.specialists    to authenticated;
grant select, insert, update, delete on public.medications    to authenticated;
grant select, insert, update, delete on public.dosage_changes to authenticated;
grant select, insert, update, delete on public.supply_events  to authenticated;
grant select, insert, update, delete on public.visits         to authenticated;

-- ---------------------------------------------------------------------------
-- 2. updated_at may not precede created_at
-- ---------------------------------------------------------------------------

alter table public.specialists
  add constraint specialists_updated_at_not_before_created_at
  check (updated_at >= created_at);

alter table public.medications
  add constraint medications_updated_at_not_before_created_at
  check (updated_at >= created_at);

alter table public.visits
  add constraint visits_updated_at_not_before_created_at
  check (updated_at >= created_at);

-- ---------------------------------------------------------------------------
-- 3. F4: wrap auth.uid() so it evaluates once per statement, not once per row
-- ---------------------------------------------------------------------------

-- specialists (5 occurrences)
alter policy specialists_select_own on public.specialists
  using ((select auth.uid()) = user_id);
alter policy specialists_insert_own on public.specialists
  with check ((select auth.uid()) = user_id);
alter policy specialists_update_own on public.specialists
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy specialists_delete_own on public.specialists
  using ((select auth.uid()) = user_id);

-- medications (4 occurrences)
alter policy medications_select_own on public.medications
  using ((select auth.uid()) = user_id);
alter policy medications_insert_own on public.medications
  with check ((select auth.uid()) = user_id);
alter policy medications_update_own on public.medications
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- dosage_changes (3 occurrences) — the DELETE policy keeps its effective_date
-- guard; only the auth.uid() half of the predicate changes.
alter policy dosage_changes_select_own on public.dosage_changes
  using ((select auth.uid()) = user_id);
alter policy dosage_changes_insert_own on public.dosage_changes
  with check ((select auth.uid()) = user_id);
alter policy dosage_changes_delete_future_own on public.dosage_changes
  using ((select auth.uid()) = user_id and effective_date > current_date);

-- supply_events (2 occurrences)
alter policy supply_events_select_own on public.supply_events
  using ((select auth.uid()) = user_id);
alter policy supply_events_insert_own on public.supply_events
  with check ((select auth.uid()) = user_id);

-- visits (5 occurrences)
alter policy visits_select_own on public.visits
  using ((select auth.uid()) = user_id);
alter policy visits_insert_own on public.visits
  with check ((select auth.uid()) = user_id);
alter policy visits_update_own on public.visits
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy visits_delete_own on public.visits
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 4. Indexes on the column RLS filters by
-- ---------------------------------------------------------------------------
-- Both tables are indexed on (medication_id, …) only, while RLS injects a
-- user_id predicate into every read. Matters most for S-04's dashboard.

create index dosage_changes_user_id_idx on public.dosage_changes (user_id);
create index supply_events_user_id_idx  on public.supply_events  (user_id);
