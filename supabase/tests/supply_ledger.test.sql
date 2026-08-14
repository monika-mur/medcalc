-- Supply ledger — the recount CHECK constraints.
--
-- Nothing computes the recount delta server-side: the projection depends on the
-- consumption engine S-04 builds in TypeScript, and duplicating that arithmetic
-- in SQL would create a second implementation of the PRD's guarded calculation.
-- The application supplies counted_quantity, projected_quantity AND
-- quantity_delta; the CHECK holding the identity between them is the whole of
-- the enforcement. So the first assertion below — an inconsistent delta is
-- REJECTED — is the most important one in this suite. Under the earlier
-- trigger-based draft it was unreachable, because a trigger overwrote the value.

set client_min_messages to warning;
create extension if not exists pgtap with schema extensions;

begin;

select plan(12);

insert into auth.users (id) values ('a0000000-0000-0000-0000-00000000000a');

insert into public.specialists (id, user_id, name, specialty) values
  ('51000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'Dr A', 'cardiology');

insert into public.medications (id, user_id, specialist_id, name, expiry_date) values
  ('d1000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', '51000000-0000-0000-0000-00000000000a', 'Med A', '2027-01-01');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- The identity: quantity_delta = counted_quantity - projected_quantity
-- ---------------------------------------------------------------------------

-- THE load-bearing assertion: a caller cannot lie about the discrepancy.
select throws_ok($$
    insert into public.supply_events
      (medication_id, event_type, quantity_delta, counted_quantity, projected_quantity, occurred_on)
    values ('d1000000-0000-0000-0000-00000000000a', 'recount', 0, 25, 28, current_date)
  $$, '23514', null,
  'recount: a quantity_delta contradicting counted - projected is rejected');

select lives_ok($$
    insert into public.supply_events
      (id, medication_id, event_type, quantity_delta, counted_quantity, projected_quantity, occurred_on)
    values ('5e000000-0000-0000-0000-0000000000c1',
            'd1000000-0000-0000-0000-00000000000a', 'recount', -3, 25, 28, current_date)
  $$,
  'recount: a consistent row (25 counted vs 28 projected, delta -3) is accepted');

select is((select quantity_delta from public.supply_events
           where id = '5e000000-0000-0000-0000-0000000000c1'), (-3)::numeric,
  'recount: the discrepancy reads back from quantity_delta in one column');

-- the "nothing to notify" case
select lives_ok($$
    insert into public.supply_events
      (id, medication_id, event_type, quantity_delta, counted_quantity, projected_quantity, occurred_on)
    values ('5e000000-0000-0000-0000-0000000000c2',
            'd1000000-0000-0000-0000-00000000000a', 'recount', 0, 28, 28, current_date)
  $$,
  'recount: a matching count is accepted');

select is((select quantity_delta from public.supply_events
           where id = '5e000000-0000-0000-0000-0000000000c2'), 0::numeric,
  'recount: a matching count stores quantity_delta = 0');

-- the signal downstream slices read is `quantity_delta <> 0` on a recount row
select is((select count(*) from public.supply_events
           where event_type = 'recount' and quantity_delta <> 0)::int, 1,
  'recount: exactly one of the two recounts flags a discrepancy');

-- ---------------------------------------------------------------------------
-- Recount field presence: the counts are present exactly when it is a recount
-- ---------------------------------------------------------------------------

select throws_ok($$
    insert into public.supply_events
      (medication_id, event_type, quantity_delta, projected_quantity, occurred_on)
    values ('d1000000-0000-0000-0000-00000000000a', 'recount', -3, 28, current_date)
  $$, '23514', null,
  'recount: a row missing counted_quantity is rejected');

select throws_ok($$
    insert into public.supply_events
      (medication_id, event_type, quantity_delta, counted_quantity, occurred_on)
    values ('d1000000-0000-0000-0000-00000000000a', 'recount', -3, 25, current_date)
  $$, '23514', null,
  'recount: a row missing projected_quantity is rejected');

select throws_ok($$
    insert into public.supply_events
      (medication_id, event_type, quantity_delta, counted_quantity, projected_quantity, occurred_on)
    values ('d1000000-0000-0000-0000-00000000000a', 'refill', 10, 25, 28, current_date)
  $$, '23514', null,
  'refill: a non-recount row carrying the recount fields is rejected');

-- ---------------------------------------------------------------------------
-- Refill direction, and the adjustment escape hatch
-- ---------------------------------------------------------------------------

select throws_ok($$
    insert into public.supply_events (medication_id, event_type, quantity_delta, occurred_on)
    values ('d1000000-0000-0000-0000-00000000000a', 'refill', 0, current_date)
  $$, '23514', null,
  'refill: a zero delta is rejected — a refill can only add');

select throws_ok($$
    insert into public.supply_events (medication_id, event_type, quantity_delta, occurred_on)
    values ('d1000000-0000-0000-0000-00000000000a', 'refill', -5, current_date)
  $$, '23514', null,
  'refill: a negative delta is rejected — a refill can only add');

select lives_ok($$
    insert into public.supply_events (medication_id, event_type, quantity_delta, occurred_on)
    values ('d1000000-0000-0000-0000-00000000000a', 'adjustment', -5, current_date)
  $$,
  'adjustment: a negative delta is accepted — this is the correction path');

select * from finish();

rollback;
