-- Structural invariants — the constraints that make illegal states
-- unrepresentable, and that replaced the three triggers an earlier draft of the
-- plan carried (plan.md → "Decided: no procedural database code").

set client_min_messages to warning;
create extension if not exists pgtap with schema extensions;

begin;

select plan(18);

insert into auth.users (id) values
  ('a0000000-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-00000000000b');

insert into public.specialists (id, user_id, name, specialty) values
  ('51000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'Dr A', 'cardiology'),
  ('51000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'Dr B', 'neurology');

insert into public.medications (id, user_id, specialist_id, name, expiry_date) values
  ('d1000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000a', 'Med A', '2027-01-01');

insert into public.visits (id, user_id, specialist_id, visit_date) values
  ('12000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000a', '2026-02-01');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- FR-008 liquid sub-type: the fields are present exactly when form = 'liquid'
--
-- The three "solid carrying ONE stray field" cases below are the regression
-- tests for the amended CHECK. The boolean-equality form the plan originally
-- specified passed all three: with one field set, both sides evaluate to false,
-- and false = false is true. Only the CASE form rejects them.
-- ---------------------------------------------------------------------------

select throws_ok($$
    insert into public.medications
      (specialist_id, name, form, expiry_date, estimated_daily_consumption, post_opening_expiry_days)
    values ('51000000-0000-0000-0000-00000000000a', 'Syrup', 'liquid', '2027-01-01', 5, 30)
  $$, '23514', null,
  'liquid: a row missing container_capacity is rejected');

select throws_ok($$
    insert into public.medications
      (specialist_id, name, form, expiry_date, container_capacity, post_opening_expiry_days)
    values ('51000000-0000-0000-0000-00000000000a', 'Syrup', 'liquid', '2027-01-01', 200, 30)
  $$, '23514', null,
  'liquid: a row missing estimated_daily_consumption is rejected');

select throws_ok($$
    insert into public.medications
      (specialist_id, name, form, expiry_date, container_capacity, estimated_daily_consumption)
    values ('51000000-0000-0000-0000-00000000000a', 'Syrup', 'liquid', '2027-01-01', 200, 5)
  $$, '23514', null,
  'liquid: a row missing post_opening_expiry_days is rejected');

select throws_ok($$
    insert into public.medications
      (specialist_id, name, form, expiry_date, container_capacity)
    values ('51000000-0000-0000-0000-00000000000a', 'Tablet', 'solid', '2027-01-01', 200)
  $$, '23514', null,
  'solid: a row carrying only container_capacity is rejected');

select throws_ok($$
    insert into public.medications
      (specialist_id, name, form, expiry_date, estimated_daily_consumption)
    values ('51000000-0000-0000-0000-00000000000a', 'Tablet', 'solid', '2027-01-01', 5)
  $$, '23514', null,
  'solid: a row carrying only estimated_daily_consumption is rejected');

select throws_ok($$
    insert into public.medications
      (specialist_id, name, form, expiry_date, post_opening_expiry_days)
    values ('51000000-0000-0000-0000-00000000000a', 'Tablet', 'solid', '2027-01-01', 30)
  $$, '23514', null,
  'solid: a row carrying only post_opening_expiry_days is rejected');

select throws_ok($$
    insert into public.medications
      (specialist_id, name, form, expiry_date, opened_on)
    values ('51000000-0000-0000-0000-00000000000a', 'Tablet', 'solid', '2027-01-01', current_date)
  $$, '23514', null,
  'solid: an opening date is meaningless and is rejected');

-- a complete liquid is ONE insert — PostgREST has no multi-statement transaction
select lives_ok($$
    insert into public.medications
      (specialist_id, name, form, expiry_date, container_capacity, estimated_daily_consumption, post_opening_expiry_days)
    values ('51000000-0000-0000-0000-00000000000a', 'Syrup', 'liquid', '2027-01-01', 200, 5, 30)
  $$,
  'liquid: a complete row is created in a single atomic insert, unopened');

select lives_ok($$
    insert into public.medications
      (specialist_id, name, form, expiry_date, container_capacity, estimated_daily_consumption, post_opening_expiry_days, opened_on)
    values ('51000000-0000-0000-0000-00000000000a', 'Syrup', 'liquid', '2027-01-01', 200, 5, 30, current_date)
  $$,
  'liquid: opened_on is accepted, making post-opening expiry computable');

select throws_ok($$
    insert into public.medications
      (specialist_id, name, form, expiry_date, container_capacity, estimated_daily_consumption, post_opening_expiry_days)
    values ('51000000-0000-0000-0000-00000000000a', 'Syrup', 'liquid', '2027-01-01', 0, 5, 30)
  $$, '23514', null,
  'liquid: a non-positive container_capacity is rejected');

-- ---------------------------------------------------------------------------
-- Ownership and referential integrity
-- ---------------------------------------------------------------------------

-- the composite FK is what makes the denormalised user_id sound
select throws_ok($$
    insert into public.medications (specialist_id, name, expiry_date)
    values ('51000000-0000-0000-0000-00000000000b', 'Cross-owner', '2027-01-01')
  $$, '23503', null,
  'medications: a row pointing at another user''s specialist is rejected');

-- ON DELETE RESTRICT: a specialist cannot vanish while medications point at it
select throws_ok($$
    delete from public.specialists where id = '51000000-0000-0000-0000-00000000000a'
  $$, '23503', null,
  'specialists: deleting a referenced specialist is restricted');

-- ---------------------------------------------------------------------------
-- Dosage series
-- ---------------------------------------------------------------------------

insert into public.dosage_changes (medication_id, daily_dosage, effective_date)
values ('d1000000-0000-0000-0000-00000000000a', 1, '2026-03-01');

select throws_ok($$
    insert into public.dosage_changes (medication_id, daily_dosage, effective_date)
    values ('d1000000-0000-0000-0000-00000000000a', 2, '2026-03-01')
  $$, '23505', null,
  'dosage_changes: two dosages on one day for one medication are rejected');

-- 0 means "stopped, keep the history" — distinct from archival (FR-007), and
-- the read-semantics anchor that makes a partial create harmless
select lives_ok($$
    insert into public.dosage_changes (medication_id, daily_dosage, effective_date)
    values ('d1000000-0000-0000-0000-00000000000a', 0, '2026-04-01')
  $$,
  'dosage_changes: daily_dosage = 0 is accepted — stopped, not archived');

select throws_ok($$
    insert into public.dosage_changes (medication_id, daily_dosage, effective_date)
    values ('d1000000-0000-0000-0000-00000000000a', -1, '2026-05-01')
  $$, '23514', null,
  'dosage_changes: a negative daily_dosage is rejected');

-- ---------------------------------------------------------------------------
-- updated_at may not precede created_at
--
-- The column has no trigger and no database-side maintainer: `default now()`
-- fires on INSERT only, and the application writes it on every update. This
-- CHECK is what makes that convention enforceable rather than merely intended.
--
-- It closes BACKDATING only. A client can still set updated_at forward, since
-- the UPDATE policies constrain no columns and the generated types expose the
-- field; that half is closed in the data module, which builds its update
-- payload explicitly instead of spreading a request body.
--
-- 4-argument throws_ok with a null message: the 3-argument form matches its
-- third argument against the raised message text, which silently passes for
-- the wrong reason (recorded in domain-schema-foundation/change.md).
-- ---------------------------------------------------------------------------

select throws_ok($$
    update public.specialists set updated_at = created_at - interval '1 second'
    where id = '51000000-0000-0000-0000-00000000000a'
  $$, '23514', null,
  'specialists: updated_at cannot be set before created_at');

select throws_ok($$
    update public.medications set updated_at = created_at - interval '1 second'
    where id = 'd1000000-0000-0000-0000-00000000000a'
  $$, '23514', null,
  'medications: updated_at cannot be set before created_at');

select throws_ok($$
    update public.visits set updated_at = created_at - interval '1 second'
    where id = '12000000-0000-0000-0000-00000000000a'
  $$, '23514', null,
  'visits: updated_at cannot be set before created_at');

select * from finish();

rollback;
