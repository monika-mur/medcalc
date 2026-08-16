-- MedCalc domain schema — roadmap F-01 (change: domain-schema-foundation)
--
-- Five tables, two enums, one migration. Every invariant here is declarative:
-- an RLS policy, a CHECK, a foreign key, or a uniqueness constraint. There are
-- deliberately NO trigger functions, NO SECURITY DEFINER code, and NO RPC
-- functions in this schema — see plan.md → "Decided: no procedural database
-- code". New invariants belong in constraints; reaching for a trigger is a
-- signal to re-plan, not to write one.
--
-- Three shaping principles:
--   1. Mutable state that must be preserved is not a column. Dosage lives only
--      in dosage_changes; quantity lives only in supply_events deltas.
--   2. Ownership is denormalised onto every table (user_id DEFAULT auth.uid())
--      so RLS is a uniform auth.uid() = user_id, then made sound with
--      composite foreign keys.
--   3. Append-only is enforced by the RLS grant asymmetry, not by discipline.
--
-- No extensions are enabled here: gen_random_uuid() is Postgres 13+ core and
-- config.toml pins major_version 17, so pgcrypto is not required. pgTAP is
-- installed by the test suite, into the `extensions` schema.

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

create type public.medication_form as enum ('solid', 'liquid');

create type public.supply_event_type as enum ('refill', 'recount', 'adjustment');

-- ---------------------------------------------------------------------------
-- specialists — FR-003. The managed entity, so medication↔visit linkage is by
-- key rather than by spelling.
-- ---------------------------------------------------------------------------

create table public.specialists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  name text not null,
  specialty text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint specialists_name_not_blank check (length(btrim(name)) > 0),
  constraint specialists_specialty_not_blank check (length(btrim(specialty)) > 0),
  -- composite-FK target: lets children prove they share their parent's owner
  constraint specialists_id_user_id_key unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- medications — the core entity. Carries only facts that do not change over
-- time: deliberately no daily_dosage and no quantity_on_hand column.
--
-- FR-008's liquid sub-type fields live here as nullable columns rather than in
-- a 1:1 table, so creating a liquid medication is ONE insert. PostgREST has no
-- multi-statement transaction, so a two-table design could not be made atomic.
-- ---------------------------------------------------------------------------

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  specialist_id uuid not null,
  name text not null,
  form public.medication_form not null default 'solid',
  expiry_date date not null,

  -- liquid sub-type (FR-008); all null for a solid medication
  container_capacity numeric null,
  estimated_daily_consumption numeric null,
  post_opening_expiry_days integer null,
  opened_on date null,

  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint medications_name_not_blank check (length(btrim(name)) > 0),

  -- NULL-safe by definition: a comparison against NULL is unknown, which a
  -- CHECK accepts. No `form` guard needed.
  constraint medications_container_capacity_positive
    check (container_capacity > 0),
  constraint medications_daily_consumption_positive
    check (estimated_daily_consumption > 0),
  constraint medications_post_opening_expiry_positive
    check (post_opening_expiry_days > 0),

  -- The liquid fields are present exactly when the medication is liquid, and
  -- a solid carries NONE of them.
  --
  -- Written as a CASE rather than the tempting boolean equality
  --   (form = 'liquid') = (a is not null and b is not null and c is not null)
  -- because that form only rejects a solid carrying ALL THREE fields: with one
  -- stray field the right-hand side is still false, so false = false passes.
  -- A partially-populated solid is the likelier mistake, so it must fail.
  --
  -- opened_on is excluded from the liquid branch: NULL on a liquid means
  -- "not yet opened", which is a legal state.
  constraint medications_liquid_fields_match_form
    check (
      case form
        when 'liquid' then container_capacity is not null
                     and estimated_daily_consumption is not null
                     and post_opening_expiry_days is not null
        else container_capacity is null
         and estimated_daily_consumption is null
         and post_opening_expiry_days is null
         and opened_on is null
      end
    ),

  constraint medications_id_user_id_key unique (id, user_id),

  -- composite FK: a medication cannot point at another user's specialist.
  -- RESTRICT because the per-entity deletion rule forbids orphaning it.
  constraint medications_specialist_fk
    foreign key (specialist_id, user_id)
    references public.specialists (id, user_id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- dosage_changes — the SOLE home of dosage. The row created with a medication
-- is its initial dosage; each later row is a scheduled or applied change.
-- FR-006's segmental calculation reads this series directly.
--
-- daily_dosage = 0 is legal and meaningful: "I have stopped taking this",
-- keeping the medication visible and its history intact. That is distinct from
-- archival (FR-007), which hides the medication. Only negatives are rejected.
-- ---------------------------------------------------------------------------

create table public.dosage_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  medication_id uuid not null,
  daily_dosage numeric not null,
  effective_date date not null,
  recorded_at timestamptz not null default now(),

  constraint dosage_changes_daily_dosage_non_negative check (daily_dosage >= 0),
  -- one dosage in force per medication per day
  constraint dosage_changes_medication_effective_date_key
    unique (medication_id, effective_date),

  constraint dosage_changes_medication_fk
    foreign key (medication_id, user_id)
    references public.medications (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- supply_events — the delta ledger for quantity on hand, with recount events
-- carrying the reality check.
--
-- The application supplies counted_quantity, projected_quantity AND
-- quantity_delta on a recount; the CHECK below rejects any row where the three
-- disagree. That is the whole of the enforcement — nothing computes the delta
-- server-side, because the projection depends on the consumption engine S-04
-- builds in TypeScript, and duplicating that arithmetic in SQL would create a
-- second implementation of the PRD's guarded calculation.
-- ---------------------------------------------------------------------------

create table public.supply_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  medication_id uuid not null,
  event_type public.supply_event_type not null,
  quantity_delta numeric not null,
  counted_quantity numeric null,
  projected_quantity numeric null,
  occurred_on date not null,
  recorded_at timestamptz not null default now(),
  note text null,

  -- The recount fields are present exactly when the event is a recount, and a
  -- non-recount carries NEITHER of them.
  --
  -- Written as a CASE, not as `(event_type = 'recount') = (a is not null and b
  -- is not null)`: for an adjustment carrying one stray field the boolean form
  -- has false on both sides and passes, so it only rejects a non-recount
  -- carrying BOTH. Same defect shape as the liquid CHECK on medications above.
  constraint supply_events_recount_fields_match_type
    check (
      case event_type
        when 'recount' then counted_quantity is not null
                        and projected_quantity is not null
        else counted_quantity is null
         and projected_quantity is null
      end
    ),
  -- a recount's delta IS the discrepancy. numeric is exact decimal, so this
  -- equality is not subject to floating-point drift.
  constraint supply_events_recount_delta_is_discrepancy
    check (event_type <> 'recount'
             or quantity_delta = counted_quantity - projected_quantity),
  -- a refill can only add
  constraint supply_events_refill_is_positive
    check (event_type <> 'refill' or quantity_delta > 0),

  constraint supply_events_medication_fk
    foreign key (medication_id, user_id)
    references public.medications (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- visits — FR-009/FR-010. Hard-deletable per the per-entity deletion decision;
-- nothing references visits, so deletion is always safe at the database level.
-- ---------------------------------------------------------------------------

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  specialist_id uuid not null,
  visit_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint visits_specialist_fk
    foreign key (specialist_id, user_id)
    references public.specialists (id, user_id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- Indexes — the access patterns S-04's dashboard will use.
-- ---------------------------------------------------------------------------

create index specialists_user_id_idx on public.specialists (user_id);

create index medications_user_id_active_idx on public.medications (user_id)
  where archived_at is null;
create index medications_specialist_id_idx on public.medications (specialist_id);

create index dosage_changes_medication_effective_idx
  on public.dosage_changes (medication_id, effective_date desc);

create index supply_events_medication_occurred_idx
  on public.supply_events (medication_id, occurred_on, recorded_at);

create index visits_user_visit_date_idx on public.visits (user_id, visit_date);
create index visits_specialist_visit_date_idx
  on public.visits (specialist_id, visit_date);

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- PostgREST executes every request as the end user, so RLS is what catches a
-- route handler that forgets a user_id filter. The grant ASYMMETRY is also the
-- append-only guarantee:
--
--   specialists     select insert update delete
--   medications     select insert update  ✗ delete  — archival only (FR-007)
--   dosage_changes  select insert  ✗ update  delete only while future-dated
--   supply_events   select insert  ✗ update  ✗ delete — corrections are new rows
--   visits          select insert update delete
--
-- A table with RLS enabled and no policy for a command denies that command.
-- The missing policies below are therefore deliberate, not omissions.
-- ---------------------------------------------------------------------------

alter table public.specialists enable row level security;
alter table public.medications enable row level security;
alter table public.dosage_changes enable row level security;
alter table public.supply_events enable row level security;
alter table public.visits enable row level security;

-- specialists — full CRUD over own rows
create policy specialists_select_own on public.specialists
  for select to authenticated using (auth.uid() = user_id);
create policy specialists_insert_own on public.specialists
  for insert to authenticated with check (auth.uid() = user_id);
create policy specialists_update_own on public.specialists
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy specialists_delete_own on public.specialists
  for delete to authenticated using (auth.uid() = user_id);

-- medications — no DELETE policy: FR-007 requires archival (set archived_at),
-- so deletion is denied at the database rather than by application habit.
create policy medications_select_own on public.medications
  for select to authenticated using (auth.uid() = user_id);
create policy medications_insert_own on public.medications
  for insert to authenticated with check (auth.uid() = user_id);
create policy medications_update_own on public.medications
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- dosage_changes — no UPDATE policy: the series is immutable. DELETE is
-- allowed only while the change has not yet taken effect; a change already in
-- force is corrected by inserting a new row, never by rewriting history.
-- NOTE: current_date is UTC, so "still in the future?" can be off by a day's
-- fraction near the user's midnight. Accepted — see plan.md.
create policy dosage_changes_select_own on public.dosage_changes
  for select to authenticated using (auth.uid() = user_id);
create policy dosage_changes_insert_own on public.dosage_changes
  for insert to authenticated with check (auth.uid() = user_id);
create policy dosage_changes_delete_future_own on public.dosage_changes
  for delete to authenticated
  using (auth.uid() = user_id and effective_date > current_date);

-- supply_events — SELECT and INSERT only. The ledger is append-only; a
-- correction is a new `adjustment` row, never an edit or a deletion.
create policy supply_events_select_own on public.supply_events
  for select to authenticated using (auth.uid() = user_id);
create policy supply_events_insert_own on public.supply_events
  for insert to authenticated with check (auth.uid() = user_id);

-- visits — full CRUD over own rows (FR-010)
create policy visits_select_own on public.visits
  for select to authenticated using (auth.uid() = user_id);
create policy visits_insert_own on public.visits
  for insert to authenticated with check (auth.uid() = user_id);
create policy visits_update_own on public.visits
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy visits_delete_own on public.visits
  for delete to authenticated using (auth.uid() = user_id);
