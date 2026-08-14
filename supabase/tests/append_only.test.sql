-- Append-only enforcement — the policy asymmetry from plan.md Phase 1 §8.
-- A future migration that loosens one of these grants should fail here loudly.
--
-- IMPORTANT: a command with RLS enabled and NO policy is not an error. It
-- matches zero rows and returns success. So every assertion below checks the
-- AFFECTED ROW COUNT and the survival of the row — never that an exception was
-- raised. Asserting `throws_ok` here would pass for the wrong reason.

set client_min_messages to warning;
create extension if not exists pgtap with schema extensions;

begin;

select plan(13);

-- ---------------------------------------------------------------------------
-- Fixtures: one user owning one row in each append-constrained table
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('a0000000-0000-0000-0000-00000000000a');

insert into public.specialists (id, user_id, name, specialty) values
  ('51000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'Dr A', 'cardiology');

insert into public.medications (id, user_id, specialist_id, name, expiry_date) values
  ('d1000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000a', 'Med A', '2027-01-01');

-- one dosage change already in force, one not yet effective
insert into public.dosage_changes (id, user_id, medication_id, daily_dosage, effective_date) values
  ('dc000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 1, current_date - 10),
  ('dc000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 2, current_date + 10);

insert into public.supply_events (id, user_id, medication_id, event_type, quantity_delta, occurred_on) values
  ('5e000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'refill', 30, current_date - 10);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- medications: no DELETE policy — FR-007 requires archival, not deletion
-- ---------------------------------------------------------------------------

with d as (
  delete from public.medications
  where id = 'd1000000-0000-0000-0000-00000000000a' returning 1
)
select is((select count(*) from d)::int, 0,
  'medications: DELETE affects zero rows (no DELETE policy)');

select is((select count(*) from public.medications
           where id = 'd1000000-0000-0000-0000-00000000000a')::int, 1,
  'medications: the row survives the delete attempt');

-- the sanctioned path, as a positive control: archival IS permitted
with u as (
  update public.medications set archived_at = now()
  where id = 'd1000000-0000-0000-0000-00000000000a' returning 1
)
select is((select count(*) from u)::int, 1,
  'medications: UPDATE setting archived_at succeeds (FR-007 archival path)');

-- ---------------------------------------------------------------------------
-- supply_events: SELECT and INSERT only — corrections are new adjustment rows
-- ---------------------------------------------------------------------------

with u as (
  update public.supply_events set quantity_delta = 999
  where id = '5e000000-0000-0000-0000-00000000000a' returning 1
)
select is((select count(*) from u)::int, 0,
  'supply_events: UPDATE affects zero rows (no UPDATE policy)');

select is((select quantity_delta from public.supply_events
           where id = '5e000000-0000-0000-0000-00000000000a'), 30::numeric,
  'supply_events: quantity_delta is unchanged by the update attempt');

with d as (
  delete from public.supply_events
  where id = '5e000000-0000-0000-0000-00000000000a' returning 1
)
select is((select count(*) from d)::int, 0,
  'supply_events: DELETE affects zero rows (no DELETE policy)');

select is((select count(*) from public.supply_events
           where id = '5e000000-0000-0000-0000-00000000000a')::int, 1,
  'supply_events: the ledger row survives the delete attempt');

-- an adjustment row is how a correction is actually made
select lives_ok($$
    insert into public.supply_events (medication_id, event_type, quantity_delta, occurred_on)
    values ('d1000000-0000-0000-0000-00000000000a', 'adjustment', -5, current_date)
  $$,
  'supply_events: a correcting adjustment row can be appended');

-- ---------------------------------------------------------------------------
-- dosage_changes: immutable; deletable only while not yet effective
-- ---------------------------------------------------------------------------

with u as (
  update public.dosage_changes set daily_dosage = 99
  where id = 'dc000000-0000-0000-0000-0000000000a1' returning 1
)
select is((select count(*) from u)::int, 0,
  'dosage_changes: UPDATE affects zero rows (the series is immutable)');

select is((select daily_dosage from public.dosage_changes
           where id = 'dc000000-0000-0000-0000-0000000000a1'), 1::numeric,
  'dosage_changes: daily_dosage is unchanged by the update attempt');

with d as (
  delete from public.dosage_changes
  where id = 'dc000000-0000-0000-0000-0000000000a1' returning 1
)
select is((select count(*) from d)::int, 0,
  'dosage_changes: DELETE of an already-effective row affects zero rows');

select is((select count(*) from public.dosage_changes
           where id = 'dc000000-0000-0000-0000-0000000000a1')::int, 1,
  'dosage_changes: the already-effective row survives');

with d as (
  delete from public.dosage_changes
  where id = 'dc000000-0000-0000-0000-0000000000a2' returning 1
)
select is((select count(*) from d)::int, 1,
  'dosage_changes: DELETE of a not-yet-effective row succeeds');

select * from finish();

rollback;
