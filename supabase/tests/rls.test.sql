-- RLS isolation — the single property standing between the anon key and other
-- people's medical data (PRD: "accessible only to that authenticated user").
--
-- Per table, three assertions: user A sees exactly their own rows, sees none of
-- user B's, and cannot insert a row carrying B's user_id.
--
-- Seeding runs as `postgres`, which owns these tables and therefore bypasses
-- RLS (the tables are not FORCE ROW LEVEL SECURITY). Assertions run as
-- `authenticated` with request.jwt.claims set, which is what PostgREST does.

set client_min_messages to warning;
create extension if not exists pgtap with schema extensions;

begin;

select plan(25);

-- ---------------------------------------------------------------------------
-- Table privileges — the layer BELOW the policies
--
-- RLS grants nothing. A reachable table needs both a GRANT and a permissive
-- policy, and until 20260821182457 this schema only ever had the second: it
-- inherited DML from a Supabase platform default that later changed, and every
-- table silently became unreachable on a fresh stack. These six assertions
-- exist so that can never again pass unnoticed — they fail if a migration
-- stops stating the privilege, rather than trusting one to be inherited.
--
-- Deliberately filtered to the four DML privileges. `authenticated` also holds
-- REFERENCES / TRIGGER / TRUNCATE from the platform's default ACL; asserting
-- the exact set (pgTAP's table_privs_are) would couple this suite to that
-- inherited default — the very dependency being removed. These run before the
-- role switch below, as `postgres`.
-- ---------------------------------------------------------------------------

select is(
  (select string_agg(privilege_type, ',' order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'specialists'
      and grantee = 'authenticated'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  'DELETE,INSERT,SELECT,UPDATE',
  'grants: authenticated holds all four DML privileges on specialists');

select is(
  (select string_agg(privilege_type, ',' order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'medications'
      and grantee = 'authenticated'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  'DELETE,INSERT,SELECT,UPDATE',
  'grants: authenticated holds all four DML privileges on medications');

select is(
  (select string_agg(privilege_type, ',' order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'dosage_changes'
      and grantee = 'authenticated'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  'DELETE,INSERT,SELECT,UPDATE',
  'grants: authenticated holds all four DML privileges on dosage_changes');

select is(
  (select string_agg(privilege_type, ',' order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'supply_events'
      and grantee = 'authenticated'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  'DELETE,INSERT,SELECT,UPDATE',
  'grants: authenticated holds all four DML privileges on supply_events');

select is(
  (select string_agg(privilege_type, ',' order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'visits'
      and grantee = 'authenticated'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  'DELETE,INSERT,SELECT,UPDATE',
  'grants: authenticated holds all four DML privileges on visits');

-- anon is granted nothing: the app has no anonymous data path, and an
-- anonymous reader reaching a domain table would be a middleware bug.
--
-- All five tables, not just specialists. On 2026-08-25 the cloud project was
-- found carrying the older platform default's anon grants on every one of
-- them, so a single-table assertion would have gone green while four tables
-- stayed exposed to the same defect. The migration now revokes explicitly and
-- these assert it held.
select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'specialists'
      and grantee = 'anon'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0,
  'grants: anon holds no DML privilege on specialists');

select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'medications'
      and grantee = 'anon'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0,
  'grants: anon holds no DML privilege on medications');

select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'dosage_changes'
      and grantee = 'anon'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0,
  'grants: anon holds no DML privilege on dosage_changes');

select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'supply_events'
      and grantee = 'anon'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0,
  'grants: anon holds no DML privilege on supply_events');

select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'visits'
      and grantee = 'anon'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0,
  'grants: anon holds no DML privilege on visits');

-- ---------------------------------------------------------------------------
-- Fixtures: two users, each owning one row in every table
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('a0000000-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-00000000000b');

insert into public.specialists (id, user_id, name, specialty) values
  ('51000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'Dr A', 'cardiology'),
  ('51000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'Dr B', 'neurology');

insert into public.medications (id, user_id, specialist_id, name, expiry_date) values
  ('d1000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000a', 'Med A', '2027-01-01'),
  ('d1000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', '51000000-0000-0000-0000-00000000000b', 'Med B', '2027-01-01');

insert into public.dosage_changes (id, user_id, medication_id, daily_dosage, effective_date) values
  ('dc000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 1, '2026-01-01'),
  ('dc000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-00000000000b', 1, '2026-01-01');

insert into public.supply_events (id, user_id, medication_id, event_type, quantity_delta, occurred_on) values
  ('5e000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'refill', 30, '2026-01-01'),
  ('5e000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-00000000000b', 'refill', 30, '2026-01-01');

insert into public.visits (id, user_id, specialist_id, visit_date) values
  ('12000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000a', '2026-02-01'),
  ('12000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', '51000000-0000-0000-0000-00000000000b', '2026-02-01');

-- ---------------------------------------------------------------------------
-- Act as user A
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- specialists (FR-003)
select is((select count(*) from public.specialists)::int, 1,
  'specialists: A sees exactly their own row');
select is((select count(*) from public.specialists
           where user_id = 'b0000000-0000-0000-0000-00000000000b')::int, 0,
  'specialists: A sees none of B''s rows');
select throws_ok($$
    insert into public.specialists (user_id, name, specialty)
    values ('b0000000-0000-0000-0000-00000000000b', 'Smuggled', 'oncology')
  $$, '42501', null,
  'specialists: A cannot insert a row owned by B');

-- medications (FR-004)
select is((select count(*) from public.medications)::int, 1,
  'medications: A sees exactly their own row');
select is((select count(*) from public.medications
           where user_id = 'b0000000-0000-0000-0000-00000000000b')::int, 0,
  'medications: A sees none of B''s rows');
select throws_ok($$
    insert into public.medications (user_id, specialist_id, name, expiry_date)
    values ('b0000000-0000-0000-0000-00000000000b',
            '51000000-0000-0000-0000-00000000000b', 'Smuggled', '2027-01-01')
  $$, '42501', null,
  'medications: A cannot insert a row owned by B');

-- dosage_changes (FR-006)
select is((select count(*) from public.dosage_changes)::int, 1,
  'dosage_changes: A sees exactly their own row');
select is((select count(*) from public.dosage_changes
           where user_id = 'b0000000-0000-0000-0000-00000000000b')::int, 0,
  'dosage_changes: A sees none of B''s rows');
select throws_ok($$
    insert into public.dosage_changes (user_id, medication_id, daily_dosage, effective_date)
    values ('b0000000-0000-0000-0000-00000000000b',
            'd1000000-0000-0000-0000-00000000000b', 2, '2026-06-01')
  $$, '42501', null,
  'dosage_changes: A cannot insert a row owned by B');

-- supply_events (FR-011)
select is((select count(*) from public.supply_events)::int, 1,
  'supply_events: A sees exactly their own row');
select is((select count(*) from public.supply_events
           where user_id = 'b0000000-0000-0000-0000-00000000000b')::int, 0,
  'supply_events: A sees none of B''s rows');
select throws_ok($$
    insert into public.supply_events (user_id, medication_id, event_type, quantity_delta, occurred_on)
    values ('b0000000-0000-0000-0000-00000000000b',
            'd1000000-0000-0000-0000-00000000000b', 'refill', 10, '2026-06-01')
  $$, '42501', null,
  'supply_events: A cannot insert a row owned by B');

-- visits (FR-009/FR-010)
select is((select count(*) from public.visits)::int, 1,
  'visits: A sees exactly their own row');
select is((select count(*) from public.visits
           where user_id = 'b0000000-0000-0000-0000-00000000000b')::int, 0,
  'visits: A sees none of B''s rows');
select throws_ok($$
    insert into public.visits (user_id, specialist_id, visit_date)
    values ('b0000000-0000-0000-0000-00000000000b',
            '51000000-0000-0000-0000-00000000000b', '2026-06-01')
  $$, '42501', null,
  'visits: A cannot insert a row owned by B');

select * from finish();

rollback;
