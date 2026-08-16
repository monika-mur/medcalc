# Domain Schema Foundation Implementation Plan

## Overview

Establish MedCalc's domain schema — `specialists`, `medications`, `dosage_changes`, `supply_events`, `visits` — as a single Supabase migration, built append-only from day one so that a full usage history is reconstructible (PRD Business Logic, `prd.md:127`). Prove the two properties that cannot be eyeballed (RLS isolation and recount arithmetic) with database-level tests, surface the schema to the app as generated TypeScript types, and push it to the live Supabase Cloud project.

Every invariant in this schema is enforced declaratively — RLS policies, CHECK constraints, foreign keys, uniqueness. **The migration contains no trigger functions and no `SECURITY DEFINER` code.** That is a decision, revisited during planning and recorded below under "Decided: no procedural database code"; an earlier draft of this plan carried three triggers, and each was replaced by a constraint or removed along with the table that motivated it.

This is roadmap item **F-01**, the only Foundation. Six slices (S-01 … S-06) read or write this schema; none can be planned or verified until it lands.

## Current State Analysis

- **No migrations exist.** `supabase/` contains only `config.toml` (Postgres 17, migrations enabled, `project_id = "10x-astro-starter"` — a leftover from the starter). `supabase/migrations/` must be created.
- **No domain tables, no domain types.** There is no `src/db/` directory. `src/lib/supabase.ts:11` calls `createServerClient(SUPABASE_URL, SUPABASE_KEY, …)` with no `Database` generic, so every query result today is `any`.
- **Supabase is server-only, and the anon key never reaches a browser.** `context/deployment/deploy-plan.md:41-53` provisions project `medcalc`; `SUPABASE_KEY` is the publishable/anon key, set as a Worker secret. Both vars are declared `context: "server", access: "secret"` (`astro.config.mjs:19-20`) and read from `process.env` inside Worker-only code (`src/lib/supabase.ts:5-6`). No client component imports Supabase — the auth forms are plain HTML POSTs to `/api/auth/*`. **Every PostgREST request originates in the Worker, carrying the user's JWT.** PostgREST still acts _as_ the end user, so RLS remains the barrier that a route handler forgetting a `user_id` filter runs into — but application code is unavoidably in the path of every write, which is what makes the no-triggers approach below viable. The PRD's isolation requirement is binding either way: _"accessible only to that authenticated user"_ (`prd.md:117`).
- **Auth is complete and untouched by this change.** `src/middleware.ts:12` resolves `context.locals.user` via `supabase.auth.getUser()`; `PROTECTED_ROUTES = ["/dashboard"]`. FR-001/FR-002 are already satisfied.
- **Signup captures no metadata.** `src/pages/api/auth/signup.ts:13` calls `signUp({ email, password })`; `SignUpForm.tsx:66` is a plain `method="POST"` form. Nothing exists today to populate a user timezone.
- **The server runs UTC.** Astro `output: "server"` on `@astrojs/cloudflare` (`astro.config.mjs:11-16`). `current_date` in Postgres and `new Date()` in a Worker are both UTC.
- **No test runner.** `package.json` has no `test` script and no Vitest. `CLAUDE.md` currently states Vitest is "not yet installed. Do not try to run or generate test commands" — this change makes that line stale.
- **The Supabase CLI is already available** as a devDependency (`package.json:52`), so both `supabase test db` (pgTAP) and `supabase gen types` are reachable without new tooling.

### Key Discoveries

- **Dosage and quantity are the two fields the dashboard reads on every load _and_ the two the PRD requires be historically preserved.** That tension is the whole design problem; every decision below follows from resolving it in favour of a single source of truth.
- **FR-006's own example is "1.5 units/day"** (`prd.md:93`) — dosage and quantity must be `numeric`, not `integer`.
- **`ON DELETE RESTRICT` is required on specialist references**, since medications and visits both point at a specialist and the per-entity deletion rule forbids orphaning them.
- **The recount projection depends on consumption**, which depends on the dosage series — i.e. on the calculation engine that S-04 will build in TypeScript. Duplicating that arithmetic inside a Postgres trigger would create a second implementation of the PRD's guarded calculation. See "Critical Implementation Details".
- **PostgREST cannot wrap two inserts in one transaction.** Any invariant spanning two tables that must hold after a create is therefore either a deferred constraint trigger _within_ one statement's transaction — which two separate PostgREST calls are not — or an orphan waiting to happen. This is what pushes the liquid sub-type onto a single table rather than a 1:1 pair.
- **Supabase already stores per-user data in `auth.users.raw_user_meta_data`**, and `src/middleware.ts:12` already calls `getUser()` on every request, so a user preference like a timezone is reachable at zero query cost without a table of its own.

## Desired End State

A developer can run `npx supabase db reset` locally and get the complete MedCalc domain schema with RLS enabled on every table; `npx supabase test db` proves that user A cannot read user B's data and that the recount ledger arithmetic holds; `npm test` proves the same properties through the JavaScript client the app actually uses; `src/lib/supabase.ts` returns a client typed against `src/db/database.types.ts` so that a mistyped column name is a build error; and the same migration is applied to the Supabase Cloud project `medcalc` with `supabase migration list` showing local and remote in sync.

At that point S-01 can begin without inventing any schema.

## What We're NOT Doing

- **No current-state views in this change.** The `medications_current` style view (latest dosage + current balance) is deliberately deferred to the point of first need — S-04, the dashboard — so it is designed against a real consumer rather than guessed. **It must be invented once there and reused, not reimplemented per slice.** Recorded here so the deferral is a decision, not an omission.
- **No data-access / repository layer** in `src/lib/db/`. Repository signatures designed before any feature consumes them are guesswork.
- **No calculation engine.** Supply-end date, segmental dosage arithmetic, and colour status are S-04/S-05. This change stores the facts they will read.
- **No UI.** No forms, no pages, no components beyond the one hidden field needed to make the captured timezone real.
- **No history-browsing screen** (PRD Non-Goals — v2).
- **No CI-applied migrations.** `.github/workflows/ci.yml` is left alone; `db push` stays a deliberate manual step, consistent with `infrastructure.md:91` (a Worker rollback does not roll back the database).
- **No stamped running balance (`balance_after`) and no `verify_supply_ledger()` function.** Considered and declined — see Open Risks in the brief.
- **No trigger functions, no `SECURITY DEFINER`, and no Postgres RPC functions.** See "Decided: no procedural database code". RPC (`supabase.rpc()`) is named explicitly so it is not reconsidered as a substitute: it would make the three-statement medication create atomic, but it is _more_ procedural database code than the triggers it would replace, and the zero-dosage read semantics (see "Zero dosage and the multi-statement create") make a partial create a legal state rather than a broken one — which is the cheaper way to buy the same safety. **This is the decision most worth revisiting if partial creates turn out to be common in practice**, and S-02 is where that evidence will first appear.
- **No `profiles` table.** The only field it would carry in v1 is `timezone`, which lives in `auth.users.raw_user_meta_data`. See Phase 3.

## Implementation Approach

Five tables, one migration, four principles:

1. **Mutable state that must be preserved is not stored as a column.** Dosage lives only in `dosage_changes` rows; quantity lives only in `supply_events` deltas. Nothing can drift from its own history because there is no second copy to drift.
2. **Ownership is denormalised, then structurally enforced.** Every table carries `user_id DEFAULT auth.uid()` so RLS policies are a uniform `auth.uid() = user_id`. The denormalisation risk — a child row under a different owner than its parent — is closed by composite foreign keys, not by convention.
3. **Append-only is enforced by RLS, not by discipline.** `supply_events` grants only SELECT and INSERT. `dosage_changes` additionally grants DELETE for not-yet-effective rows only. `medications` denies DELETE outright, so FR-007's archival requirement is a database guarantee rather than an application habit.
4. **Enforcement is declarative.** Every invariant is a policy, a CHECK, a foreign key, or a uniqueness constraint — never a trigger. Declarative constraints are visible in the generated TypeScript types, testable with the same tooling as the rest of the schema, and cannot fall out of sync with a second copy of the same rule.

### Decided: no procedural database code

An earlier draft of this plan carried three triggers: an `auth.users` → `profiles` trigger, a `BEFORE INSERT` trigger deriving the recount delta, and a `DEFERRABLE INITIALLY DEFERRED` constraint trigger for the liquid 1:1 invariant. All three are gone. Recorded here so the reversal is a decision rather than a drift, and so the reasoning survives into the slices that inherit this schema:

- **The recount trigger duplicated a constraint this plan was already writing.** The CHECK asserting `quantity_delta = counted_quantity − projected_quantity` and a trigger computing that same expression are two implementations of one rule, and only the CHECK is the one a caller cannot bypass. The application now supplies all three columns — one line beside the code that already computed `projected_quantity` — and the CHECK still rejects a wrong value. Nothing moved out of the database; the redundant half was deleted.
- **The liquid invariant stopped spanning tables.** Folding `liquid_medication_details` into `medications` as nullable columns turns `form = 'liquid' ⟺ detail fields present` into a single-row CHECK: non-deferred, no trigger, and _stronger_ than what it replaces. The deferred trigger could only fire at commit, and two PostgREST inserts are two transactions — so it never protected against the failure it appeared to (an orphan liquid medication whose second insert failed). A single atomic insert removes that class of bug outright.
- **`profiles` was a table built to hold one preference.** Its trigger existed only to copy `timezone` from `raw_user_meta_data`, where Phase 3 puts it, into a row of its own. Reading it straight from `context.locals.user.user_metadata` removes the trigger, the `SECURITY DEFINER` function, a policy pair, a table, and a backfill statement against live auth data in Phase 5.

**The tradeoff being accepted.** This is not "trust the application instead of the database" — after the change, every invariant that was trigger-enforced is constraint-enforced, and the application's only new responsibility is computing one arithmetic value the database then verifies. What is genuinely given up is a timezone joinable in SQL. Nothing in v1 needs it: the date arithmetic is TypeScript (S-04) and the current-state view is deferred. If S-04's view wants it, `profiles` returns as an additive migration seeded from `raw_user_meta_data` in one statement.

**The re-planning trigger.** The single-table liquid design is right at one sub-type and four columns. **A second medication sub-type is the signal to revisit it** — at that point the nullable-column CHECK gets combinatorial and a sub-type table earns its cost back.

## Critical Implementation Details

**Who computes `projected_quantity` — and now the delta too.** A recount's discrepancy is `counted − projected`, but the projection is not the ledger sum: it is the ledger sum minus consumption since the last event, and consumption comes from the dosage series. That is the calculation engine S-04 builds in TypeScript. Rather than duplicate the PRD's guarded arithmetic in SQL, **the application supplies `counted_quantity`, `projected_quantity`, and `quantity_delta` on the insert, and a CHECK constraint holds the identity `quantity_delta = counted_quantity − projected_quantity`.** The database rejects any row where the three disagree, so the arithmetic is verified without being reimplemented. `numeric` is exact decimal, so this equality is not subject to floating-point drift. Consequence, unchanged from the earlier draft: a recount insert is only meaningful once the engine exists, so S-02 wires the recount UI but S-04 supplies the projection.

**The liquid sub-type lives on `medications`.** `container_capacity`, `estimated_daily_consumption`, `post_opening_expiry_days`, and `opened_on` are nullable columns on `medications`, and the invariant is a single-row CHECK. Creating a liquid medication is therefore one insert, which PostgREST can do atomically — the two-table design could not, since PostgREST has no multi-statement transaction. The `> 0` CHECKs on the individual columns are NULL-safe by definition (a comparison against NULL is unknown, which a CHECK accepts), so they need no `form` guard.

**Ordering inside the migration.** Composite foreign keys require the referenced `UNIQUE (id, user_id)` constraints to already exist, so `specialists` precedes `medications`, which precedes `dosage_changes` and `supply_events`; RLS policies come after all tables. There is no trigger ordering to reason about and no dependency on the `auth` schema beyond the `auth.users` foreign keys.

**`current_date` in the `dosage_changes` DELETE policy is UTC**, so "is this change still in the future?" can be off by up to a day's fraction near midnight for the user. Accepted: the worst case is that a user briefly cannot delete a change that became effective hours ago, and the correction path (insert a new dosage change) remains open.

**`updated_at` has no maintainer, and that is deferred to S-01 on purpose.** `specialists`, `medications`, and `visits` each carry an `updated_at` column, but the conventional maintainer is a `moddatetime` BEFORE UPDATE trigger, which principle 4 forbids, and there is no repository layer to centralise the assignment (see "What We're NOT Doing"). Until something sets it, `updated_at` will equal `created_at`. **The columns are created anyway**, because adding them later is a migration and this change is the cheap moment to have them. **S-01 owns the decision** — it writes the project's first real update path (editing a specialist) and is the first place the answer can be judged against a live consumer rather than guessed. The live options are: enable the stock `moddatetime` extension as a narrow, hand-written-logic-free exception (note that the Phase 1 assertion already tolerates extension-owned _functions_, so only the trigger row would need allowing); set the column explicitly on every write path and assert it in a test; or drop the columns if by then nothing reads them.

### Zero dosage and the multi-statement create

**Creating a medication is three statements, and PostgREST cannot make them one transaction.** FR-004 (`prd.md:87`) captures name, quantity on hand, daily dosage, expiry, and specialist in one user action, but this schema deliberately stores dosage only in `dosage_changes` and quantity only in `supply_events`. So a create is `medications` → `dosage_changes` → `supply_events`, three sequential calls, any of which can fail independently. This is the same constraint that pushed the liquid sub-type onto one table; unlike the liquid case, it **cannot** be designed away, because splitting dosage and quantity out of `medications` is the entire point of the schema.

**What makes a partial create harmless is the read semantics, not a cleanup protocol:**

- A medication with **no `dosage_changes` rows reads as `daily_dosage = 0`** — the same value, and the same meaning, as an explicit stop.
- A medication with **no `supply_events` rows reads as quantity 0.**

Both are legal states a user can reach deliberately, so a medication that lost its second or third insert is not an orphan needing repair — it is a medication that is not currently being taken and has nothing on hand. It renders, it is editable, and the user fixes it by entering the dosage and quantity again. **Nothing needs deleting, which is what keeps the `medications` DELETE denial (§8) from becoming a trap for rows that RLS will not let anyone remove.**

Three consequences to carry forward, none of them optional:

1. **S-02 must still surface a failed write.** This design makes a partial create _harmless_, not _impossible_. If the dosage insert fails silently the user sees 0 and may not notice their dosage never saved — so the create flow reports per-statement failure rather than assuming success once `medications` returns.
2. **S-04 must not divide by zero.** A 0 dosage means consumption is 0, so the supply never depletes and the supply-end date is undefined rather than a date. The calculation engine returns "supply lasts indefinitely" for that segment; it does not compute `quantity / 0`.
3. **A 0-dosage segment is a real segment.** FR-006's segmental arithmetic must treat a stop-then-resume series (`5 → 0 → 5`) as three segments with zero consumption in the middle, not as a gap to skip.

---

## Phase 1: Domain schema migration

### Overview

Author the single migration that creates every table, constraint, index, and RLS policy, and verify it locally against a throwaway database.

### Preflight — do this before writing any SQL

**Run `npx supabase start` and confirm the local stack comes up.** This is a hard gate, not a warm-up: the entire local-first workflow chosen for this change (`db reset` to rehearse, pgTAP in Phase 2, `gen types --local` in Phase 3, Vitest against the local stack in Phase 4) rests on it. Every one of those phases is blocked if it does not run, so it is cheaper to discover that now than after the migration is written.

Four things to expect, in the order they tend to bite:

1. **Docker must be running**, and the first `supabase start` pulls several gigabytes of images — allow time for it rather than assuming a hang.
2. **The corporate proxy may interfere.** The `NODE_TLS_REJECT_UNAUTHORIZED=0` workaround documented in `CLAUDE.md` covers the Node-based CLI's own HTTPS calls, but **Docker image pulls do not go through Node** — a proxy failure at the pull stage is configured in Docker Desktop's proxy settings instead. Two different fixes for two different symptoms; matching the right one to the error message saves the most time here.
3. **Record the printed `API URL` and `anon key`.** Phase 4's test-client helper reads them from environment variables, and `CLAUDE.md` already documents copying them into `.env` and `.dev.vars`.
4. **Watch the first `db reset` for a seed-file complaint.** `config.toml:60-65` sets `[db.seed] enabled = true` with `sql_paths = ["./seed.sql"]`, and `supabase/seed.sql` **does not exist** — a leftover from the starter. Whether the CLI treats a non-matching path as a warning or a hard error was not verified during planning, and criterion 1.2 depends on `db reset` exiting 0. If it errors, either create an empty `supabase/seed.sql` or set `enabled = false`; this change seeds nothing either way, so both remedies are equally correct. Deciding it here rather than mid-phase keeps it a two-second call.

**If the stack cannot be started, stop — do not author the migration blind.** Authoring against the cloud project instead would reverse the migration-workflow decision recorded in this plan (rehearse locally, then push), which is a re-planning trigger rather than a substitution to make quietly mid-phase. Raise it and the plan gets amended.

### Changes Required:

#### 1. Migration scaffold

**File**: `supabase/migrations/<timestamp>_domain_schema.sql` (created via `npx supabase migration new domain_schema`)

**Intent**: Hold the entire domain schema in one reviewable migration, so the schema's first state is a single atomic unit rather than a sequence of amendments.

**Contract**: One file, ordered: extensions → enums → `specialists` → `medications` → `dosage_changes` → `supply_events` → `visits` → indexes → RLS enable + policies. No `create function` and no `create trigger` statements appear anywhere in it.

**The extensions step is expected to be empty.** Every table defaults its primary key with `gen_random_uuid()`, which is built into Postgres 13+ core — `config.toml:36` pins `major_version = 17`, so **`pgcrypto` is not required** and should not be enabled out of habit. pgTAP is the one extension this change needs, and it is installed by Phase 2, not here.

#### 2. Enumerated types

**File**: same migration

**Intent**: Give medication form and supply-event kind closed domains that generated TypeScript types will surface as string unions.

**Contract**: `medication_form` = `('solid', 'liquid')`; `supply_event_type` = `('refill', 'recount', 'adjustment')`.

#### 3. `specialists`

**File**: same migration

**Intent**: The managed entity FR-003 requires, so medication↔visit linkage is by key rather than by spelling.

**Contract**: `(id uuid PK DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid() → auth.users ON DELETE CASCADE, name text NOT NULL, specialty text NOT NULL, created_at, updated_at)`, with non-empty CHECKs on `name`/`specialty` and `UNIQUE (id, user_id)` to serve as a composite-FK target.

#### 4. `medications`

**File**: same migration

**Intent**: The core entity, carrying only facts that do not change over time — deliberately no `daily_dosage` and no `quantity_on_hand` column — plus FR-008's liquid sub-type fields, nullable and CHECK-guarded so that creating a liquid medication is a single atomic insert.

**Contract**: `(id uuid PK DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(), specialist_id uuid NOT NULL, name text NOT NULL, form medication_form NOT NULL DEFAULT 'solid', expiry_date date NOT NULL, container_capacity numeric NULL CHECK > 0, estimated_daily_consumption numeric NULL CHECK > 0, post_opening_expiry_days integer NULL CHECK > 0, opened_on date NULL, archived_at timestamptz NULL, created_at, updated_at)`, `UNIQUE (id, user_id)`, the composite foreign key that makes cross-owner rows impossible, and the single CHECK that replaces the former deferred constraint trigger:

```sql
constraint medications_specialist_fk
  foreign key (specialist_id, user_id)
  references public.specialists (id, user_id) on delete restrict,

-- the liquid fields are present exactly when the medication is liquid,
-- and a solid carries NONE of them
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
)
```

**Amended 2026-08-14, during Phase 1.** This section previously specified two constraints, the first written as a boolean equality:

```sql
check ((form = 'liquid') = (a is not null and b is not null and c is not null))
```

That form does not do what the surrounding prose says. For a **solid** row carrying one or two stray liquid fields, the left side is `false` and the right side is also `false`, so `false = false` passes — it only rejects a solid carrying all three. A partially-populated solid is the likelier mistake, so it must fail. The `CASE` above is what the migration ships; it is strictly stronger and absorbs the former separate `opened_on` constraint into its `else` branch. Caught by criterion 1.5. The prose contract here, criterion 1.5, and Phase 2 §4 all already described the correct behaviour — only this snippet was wrong.

`opened_on` is what makes post-opening expiry computable; NULL on a liquid means not yet opened, which is why it is excluded from the `liquid` branch.

#### 5. `dosage_changes`

**File**: same migration

**Intent**: The sole home of dosage. The row created with a medication is its initial dosage; each later row is a scheduled or applied change. FR-006's segmental calculation reads this series directly.

**Contract**: `(id uuid PK DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(), medication_id uuid NOT NULL, daily_dosage numeric NOT NULL CHECK >= 0, effective_date date NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now())`, composite FK to `medications` ON DELETE CASCADE, and `UNIQUE (medication_id, effective_date)` — one dosage in force per medication per day.

**`daily_dosage = 0` is a legal and meaningful value**, not a degenerate one: it records "I have stopped taking this" while keeping the medication visible and its history intact. That is distinct from archival (FR-007), which hides the medication entirely — stopping and archiving are different user intentions and the schema now expresses both. The CHECK is therefore `>= 0`, and only negative dosages are rejected. See "Zero dosage and the multi-statement create" below for the second thing this buys.

#### 6. `supply_events`

**File**: same migration

**Intent**: The delta ledger for quantity on hand, with recount events carrying the reality check.

**Contract**: `(id uuid PK DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(), medication_id uuid NOT NULL, event_type supply_event_type NOT NULL, quantity_delta numeric NOT NULL, counted_quantity numeric NULL, projected_quantity numeric NULL, occurred_on date NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), note text NULL)`, composite FK to `medications` ON DELETE CASCADE. Three CHECKs make the recount contract structural:

```sql
-- the recount fields are present exactly when the event is a recount
check ((event_type = 'recount') = (counted_quantity is not null and projected_quantity is not null)),
-- a recount's delta IS the discrepancy
check (event_type <> 'recount' or quantity_delta = counted_quantity - projected_quantity),
-- a refill can only add
check (event_type <> 'refill' or quantity_delta > 0)
```

Callers supply all three columns on a recount; the second CHECK above is what keeps them honest, and it is the whole of the enforcement — there is no trigger. **The discrepancy signal downstream slices read is `quantity_delta <> 0` on a recount row** — no recomputation, one column.

#### 7. `visits`

**File**: same migration

**Intent**: FR-009/FR-010's visit records, hard-deletable per the per-entity deletion decision.

**Contract**: `(id uuid PK DEFAULT gen_random_uuid(), user_id uuid NOT NULL DEFAULT auth.uid(), specialist_id uuid NOT NULL, visit_date date NOT NULL, created_at, updated_at)`, composite FK `(specialist_id, user_id) → specialists(id, user_id) ON DELETE RESTRICT`. Nothing references `visits`, so deletion is always safe at the database level.

#### 8. Row-level security

**File**: same migration

**Intent**: Make RLS the enforcement point for both data isolation and the append-only mandate. PostgREST executes every request as the end user, so a route handler that forgets a `user_id` filter is caught here rather than returning another user's medical data.

**Contract**: `ENABLE ROW LEVEL SECURITY` on all five tables. Per-table grants — the asymmetry _is_ the append-only guarantee:

| Table            | SELECT | INSERT | UPDATE            | DELETE                                        |
| ---------------- | ------ | ------ | ----------------- | --------------------------------------------- |
| `specialists`    | own    | own    | own               | own                                           |
| `medications`    | own    | own    | own               | **✗ — archival only (FR-007)**                |
| `dosage_changes` | own    | own    | **✗ — immutable** | own, **only `effective_date > current_date`** |
| `supply_events`  | own    | own    | **✗**             | **✗ — corrections are new `adjustment` rows** |
| `visits`         | own    | own    | own               | own                                           |

"own" means `auth.uid() = user_id`. Policies target the `authenticated` role.

#### 9. Indexes

**File**: same migration

**Intent**: Support the access patterns S-04's dashboard will use, without waiting for a performance problem.

**Contract**: `specialists(user_id)`; `medications(user_id) WHERE archived_at IS NULL`; `medications(specialist_id)`; `dosage_changes(medication_id, effective_date DESC)`; `supply_events(medication_id, occurred_on, recorded_at)`; `visits(user_id, visit_date)`; `visits(specialist_id, visit_date)`.

#### 10. Local project identity

**File**: `supabase/config.toml`

**Intent**: Stop the local project from identifying itself as the starter template.

**Contract**: `project_id` changes from `"10x-astro-starter"` to `"medcalc"`.

#### 11. Database npm scripts

**File**: `package.json`

**Intent**: Give the schema workflow named entry points instead of remembered CLI incantations.

**Contract**: adds `db:reset`, `db:test`, and `db:types` scripts wrapping `supabase db reset`, `supabase test db`, and `supabase gen types typescript --local > src/db/database.types.ts`.

### Success Criteria:

#### Automated Verification:

- Preflight gate: `npx supabase start` brings the local stack up (verified before any SQL is written)
- `npx supabase db reset` applies the migration with exit code 0
- `npx supabase db reset` run a second time succeeds (migration is reproducible from scratch)
- Every one of the five tables reports `rowsecurity = true` in `pg_tables`
- A liquid medication inserted without its liquid fields is rejected by CHECK; a solid one carrying them is rejected too
- A `dosage_changes` row with `daily_dosage = 0` is accepted; a negative one is rejected
- A `DELETE` against `medications` is rejected by policy
- Both no-procedural-code queries return 0, each scoped to `public` — user triggers (`pg_trigger` joined through `pg_class`/`pg_namespace`, `not tgisinternal`, `nspname = 'public'`) and non-extension functions (`pg_proc` in `public` with no `pg_depend` row where `deptype = 'e'`). **Both scopings are load-bearing**: `pg_trigger` has no schema column of its own and Supabase's `auth`, `storage`, and `realtime` schemas ship their own triggers, so an unscoped count is never 0; and the `pg_depend` exclusion is what stops pgTAP's ~1000 functions from breaking this check in Phase 2
- `npm run lint` passes

#### Manual Verification:

- Supabase Studio shows all five tables with the expected columns and relationships
- Studio's Auth → Policies view lists the expected policy set per table

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: pgTAP database tests

### Overview

Prove at the database level the two properties that cannot be verified by inspection: that RLS actually isolates users, and that the recount ledger arithmetic holds.

**pgTAP must be installed with `create extension if not exists pgtap with schema extensions`.** Without the explicit schema it lands in `public` and its ~1000 functions break Phase 1's no-procedural-code assertion retroactively. The `pg_depend` exclusion in that assertion is the belt to this braces — keep both.

### Changes Required:

#### 1. RLS isolation tests

**File**: `supabase/tests/rls.test.sql`

**Intent**: Demonstrate that a client authenticated as user A can neither read nor write user B's rows, for every table — the single property standing between the anon key and other people's medical data.

**Contract**: pgTAP plan seeding two users directly into `auth.users`, then per table: assert user A sees exactly their own rows, sees zero of user B's, and cannot insert a row carrying B's `user_id`. Role is switched with `set local role authenticated` plus `set local request.jwt.claims`.

#### 2. Append-only enforcement tests

**File**: `supabase/tests/append_only.test.sql`

**Intent**: Lock in the policy asymmetry from Phase 1 §8, so a future migration that loosens a policy fails loudly instead of silently.

**Contract**: assert `DELETE` on `medications` is refused; `UPDATE`/`DELETE` on `supply_events` are refused; `UPDATE` on `dosage_changes` is refused; `DELETE` on a `dosage_changes` row with a past `effective_date` is refused while a future-dated one succeeds.

#### 3. Supply ledger tests

**File**: `supabase/tests/supply_ledger.test.sql`

**Intent**: Verify the recount CHECK constraints — the arithmetic feeding the PRD's accuracy guardrail, and now the sole enforcement of it.

**Contract**: assert that a recount whose `quantity_delta` does **not** equal `counted − projected` is rejected (the case that used to be impossible because a trigger overwrote the value — it is now the most important assertion in the file); that a consistent recount is accepted and reads back with the discrepancy in `quantity_delta`; that a matching recount stores `quantity_delta = 0` (the "nothing to notify" case); that a `refill` with a non-positive delta is rejected; and that a non-recount row carrying `counted_quantity` is rejected.

#### 4. Constraint and integrity tests

**File**: `supabase/tests/constraints.test.sql`

**Intent**: Cover the structural invariants that make illegal states unrepresentable.

**Contract**: assert the liquid CHECK fires in both directions (a `liquid` row missing any of the three fields is rejected; a `solid` row carrying any of them is rejected), and that a liquid row with `opened_on IS NULL` is accepted while a solid row with `opened_on` set is rejected; that a composite FK rejects a child row whose `user_id` differs from its parent's; that deleting a referenced specialist is restricted; that `UNIQUE (medication_id, effective_date)` rejects two dosages on one day; and that **`daily_dosage = 0` is accepted while a negative dosage is rejected** — the stop-without-archiving state, and the read-semantics anchor that makes a partial create harmless.

### Success Criteria:

#### Automated Verification:

- `npm run db:test` (`supabase test db`) passes with every planned assertion green
- The suite passes from a clean `npm run db:reset`
- Test count matches the declared pgTAP plan in each file (no silently skipped assertions)

#### Manual Verification:

- Test names read as requirements — a reviewer can map each to an FR or to a decision in this plan
- Deliberately weakening one RLS policy locally makes the suite fail (the tests actually bite)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Typed client and signup timezone capture

### Overview

Surface the schema to the application as generated types, and capture the user timezone that the whole date design depends on — into `auth.users.raw_user_meta_data`. Reading it back is S-04's job, not this change's.

### Changes Required:

#### 1. Generated database types

**File**: `src/db/database.types.ts` (new directory)

**Intent**: Establish `src/db/` as the home for schema-derived types and give every downstream slice compile-time knowledge of the schema.

**Contract**: Generated verbatim by `npm run db:types`; committed; never hand-edited. Exports the `Database` type plus the enum unions for `medication_form` and `supply_event_type`.

#### 2. Typed Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Make a mistyped table or column a build error rather than a runtime surprise — the typed-end-to-end property the stack was chosen for (`tech-stack.md:24`).

**Contract**: `createServerClient` gains the `Database` generic; the module additionally exports a `SupabaseClient` type alias for use in downstream service signatures. The existing null-return-when-unconfigured behaviour (`src/lib/supabase.ts:8-10`) is preserved — `src/middleware.ts:9` depends on it.

#### 3. Timezone capture at signup

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: Send the browser's IANA timezone with the signup POST, so the stored user metadata holds a real value instead of the fallback.

**Contract**: a hidden `timezone` input inside the existing form (`SignUpForm.tsx:66`), rendering **empty** on the server and set to `Intl.DateTimeFormat().resolvedOptions().timeZone` in an effect after hydration — the two-step avoids a hydration mismatch, since the server has no access to the client's zone. No change to validation.

**Amended again 2026-08-14, after manual verification failed.** The write does not happen at mount at all — it happens on the form's `submit` event, from an `is:inline` script in `src/pages/auth/signup.astro`, listening on `document` in the bubble phase.

Writing at mount (whether by `setState` or by a ref) is observably lost before the POST. `handleSubmit` calls `validate()`, which calls `setErrors(next)` with a fresh object; that re-render resets the uncontrolled hidden input to its `defaultValue` in the same tick the browser is preparing to serialise the form. Diagnosed by elimination against a running dev server: the island hydrated (`reactHydrated: true`, all island URLs 200), the field held the correct zone at rest, and the route still received `""` — so the loss was strictly between mount and submission. A bubble-phase `document` listener is the last writer before the native POST. Keeping it outside the island also means a later change to `SignUpForm` cannot silently break it, and with JavaScript disabled nothing runs, so the field submits empty and no `timezone` key is stored — criterion 3.6 preserved.

**Amended 2026-08-14, during Phase 3.** This section previously specified `"UTC"` as the server-render default. That contradicted §4 below ("An absent or empty value is left out entirely") and criterion 3.6 ("stores no `timezone` key at all"): a non-empty `"UTC"` would be forwarded like any other zone, making §4's empty branch dead code and criterion 3.6 unreachable. It would also have given JS-disabled signups silent UTC date arithmetic instead of S-04's intended `Europe/Warsaw` fallback. Either constant avoids the hydration mismatch equally well, so the empty string is the one that keeps the rest of the plan coherent.

#### 4. Signup route passes metadata

**File**: `src/pages/api/auth/signup.ts`

**Intent**: Forward the submitted timezone into Supabase user metadata, which is where it now lives permanently — there is no copy in a `profiles` table.

**Contract**: read `timezone` from the form data and pass it as `options.data.timezone` on the existing `signUp` call (`signup.ts:13`). An absent or empty value is left out entirely, so `user_metadata` simply carries no `timezone` key rather than an empty string.

### The fallback has no owner in this change — S-04 writes it

A reader (`src/lib/timezone.ts`, exporting `getUserTimezone`) was specified here and then **cut**, because nothing in this change would have called it: the calculation engine is out of scope, so it would have shipped as dead code with a success criterion that could not honestly be checked.

What that leaves for S-04, stated here so it is inherited rather than rediscovered:

- **A user's timezone can legitimately be absent.** Signups with JavaScript disabled, and every account created before this change, carry no `timezone` key at all. Absent is normal, not an error.
- **The intended fallback is `Europe/Warsaw`** — the value the removed `handle_new_user()` trigger used to apply via `coalesce`. Recorded here so the default does not get re-invented per call site.
- **It belongs in exactly one place.** S-04 is the first thing that resolves "today" in the user's zone; whatever it writes should be the single reader every later slice uses, not a fallback inlined at each call site.
- **It costs no query.** `src/middleware.ts:12` already calls `getUser()`, so `Astro.locals.user.user_metadata.timezone` is available on every request.

### Decided: the timezone capture stays in this change

Items 3 and 4 are the only app-behaviour changes in an otherwise schema-shaped foundation, so whether they belong here was raised and settled during planning. **They stay.** Recorded so the question is not reopened mid-implementation:

**Why here.** The producer (the hidden field) and the store (`raw_user_meta_data`) are one decision, and a store with no producer is how a field ends up permanently holding its default. The change is genuinely small — one hidden input and one option on an existing call, with no validation or layout impact. And this phase already stands up a dev server, so confirming the captured value is _correct_ costs nothing over confirming signup still works. **The reader is the part that does not belong here** — see above; it has no caller until S-04.

**Why not S-01.** S-01 is _manage specialists_ — it has no contact with the signup flow, the auth components, or anything that reads a timezone, so the capture would sit there as unrelated work inside a slice with no reason to think about it. Had it been deferred at all, the defensible destination was **S-04 (supply-status dashboard)**, the first thing that ever _reads_ the timezone — it is where "today" is resolved to produce the supply-end date. That option was considered and declined.

**The cost this avoids.** Any account created between this change and a later capture would fall back to `Europe/Warsaw`, and v1 ships no settings screen to correct it. The fix would be a manual metadata update per affected user. Small at current scale, but paid for here at a cost of roughly ten lines.

**What dropping `profiles` changed about this.** Nothing in the argument above, but one consequence is worth naming: existing cloud accounts no longer need a backfill. They simply carry no `timezone` key and will hit S-04's fallback — the same outcome the Phase 5 backfill statement used to produce, without a migration touching live auth data.

### Success Criteria:

#### Automated Verification:

- `npm run db:types` produces no diff against the committed file (types are in sync with the migration)
- `npx astro sync && npx astro check` passes with no type errors
- `npm run lint` passes, including the `react-compiler` rule on the modified form
- `npm run build` succeeds

#### Manual Verification:

- Signing up through `/auth/signup` in `npm run dev` stores a `user_metadata.timezone` matching the browser's actual zone (visible in Studio → Auth → the user's raw metadata)
- Signing up with JavaScript disabled still succeeds and stores no `timezone` key at all (rather than an empty string)
- Existing sign-in and sign-out flows are unaffected

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Vitest integration suite and documentation

### Overview

Install the test runner every later slice will want, and prove the same guarantees through the JavaScript client the application actually uses — a layer pgTAP cannot reach.

### Changes Required:

#### 1. Vitest installation and configuration

**File**: `package.json`, `vitest.config.ts`

**Intent**: Establish the project's test runner, scoped to integration tests that talk to the local Supabase stack.

**Contract**: adds `vitest` as a devDependency plus `test` and `test:watch` scripts; config sets a Node environment, a longer default timeout suited to database round-trips, and confines the include glob to `tests/integration/**`.

#### 2. Test client helper

**File**: `tests/integration/helpers/client.ts`

**Intent**: Give tests a way to authenticate as two distinct users against the local stack without duplicating setup.

**Contract**: exports a helper that creates a `@supabase/supabase-js` client against the local URL and anon key, signs up or signs in a named test user, and returns the typed client. Reads local credentials from environment variables, not committed literals.

#### 3. Isolation and ledger integration tests

**File**: `tests/integration/schema.test.ts`

**Intent**: Verify through PostgREST — the exact path the app takes — that isolation holds and that a recount surfaces its discrepancy in a single column.

**Contract**: two users each create a specialist and a medication; assert each sees only their own; assert a `medications` delete is rejected; assert a recount insert stores `quantity_delta` equal to the discrepancy and `0` when the count matches, and that an inconsistent one is rejected by the database rather than silently corrected; assert a liquid medication is created in a single insert and that a `solid` row carrying liquid fields is rejected; assert the generated types make an invalid column name a compile error.

#### 4. CLAUDE.md testing section

**File**: `CLAUDE.md`

**Intent**: Remove the now-false instruction that Vitest is not installed and no test commands should be generated.

**Contract**: the `## Testing` section is rewritten to name `npm test` (Vitest integration tests, requires a running local Supabase) and `npm run db:test` (pgTAP), and to state that database-level invariants belong in `supabase/tests/` while client-path behaviour belongs in `tests/integration/`.

#### 5. Schema conventions for downstream slices

**File**: `CLAUDE.md`

**Intent**: Record the conventions a future agent would otherwise violate — the ones that are invisible from the schema itself.

**Contract**: a short `## Domain schema` section stating that dosage lives only in `dosage_changes` and quantity only in `supply_events` (never add a cached column); that `supply_events` and past `dosage_changes` are append-only by policy, so corrections are new rows; that **the schema carries no triggers or database functions by design — new invariants belong in CHECK/FK/UNIQUE/RLS, and reaching for a trigger or an RPC is a signal to re-plan rather than to write one**; that a recount insert must supply `quantity_delta` itself, because nothing computes it server-side; that the liquid sub-type is nullable columns on `medications` guarded by a CHECK, so creating one is a single insert; that **`daily_dosage = 0` means "stopped, keep the history" and is distinct from archival, that a medication with no `dosage_changes` rows reads as 0 and one with no `supply_events` rows reads as quantity 0, and that consequently the supply-end date is undefined rather than computed when the dosage is 0**; and that current-state views are to be created once, at first need in S-04, and reused rather than reimplemented per slice.

### Success Criteria:

#### Automated Verification:

- `npm test` passes against a running local Supabase stack
- `npm run lint` passes on the new test files
- `npm run build` still succeeds (test config does not leak into the build)

#### Manual Verification:

- `CLAUDE.md` no longer claims Vitest is uninstalled, and its commands run as written
- The Domain schema section is specific enough that a fresh agent would not add a `quantity_on_hand` column, and would not reach for a trigger to enforce a new invariant

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Push to Supabase Cloud

### Overview

Apply the verified migration to the live `medcalc` project. This is the only irreversible step in the plan — though a purely additive one now that the `profiles` backfill is gone.

### Changes Required:

#### 1. Link the local project to the cloud project

**File**: none — CLI state (`supabase/.temp/`, already git-ignored)

**Intent**: Point the CLI at the `medcalc` cloud project so migration state can be compared and pushed.

**Contract**: `npx supabase link --project-ref <ref>`, using the project ref from the Supabase dashboard. Requires an access token; it is entered interactively and never committed. Corporate-proxy TLS failures are handled the same way as the documented wrangler workaround in `CLAUDE.md`.

#### 2. Apply the migration

**File**: none — remote database state

**Intent**: Bring the cloud schema to the state proven locally.

**Contract**: `npx supabase migration list` first, to confirm the remote has no migrations and no drift; then `npx supabase db push`. The migration is purely additive — five new tables, two new enums, their constraints and policies. **It writes no rows and touches nothing under the `auth` schema**, so the account already registered against this project is unaffected. That was not true of the earlier draft, which carried a backfill statement reading `auth.users`.

#### 3. Record the outcome

**File**: `context/changes/domain-schema-foundation/change.md`

**Intent**: Leave the applied-migration timestamp and project ref in the change record, so a later rollback or audit does not depend on shell history.

**Contract**: append a short note to `## Notes` naming the migration filename, the date applied, and the project ref.

### Success Criteria:

#### Automated Verification:

- `npx supabase migration list` shows no remote migrations and no drift before the push
- `npx supabase db push` exits 0
- `npx supabase migration list` afterwards shows local and remote in sync

#### Manual Verification:

- Studio on the cloud project shows all five tables with RLS enabled, and no functions or triggers under `public`
- Signing in to the deployed app still works and the dashboard still renders
- A `select` against `medications` from a signed-out browser session returns zero rows, not an error containing data
- The migration filename, the date applied, and the project ref are recorded in `change.md` `## Notes`

**Implementation Note**: This phase mutates production data. Confirm the local suite is green before running the push.

---

## Testing Strategy

### Database tests (pgTAP, `supabase/tests/`)

- RLS isolation per table, both read and write directions
- Append-only policy asymmetry (medication delete refused; supply_events immutable; dosage_changes deletable only while future-dated)
- Recount CHECK arithmetic — an inconsistent delta rejected, a consistent one accepted, and the zero-discrepancy case
- Structural invariants: the liquid CHECK in both directions, composite FK owner matching, specialist delete restriction, one-dosage-per-day uniqueness
- The absence of procedural code in `public` (`pg_trigger` and `pg_proc`, both schema-scoped, functions excluding extension-owned ones) asserted as a property, so a future migration cannot quietly reintroduce it

### Integration tests (Vitest, `tests/integration/`)

- The same isolation and ledger guarantees exercised through `@supabase/supabase-js`, i.e. via PostgREST rather than direct SQL — this is the path the application takes and the one where a policy targeting the wrong role would show up
- Generated types reject an invalid column at compile time

### Manual testing steps

1. `npx supabase start`, then `npm run db:reset` — confirm a clean apply
2. Create two users in Studio
3. As user A, insert a specialist and a medication; as user B, attempt to read them — expect zero rows
4. Insert a `refill`, then a matching `recount` — expect `quantity_delta = 0`; then a mismatching one — expect the difference; then one whose delta contradicts its counts — expect rejection
5. Insert a liquid medication in one statement; attempt a `solid` row carrying `container_capacity` — expect rejection
6. Attempt to delete a medication — expect rejection; set `archived_at` instead — expect success
7. Sign up through the running dev server from a non-UTC machine and confirm the stored `user_metadata.timezone`

## Performance Considerations

The PRD's NFR is a dashboard rendering up to 20 medications within one second (`prd.md:116`). Removing the cached dosage and quantity columns means the dashboard resolves current values by scanning each medication's `dosage_changes` and `supply_events` rows. At MVP volumes — tens of medications, a few hundred events — this is trivially fast, and the indexes in Phase 1 §9 cover the ordering. Should it ever stop being trivial, the answer is the deferred current-state view (materialised if needed), not a cached column: a cache would reintroduce exactly the drift this schema is shaped to prevent.

Folding the liquid fields onto `medications` also removes a join from every dashboard query that needs them, and reading the timezone from the session user removes a per-request `profiles` lookup. Neither was going to be the bottleneck; both are noted so the single-table choice is not later mistaken for a purely stylistic one.

## Migration Notes

- This is the project's first migration; there is no existing domain data to migrate and no rollback scenario beyond dropping the created objects.
- **There is no live-data concern.** The migration creates objects and writes no rows. Accounts that already exist in the cloud project carry no `user_metadata.timezone` and will resolve to S-04's `Europe/Warsaw` fallback until they set one; only new signups get a captured value. This replaces the `profiles` backfill an earlier draft carried, and with it the only statement that would have touched the `auth` schema.
- **Deleting an auth user fails once that user owns a medication or a visit.** `specialists.user_id → auth.users ON DELETE CASCADE` (§3) tries to remove the user's specialists, but the composite FKs from `medications` (§4) and `visits` (§7) are `ON DELETE RESTRICT` — so the cascade is blocked and the whole delete errors. This is a consequence of the per-entity deletion rule, not an oversight: RESTRICT is exactly what stops a specialist disappearing while medications still point at it. **It bites in development** the first time someone deletes a test user in Studio; the workaround is to delete that user's medications and visits first. No v1 requirement is affected — the PRD has no account-deletion FR. **If account deletion is ever added, this is the constraint to revisit**, and the fix is a deliberate deletion order in the app rather than loosening RESTRICT.
- `infrastructure.md:91` notes that a Worker rollback does not roll back the database. Since this migration only adds objects and the application does not yet read them, code and schema can be deployed independently in this change — a property that will not hold from S-01 onward.

## References

- Roadmap item: `context/foundation/roadmap.md` — F-01
- Product requirements: `context/foundation/prd.md` — Business Logic (`:119-133`), NFRs (`:117`), FR-003 through FR-011
- Stack hand-off: `context/foundation/tech-stack.md`
- Platform and operations: `context/foundation/infrastructure.md` — rollback (`:91`)
- Cloud project provisioning: `context/deployment/deploy-plan.md:41-53`
- Existing auth integration points: `src/lib/supabase.ts:4-25`, `src/middleware.ts:6-25`, `src/pages/api/auth/signup.ts:13`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Domain schema migration

#### Automated

- [x] 1.1 Preflight gate: `npx supabase start` brings the local stack up (verified before any SQL is written) — cc2cdaa
- [x] 1.2 `npx supabase db reset` applies the migration with exit code 0 — cc2cdaa
- [x] 1.3 `npx supabase db reset` run a second time succeeds — cc2cdaa
- [x] 1.4 All five tables report `rowsecurity = true` — cc2cdaa
- [x] 1.5 Liquid medication missing its liquid fields is rejected by CHECK; solid medication carrying them is rejected too — cc2cdaa
- [x] 1.6 `dosage_changes` accepts `daily_dosage = 0` and rejects a negative dosage — cc2cdaa
- [x] 1.7 `DELETE` against `medications` is rejected by policy — cc2cdaa
- [x] 1.8 Both no-procedural-code queries return 0 — `public`-scoped user triggers and non-extension `public` functions — cc2cdaa
- [x] 1.9 `npm run lint` passes — cc2cdaa

#### Manual

- [x] 1.10 Studio shows all five tables with expected columns and relationships — cc2cdaa
- [x] 1.11 Studio Auth → Policies lists the expected policy set per table — cc2cdaa

### Phase 2: pgTAP database tests

#### Automated

- [x] 2.1 `npm run db:test` passes with every planned assertion green — 1322caa
- [x] 2.2 Suite passes from a clean `npm run db:reset` — 1322caa
- [x] 2.3 Test count matches the declared pgTAP plan in each file — 1322caa

#### Manual

- [x] 2.4 Test names map to an FR or to a decision in this plan — 1322caa
- [x] 2.5 Weakening an RLS policy locally makes the suite fail — 1322caa

### Phase 3: Typed client and signup timezone capture

#### Automated

- [x] 3.1 `npm run db:types` produces no diff against the committed file — 85039ad
- [x] 3.2 `npx astro sync && npx astro check` passes with no type errors — 85039ad
- [x] 3.3 `npm run lint` passes, including `react-compiler` on the modified form — 85039ad
- [x] 3.4 `npm run build` succeeds — 85039ad

#### Manual

- [x] 3.5 Signup stores `user_metadata.timezone` matching the browser's timezone — 85039ad
- [x] 3.6 Signup with JavaScript disabled succeeds and stores no `timezone` key at all — 85039ad
- [x] 3.7 Existing sign-in and sign-out flows are unaffected — 85039ad

### Phase 4: Vitest integration suite and documentation

#### Automated

- [x] 4.1 `npm test` passes against a running local Supabase stack
- [x] 4.2 `npm run lint` passes on the new test files
- [x] 4.3 `npm run build` still succeeds

#### Manual

- [x] 4.4 `CLAUDE.md` testing commands run as written
- [x] 4.5 Domain schema section is specific enough to prevent a cached-column regression

### Phase 5: Push to Supabase Cloud

#### Automated

- [ ] 5.1 `npx supabase migration list` shows no remote drift before the push
- [ ] 5.2 `npx supabase db push` exits 0
- [ ] 5.3 `npx supabase migration list` shows local and remote in sync

#### Manual

- [ ] 5.4 Studio on the cloud project shows all five tables with RLS enabled and no `public` functions or triggers
- [ ] 5.5 Signing in to the deployed app still works
- [ ] 5.6 A signed-out `select` against `medications` returns zero rows, not data
- [ ] 5.7 Migration filename, date applied, and project ref recorded in `change.md`
