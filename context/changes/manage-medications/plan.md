# Manage Medications (S-02) Implementation Plan

## Overview

Ship `/medications`: a signed-in user adds a medication (name, assigned specialist, printed expiry date, starting daily dosage, starting quantity), edits its details, records refills and count corrections, changes the daily dosage, and archives or restores it. This is roadmap slice **S-02**, covering **FR-004**, **FR-005**, and **FR-007**.

The screen is the second consumer of the F-01 schema and the direct prerequisite for S-04's dashboard. Unlike S-01, the entity it manages is not one row: dosage lives only in `dosage_changes` and quantity only in `supply_events` deltas, so this slice is as much about writing a small append-only ledger correctly as it is about a form.

## Current State Analysis

**What exists.** F-01 shipped the whole schema; nothing in this slice creates a table.

- `medications` (`supabase/migrations/20260813185255_domain_schema.sql:59-119`) — `id`, `user_id` (`default auth.uid()`), `specialist_id`, `name`, `form`, `expiry_date`, four nullable liquid columns, `archived_at`, `created_at`, `updated_at`. Composite FK `(specialist_id, user_id) → specialists (id, user_id) ON DELETE RESTRICT`, so a medication cannot point at a stranger's specialist. **No DELETE policy** — FR-007's archival is enforced by the database, not by habit (`:275-283`).
- `dosage_changes` (`:131-147`) — `daily_dosage numeric` (`>= 0`), `effective_date date`, `unique (medication_id, effective_date)`. SELECT + INSERT + a narrow DELETE only; **no UPDATE policy** (`:285-296`).
- `supply_events` (`:161-201`) — `event_type` ∈ `refill | recount | adjustment`, `quantity_delta numeric`, nullable `counted_quantity` / `projected_quantity` gated by a `CASE` CHECK, `occurred_on date`. SELECT + INSERT only (`:298-303`). `refill` must have `quantity_delta > 0`; a `recount`'s delta must equal `counted_quantity - projected_quantity`.
- `20260821182457_grants_updated_at_guard_and_rls_perf.sql` added explicit `GRANT`s to `authenticated`, a `check (updated_at >= created_at)` on `medications`, and rewrote every policy's `auth.uid()` as `(select auth.uid())`. It is applied to **both** local and cloud as of 2026-08-27.

**S-01 established the patterns this slice copies wholesale:**

- `src/lib/db/specialists.ts` — `Result<T>` discriminated union, a domain `ErrorKind`, `logDbError` carrying the single `eslint-disable-next-line no-console`, `.select()` chained onto UPDATE/DELETE so a zero-row RLS result becomes `not_found`, explicit update payloads that stamp `updated_at` and never spread a body, and **no `user_id` filter anywhere**.
- `src/lib/api/json.ts` — `json`, `jsonError`, `noContent`, `readJsonBody`, `zodFieldErrors`, and the `{ error: { message, fieldErrors? } }` contract.
- `src/lib/validation/specialist.ts` — one zod schema imported by both the island and the route.
- `src/pages/specialists.astro` + `src/components/specialists/SpecialistsManager.tsx` — SSR the list in frontmatter, hand it to a `client:load` island as `initial…` props, island owns every mutation via `fetch`.
- `src/components/form/FormField.tsx`, `src/components/ui/{alert-dialog,button,card,input,label}.tsx`, and the `:root` token palette in `src/styles/global.css` (green-700 `--primary`, red-600 `--destructive`, slate `--muted-foreground`). No amber/warning token exists.
- `src/middleware.ts` `PROTECTED_ROUTES = ["/dashboard", "/specialists"]`; `src/components/Topbar.astro` `navLinks`.

**What is missing.** No medications route, page, component, validation schema, or data module. `dashboard.astro` is still chrome-only (S-04 owns it).

**Key constraints discovered:**

- **`.upsert()` is unavailable on `dosage_changes`.** PostgREST's upsert compiles to `INSERT … ON CONFLICT DO UPDATE`, and there is no UPDATE policy on that table, so the conflict branch is refused by RLS. This is the single most likely wrong turn in the whole slice.
- **A starting quantity of `0` cannot be a `refill`** — `supply_events_refill_is_positive` requires `quantity_delta > 0`.
- **`current_date` in the DELETE policy is UTC**, and the Worker's clock is UTC, so any date the application writes must be computed in UTC to agree with it.
- **`append_only.test.sql` seeds only `current_date - 10` and `current_date + 10`** (`:29-31`), so nothing today asserts behaviour _at_ `effective_date = current_date`. Phase 1's relaxation therefore breaks no existing assertion — and gains none either.

## Desired End State

A signed-in user opens `/medications` and sees every medication they track, each showing its current daily dosage, current quantity on hand, printed expiry date, assigned specialist, and a derived status label. They can:

- add a medication in one form submit, including its starting dosage and starting quantity;
- edit name, specialist, and expiry date;
- change the daily dosage — including correcting one entered wrongly the same day, and including setting it to `0` to record "I have stopped taking this";
- add a refill, or correct the recorded amount to a counted figure;
- archive a medication and restore it again, with archived rows behind a "Show archived" toggle.

Signed-out visitors are redirected to `/auth/signin`. The screen works at 320 px without horizontal scrolling. A user with no specialists yet is told so and sent to `/specialists`, because `specialist_id` is `not null`.

**Verify by:** `npm run lint`, `npm run build`, the existing `npm run db:test` (70 assertions) and `npm test` (15 assertions) still green after Phase 1's migration, and the manual walk in each phase.

### Key Discoveries

- Dosage and quantity are **derived**, never stored on `medications` — the absence of a second copy is what makes drift impossible (`CLAUDE.md` → _Domain schema_).
- `daily_dosage = 0` means "stopped, keep the history" and is explicitly distinct from archival (`20260813185255_domain_schema.sql:126-129`).
- PostgREST resolves composite-FK embeds without a disambiguating hint — proven in `src/lib/db/specialists.ts:44-46` against `(specialist_id, user_id)`.
- `medications_user_id_active_idx` is **partial** on `archived_at is null`, so a query that fetches archived rows too will not use it. Irrelevant at MVP volume; named so nobody "fixes" the index later without knowing why.
- No pgTAP test asserts a policy _name_, so Phase 1 may rename the DELETE policy safely.

## What We're NOT Doing

- **The supply-end calculation, colour status, and the dashboard.** S-04. Nothing here computes a projection or a traffic light. The expiry badge described in Phase 4 is a bare date comparison and deliberately uses neutral/destructive tokens, **not** the green/yellow/red scale S-04 will define.
- **Future-dated dosage changes.** S-05. `effective_date` is always today in this slice; the UI offers no date picker for it. The schema and the relaxed policy both already permit future rows, so S-05 adds a control rather than a mechanism.
- **Liquid medications.** S-06. `form` is always written as `'solid'` and the zod schema _rejects_ a liquid payload rather than merely omitting the fields from the form — so an API caller cannot create a half-built liquid row this slice cannot display.
- **`recount` supply events.** An honest recount needs `projected_quantity` from S-04's consumption engine. Corrections here are `adjustment` rows.
- **Current-state SQL views.** Deferred to S-04 per `CLAUDE.md` → _Domain schema_; this slice aggregates in TypeScript and Phase 2 names the replacement point.
- **Any new automated test.** Explicit decision, 2026-08-27. See `follow-ups/deferred-tests.md`. The existing suites are still _run_ as regression checks; none are _added_.
- **S-01's open follow-ups** (`specialists-tests`, `signed-in-landing`) and F-01's (F2 numeric scale, F3 GDPR erasure, F9 CI gating, D-01 mirrored grants).
- **Search, sort, filter, pagination, or a medication detail page.** The list is flat and ordered by name.
- **Pushing the migration to cloud.** Local only; queued as a follow-up.

## Implementation Approach

Four phases, mirroring S-01's shape now that the design system already exists: schema → data → API → UI.

The organising idea is that **every mutation surface maps to the table it writes**. Editing a medication's own columns is a `PATCH` on the medication. Changing dosage writes `dosage_changes`, so it is `POST /api/medications/[id]/dosage`. Recording supply writes `supply_events`, so it is `POST /api/medications/[id]/supply`. Archiving writes `medications.archived_at` but is a different intent from a details edit, so it gets `POST /api/medications/[id]/archive` rather than smuggling a boolean into the details schema. This keeps every zod schema a plain object with no discriminator, which is what makes `zodFieldErrors` map cleanly onto form fields.

The data module owns all multi-statement sequencing. A route never issues two writes.

## Critical Implementation Details

**`.upsert()` cannot be used on `dosage_changes`.** PostgREST compiles upsert to `INSERT … ON CONFLICT DO UPDATE`; the table has no UPDATE policy, so the conflict branch is refused by RLS and the call fails rather than replacing the row. Setting today's dosage is therefore an explicit DELETE-then-INSERT, in that order: the DELETE is a no-op affecting zero rows when no row exists today, so one code path serves both first-set and same-day correction. Attempt order matters — INSERT-first-then-recover-from-23505 costs an extra round trip on the correction path and leaves the same non-atomic window.

**That window destroys data, so the DELETE must be reversible.** If the INSERT fails after the DELETE has landed, the user's _previous_ dosage is gone — and because `listMedications` reads "no row ⇒ 0" and the status precedence maps `current_dosage === 0` to `not_used`, the loss renders as the deliberate "I have stopped taking this" state. The route returns 500, but a reload shows a plausible row and nothing tells the user a value was deleted. The DELETE therefore chains `.select("daily_dosage")` to capture what it removed (the DELETE-with-RETURNING pattern is already proven at `src/lib/db/specialists.ts:136-147`), and on INSERT failure the module re-inserts the captured value before returning the error, so a 500 honestly means "nothing changed". The compensating INSERT can itself fail; that case logs under its own operation name so the Workers log can distinguish it from an ordinary failure. This is the one place in the slice where a partial result is _not_ a legitimate domain state.

**Dates are computed in UTC, on the server, never in the browser.** `dosage_changes_delete_future_own` compares `effective_date` against Postgres `current_date`, which is UTC on Supabase. A date derived from the visitor's local clock disagrees with it for part of every day, and the symptom — "I can't correct the dosage I just set" — would appear only near midnight and only for some users. The data module derives `today` itself; no route or island sends a date for `effective_date` or `occurred_on`.

**A starting quantity of `0` writes no `supply_events` row at all.** `supply_events_refill_is_positive` rejects a zero-delta refill, and there is nothing to record: a medication with no supply events reads as quantity 0, which is the intended state. The create path skips the third insert rather than reaching for `adjustment` to force a row into existence.

**The quantity correction reads before it writes.** `adjustment` delta is `target − sum(existing deltas)`, so the module must SELECT the ledger sum first. Two tabs correcting at once will race and the later write wins on a stale base. Accepted at this data volume and single-user scope; a `recount` in S-04 is the structural fix, since it records the counted figure itself rather than a delta derived from a read.

## Phase 1: Relax the same-day dosage lock

### Overview

`dosage_changes_delete_future_own` permits DELETE only while `effective_date > current_date`, which makes a dosage entered today uncorrectable until tomorrow — the single likeliest first-day mistake. Narrow the invariant from "immutable once effective" to "immutable once **past**".

### Changes Required

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_relax_same_day_dosage_correction.sql` (create with `npx supabase migration new relax_same_day_dosage_correction`)

**Intent**: Allow a dosage change whose `effective_date` is today to be deleted, so the application can replace it; keep every already-past row immutable. Rename the policy so its name stops describing the old rule.

**Contract**: `alter policy` on `public.dosage_changes` — the `using` predicate becomes `(select auth.uid()) = user_id and effective_date >= current_date`, preserving the `(select …)` wrapping that `20260821182457` introduced for the InitPlan optimisation. Then `alter policy … rename to dosage_changes_delete_uncommitted_own`. No other table, policy, grant, or column is touched, and no type changes, so `npm run db:types` is **not** part of this phase.

The migration header must record: what the invariant was, what it is now, that S-05 later relies on the unchanged `> current_date` half for future-dated rows, and the UTC caveat the original policy already carried at `:287-289`.

### Success Criteria

#### Automated Verification

- `npm run db:reset` applies both existing migrations plus the new one with no error
- `npm run db:test` still reports **70 passing assertions**, unchanged
- `npm test` still reports **15 passing tests**, unchanged
- `npm run lint` passes with 0 errors and 0 warnings

#### Manual Verification

- In Studio, as an authenticated role, a `dosage_changes` row with `effective_date = current_date` can be deleted; one with `effective_date = current_date - 1` cannot (reports 0 rows). Use plain statements only — `lessons.md` → _Hand Studio plain SQL statements, never dollar-quoted blocks_
- `select polname from pg_policy` confirms the renamed policy exists and the old name does not

**Implementation Note**: `npm run db:reset` is the exclusive claim on the shared local stack — the S-03 session's worktree shares it. Announce the claim, run this phase's database steps end to end, then release. Do not interleave. Pause here for manual confirmation before Phase 2.

---

## Phase 2: Validation schema and data module

### Overview

The whole domain lives here. Four zod schemas and one data module; no route or component in this phase.

### Changes Required

#### 1. Validation schemas

**File**: `src/lib/validation/medication.ts`

**Intent**: One definition per input shape, imported by both the island and its route so client and server validation cannot drift — the S-01 rule. Every bound must mirror a database CHECK where one exists, and supply a bound where the column is unbounded.

**Contract**: four exported schemas plus their inferred types.

- `medicationDetailsSchema` — `name` (trimmed, 1–120, mirroring `medications_name_not_blank`), `specialist_id` (uuid), `expiry_date` (ISO `YYYY-MM-DD` date string).
- `dosageInputSchema` — `daily_dosage`, a non-negative finite number with a sane upper bound, mirroring `dosage_changes_daily_dosage_non_negative`. **Zero is valid and is not an error** — it is how the user records "stopped".
- `supplyInputSchema` — `{ kind: "refill", amount }` with `amount > 0` (mirroring `supply_events_refill_is_positive`), or `{ kind: "correction", counted }` with `counted >= 0`. A zod discriminated union on `kind`.
- `medicationCreateSchema` — `medicationDetailsSchema` extended with `daily_dosage` and a starting `quantity` (`>= 0`).

`form` is absent from every schema. A body carrying `form`, `container_capacity`, `estimated_daily_consumption`, `post_opening_expiry_days`, or `opened_on` must be rejected rather than stripped, so S-06's columns cannot be populated by an API caller before S-06 exists. `numeric` columns are unbounded in the database (F-01 follow-up F2 is still queued), so these schemas are currently the only guard against an absurd magnitude.

#### 2. Data module

**File**: `src/lib/db/medications.ts`

**Intent**: Every read and write for the slice, owning all multi-statement sequencing so no route issues two writes. Follows `src/lib/db/specialists.ts` exactly for `Result<T>`, error-kind mapping, `logDbError`, chained `.select()`, and the no-`user_id`-filter rule.

**Contract**:

- `MedicationErrorKind = "not_found" | "no_specialist" | "unknown"` — `no_specialist` maps the FK violation (`23503`) raised when `specialist_id` names a specialist that does not exist or belongs to another user. It answers **`400` with `fieldErrors.specialist_id`**, not `409`: `CLAUDE.md` → _API conventions_ reserves `409` for "blocked by references" — a delete refused because children point at the row, which is `deleteSpecialist`'s case and the opposite direction of travel. Here the reference is unresolvable, the value came from a form `<select>`, and a field error is the shape the island can act on. S-03 maps the same violation the same way; do not "restore" this to `409`.
- `MedicationView` — the row plus `specialist` (id, name, specialty), `current_dosage: number`, `quantity_on_hand: number`, and `status`.
- `listMedications(client)` → `Result<MedicationView[]>`. One query embedding `specialists(…)`, `dosage_changes(daily_dosage, effective_date)` and `supply_events(quantity_delta)`, ordered by `name`, **not** filtered on `archived_at` — the island owns the toggle. Folds each row in TypeScript: current dosage is the `daily_dosage` of the row with the greatest `effective_date` not after today (no row ⇒ `0`); quantity is the sum of every `quantity_delta` (no rows ⇒ `0`). This is the S-04 replacement point — when the current-state views land, this function's body changes and its signature does not.
- `createMedication(client, input)` → `Result<MedicationView>`. Three ordered inserts: `medications` (`form` can be left to its `not null default 'solid'` at `20260813185255_domain_schema.sql:64` — writing it explicitly is harmless but buys nothing; what actually has to hold is that **all four** liquid columns stay NULL, `opened_on` included, or `medications_liquid_fields_match_form` rejects the row), then `dosage_changes` at today's UTC date, then — **only when `quantity > 0`** — a `refill` event. A failure after the first insert leaves a legitimate row (see below) and is reported as success with whatever landed, not as a create failure.
- `updateMedicationDetails(client, id, input)` → `Result<MedicationView>`. Explicit payload of `name`, `specialist_id`, `expiry_date`, `updated_at`; never a spread. `.select()` for the zero-row 404.
- `setDosage(client, id, daily_dosage)` → `Result<MedicationView>`. DELETE where `medication_id = id and effective_date = today`, chaining `.select("daily_dosage")` so the removed value comes back, then INSERT. **If the INSERT fails, re-insert the captured value before returning the error**, and log that compensating write under its own operation name. See _Critical Implementation Details_ for why `.upsert()` is not an option and why the DELETE must be reversible.
- `recordSupply(client, id, input)` → `Result<MedicationView>`. A `refill` inserts `{ event_type: "refill", quantity_delta: amount }`. A `correction` reads the current ledger sum, computes `counted − sum`, returns the unchanged row without writing when that delta is `0`, and otherwise inserts `{ event_type: "adjustment", quantity_delta: delta }`. `counted_quantity` and `projected_quantity` stay null — the CASE CHECK requires that for a non-recount.
- `setArchived(client, id, archived)` → `Result<MedicationView>`. Sets `archived_at` to now or null, plus `updated_at`. Chained `.select()`.

**Ownership of the "legal states" rule.** The developer's framing, verbatim from planning: _"When user stops use a medication it should be visible on the list of medications … so dosage equal to 0 is proper state, quantity equal to 0 — user used all the medicine and doesn't have new part — is also possible."_ The module therefore never reports these as errors and never flags a row as incomplete. `status` is derived, in this precedence order:

1. `archived_at` is set → `archived`
2. `current_dosage === 0` → `not_used` (intent is the more informative fact than emptiness)
3. `quantity_on_hand <= 0` → `out_of_stock`
4. otherwise → `active`

Expiry is reported separately as a boolean, not folded into `status`, because a medication can be expired _and_ in any of the four states.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with 0 errors and 0 warnings
- `npm run build` succeeds (type checking is part of the Astro build)
- No `console.` call outside the single `logDbError` helper: `grep -rn "console\." src/lib/db/medications.ts` returns exactly one line
- No `user_id` filter: `grep -n "user_id" src/lib/db/medications.ts` returns no `.eq("user_id"` occurrence

#### Manual Verification

- Read the module against `src/lib/db/specialists.ts` and confirm the `Result`, logging, and `.select()` conventions match
- Confirm no `.upsert(` appears anywhere in the file
- Confirm `setDosage` captures the deleted row's `daily_dosage` and re-inserts it when the replacement INSERT fails, and that the compensating write logs under its own operation name
- Run `listMedications` against the local stack and confirm all three embeds resolve and the fold returns the expected current dosage and quantity. A PostgREST `Could not embed` failure is a runtime 300, not a type error, so neither lint nor build can catch it — and no existing code embeds row-level child relations, only the `count` aggregates at `src/lib/db/specialists.ts:42-59`, whose own comment records that the composite-FK embed had to be verified against the stack rather than assumed

**Implementation Note**: Writing the schemas and the module touches no database, so that work can proceed freely while the S-03 session works. The `listMedications` check above is the exception — it issues a real query and needs the stack in this worktree's shape, so claim it for that one step and release. Pause for manual confirmation before Phase 3.

---

## Phase 3: API routes

### Overview

Five route files, each a thin adapter: authenticate, resolve the client, guard the body, parse with the shared schema, delegate one call to the data module, map the error kind onto a status.

### Changes Required

#### 1. Collection route

**File**: `src/pages/api/medications/index.ts`

**Intent**: List and create. Mirrors `src/pages/api/specialists/index.ts` line for line.

**Contract**: `GET` → `200` with `MedicationView[]`, `401` unauthenticated, `500` on `unknown`. `POST` validates with `medicationCreateSchema` → `201` with the created `MedicationView`; `400` on malformed JSON or validation failure; `400` on `no_specialist`, carrying `fieldErrors.specialist_id` so the island renders it under the specialist `<select>` exactly as a zod failure would. Only `parsed.data` reaches the module.

#### 2. Item route

**File**: `src/pages/api/medications/[id].ts`

**Intent**: Edit the medication's own columns. Mirrors `src/pages/api/specialists/[id].ts`, including its `readId` uuid guard and the reason a non-uuid segment answers `404` rather than `500`.

**Contract**: `PATCH` validates with `medicationDetailsSchema` → `200` with the updated `MedicationView`; `404` on `not_found`; `400` on `no_specialist`, again with `fieldErrors.specialist_id`. **No `DELETE` export** — FR-007 archives, and the database has no DELETE policy to back one.

#### 3. Dosage route

**File**: `src/pages/api/medications/[id]/dosage.ts`

**Intent**: Record the current daily dosage, including `0`.

**Contract**: `POST` validates with `dosageInputSchema` → `200` with the refreshed `MedicationView`; `404`, `400`, `500` as above.

#### 4. Supply route

**File**: `src/pages/api/medications/[id]/supply.ts`

**Intent**: Record a refill or a count correction.

**Contract**: `POST` validates with `supplyInputSchema` (discriminated on `kind`) → `200` with the refreshed `MedicationView`. A correction that resolves to a zero delta is a successful no-op, not a `400`.

#### 5. Archive route

**File**: `src/pages/api/medications/[id]/archive.ts`

**Intent**: Archive or restore. A separate route rather than a boolean inside `medicationDetailsSchema`, so a details edit does not have to resend archival state and so `zodFieldErrors` keeps mapping one-to-one onto form fields.

**Contract**: `POST` with `{ archived: boolean }` → `200` with the refreshed `MedicationView`; `404` on `not_found`.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with 0 errors and 0 warnings
- `npm run build` succeeds
- Every route guards `context.locals.user` and a null client before any work: `grep -rn "Sign in to continue" src/pages/api/medications/ | wc -l` equals the number of exported handlers (six across the five files: `GET` and `POST` on the collection, `PATCH` on the item, and a `POST` on each of dosage, supply, and archive). Use `grep -r`, not a `**` glob: bash without `globstar` expands `**` as a single `*`, which would silently skip `index.ts` and `[id].ts` and check only the nested files
- No route spreads a request body: `grep -rn "\.\.\.body\|\.\.\.parsed" src/pages/api/medications/` returns nothing

#### Manual Verification

- With the dev server running (and **no build running concurrently** — `lessons.md` → _Never run a production build against a live dev server_), exercise each route with the browser devtools console against a real session: create, patch, set dosage twice in one minute (the second must succeed — this is Phase 1's payoff), refill, correct downward, archive, restore
- A `PATCH` naming another user's `specialist_id` answers `400` with `fieldErrors.specialist_id`, not `500`
- A malformed body answers `400` in the `{ error: { message } }` shape
- A `POST` to the create route carrying `form: "liquid"` is rejected

**Implementation Note**: The manual steps here read and write the local database, so they need the stack in this worktree's shape. S-03 is forbidden from resetting it — see that plan's _Sharing the local stack with S-02_ — so Phase 1's migration is still applied and no rebuild by the sibling session has to be assumed. What that session does leave behind is **rows**: its suites write against this database without truncating. Re-run `npm run db:reset` from here only if this slice's own manual walk needs clean tables. Pause for manual confirmation before Phase 4.

---

## Phase 4: Page, island, and navigation

### Overview

The visible slice. SSR the list and the specialist options in frontmatter, hand both to a `client:load` island that owns every mutation.

### Changes Required

#### 1. Page

**File**: `src/pages/medications.astro`

**Intent**: Server-render the list so it paints with the page — no loading flash, no round trip before first paint, which is the strongest answer to the sub-1s mobile NFR. Mirrors `src/pages/specialists.astro`.

**Contract**: Resolves the client in frontmatter, calls `listMedications` and `listSpecialists`, and renders `<MedicationsManager initialMedications={…} specialists={…} client:load />` inside the same `Layout` + `Topbar` + `max-w-3xl` shell `specialists.astro` uses. Carries the same `loadFailed` fallback paragraph. When the specialist list is empty it renders a short explanation and a link to `/specialists` **instead of** the add form, because `specialist_id` is `not null` and the form cannot be completed.

#### 2. Island

**File**: `src/components/medications/MedicationsManager.tsx`

**Intent**: All mutations, all local state, all derived-status rendering. Follows `SpecialistsManager.tsx` for `readApiError`, the `pending` lock shared across every control, the `aria-live="polite"` notice region present on first paint, and the post-delete focus hand-off.

**Contract**: props `{ initialMedications: MedicationView[]; specialists: SpecialistWithUsage[] }`. Sections: an add form (name, specialist `<select>`, expiry date, starting daily dosage, starting quantity), the notice region, a "Show archived" toggle, and the list.

Each row shows name, specialist name, expiry date, current dosage, quantity on hand, and a status badge. Row controls: **Edit details** (inline form, as S-01 does), **Change dosage** (a number input plus an explicit _Stop taking this_ affordance that submits `0`), **Add refill**, **Correct amount**, and **Archive** / **Restore**. Archive is confirmed through `AlertDialog`; restore is not, because it is not destructive.

Badge tokens — green is rationed per `CLAUDE.md` → _Design conventions_, and there is no amber token in `:root`:

| Status         | Token                               |
| -------------- | ----------------------------------- |
| `active`       | `text-primary` (green-700)          |
| `not_used`     | `text-muted-foreground`             |
| `out_of_stock` | `text-destructive`                  |
| `archived`     | `text-muted-foreground`             |
| expired (flag) | `text-destructive`, rendered beside |

Every badge carries a word, never colour alone. The status label must read as a fact, not a warning: _Not used_ and _Out of stock_ are states the user chose or arrived at, and the copy says so.

#### 3. Route protection and navigation

**Files**: `src/middleware.ts`, `src/components/Topbar.astro`

**Intent**: `/medications` joins the protected set and the nav bar.

**Contract**: append `"/medications"` to `PROTECTED_ROUTES`; append `{ href: "/medications", label: "Medications" }` to `navLinks`, between Dashboard and Specialists. No other middleware change — `GUEST_ONLY_ROUTES` is S-01's queued follow-up and stays out.

#### 4. Documentation

**File**: `CLAUDE.md`

**Intent**: Record the two rules this slice discovered that a future slice would otherwise re-learn the hard way.

**Contract**: under _Domain schema_, add that `.upsert()` is unusable on `dosage_changes` and `supply_events` because neither has an UPDATE policy, and the date rule agreed with S-03 (see _Parallel-slice coordination_ → _The cross-slice date rule_): a date column an RLS policy compares against Postgres `current_date` — today `dosage_changes.effective_date`, and `supply_events.occurred_on` by symmetry — is resolved in **UTC**, because that `current_date` is UTC.

Write it as that column-scoped rule, **not** as "all application dates are UTC". S-03 resolves a visit's "today" in the user's stored zone and is right to; the two slices must land one policy with two branches, not two policies that contradict.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with 0 errors and 0 warnings
- `npm run build` succeeds (dev server **stopped** first)
- `npm run db:test` and `npm test` still green — nothing in this phase should move them

#### Manual Verification

- Signed out, `/medications` redirects to `/auth/signin`; signed in, it renders
- With zero specialists, the page explains why and links to `/specialists`; the add form is absent
- Add a medication with dosage 1 and quantity 30 → row shows dosage 1, quantity 30, **Active**
- Change its dosage to 2, then immediately to 3 → both succeed and the row shows 3 (Phase 1's payoff, and the specific thing that was impossible before)
- _Stop taking this_ → dosage 0, badge reads **Not used**, the row stays visible
- Add a medication with quantity 0 → badge reads **Out of stock**, no error
- Refill +20 then correct to 5 → quantity reads 5; correcting to 5 again is a silent no-op
- Set an expiry date in the past → the expired flag renders alongside the status badge
- Archive → the row leaves the list; enable **Show archived** → it returns marked **Archived**; restore → it rejoins the active list
- Edit a medication onto a different specialist; the row updates
- Topbar shows **Medications** and marks it active on this page
- At a 320 px viewport there is no horizontal scrolling anywhere on the page, including the add form and an expanded edit form
- Keyboard-only: every control is reachable and the archive dialog traps and restores focus

**Implementation Note**: The dev server must be stopped before `npm run build` and vice versa — they share `node_modules/.vite` and overlapping them has previously produced a `200` with a zero-byte body whose stack trace named an innocent file (`lessons.md` → _Never run a production build against a live dev server_).

---

## Testing Strategy

**This slice adds no automated tests.** Explicit decision on 2026-08-27: a dedicated test slice will cover the medications data layer, S-01's still-queued specialists tests, and the island branches together. The specification for what that slice must assert already exists at `context/changes/manage-medications/follow-ups/deferred-tests.md`, written alongside this plan, so it sits in the queue that gets read rather than only in this document.

What still runs, as a regression net rather than as new coverage:

- `npm run db:test` — the existing 70 pgTAP assertions, chiefly to prove Phase 1's policy change broke no invariant.
- `npm test` — the existing 15 integration tests, which already exercise `medications` inserts, the archival-not-deletion rule, the recount CHECK arithmetic, and the liquid CHECK through PostgREST.

**Accepted gap, stated plainly.** The three genuinely novel mechanisms in this slice — the non-atomic three-insert create, the DELETE-then-INSERT same-day dosage replace, and the read-then-write correction arithmetic — have no machine coverage and are verified only by the manual steps above. The create sequence in particular fails in a way manual walking is poor at catching, because a partial result is indistinguishable from a legitimate state by design.

### Manual Testing Steps

The per-phase Manual Verification lists are the procedure. The end-to-end walk, once Phase 4 lands: sign in → `/specialists` add one → `/medications` add a medication → change dosage twice → stop it → restart it → refill → correct downward → archive → restore → reload the page and confirm every value survived the round trip to the database.

## Performance Considerations

`listMedications` fetches every `dosage_changes` and `supply_events` row for every medication and folds them in TypeScript. At the PRD's stated volume — up to 20 medications, one user — this is a single query returning a few hundred rows and is comfortably inside the sub-1s NFR. It does **not** scale: a user two years in with daily events would pull thousands of rows to compute two numbers. S-04's current-state views are the structural fix, and Phase 2 keeps `listMedications`'s signature stable so that swap is a body change.

Fetching archived rows alongside active ones bypasses `medications_user_id_active_idx`, which is partial on `archived_at is null`. Deliberate, and irrelevant at this volume.

## Migration Notes

One migration, local only. It is a policy relaxation, so it is safe to apply to a populated database and needs no data backfill. Pushing to cloud is out of scope here — queued alongside the other follow-ups, and per `lessons.md` a push is set up in PowerShell with `$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"` on its own line, never as a command prefix.

**Rollback**: re-run `alter policy` with the original `> current_date` predicate and rename back. No data is destroyed by either direction.

**Shared-stack discipline**: `supabase/config.toml` pins `project_id` and fixed ports, so `npm run db:reset` from this worktree removes the S-03 worktree's schema, not merely its rows. Claim the stack for Phase 1's database steps and for Phase 3's and Phase 4's manual walks, and release between. This slice runs `db:types` **nowhere** — a policy change alters no types — which removes the quiet failure mode from that lesson.

## Parallel-slice coordination

S-03 (`manage-doctor-visits`) is planned in a sibling worktree and edits **five of the same files**. A trial merge of the two branches already conflicts _today_, before either has written a line of code — both flipped their own roadmap row from `proposed` to `planning` on adjacent lines of the same table.

| File                                | S-02 (`manage-medications`) writes             | S-03 (`manage-doctor-visits`) writes                   |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| `context/foundation/roadmap.md`     | its own row + status block -> `planning`       | its own row + status block -> `planning`               |
| `src/middleware.ts:4`               | appends `"/medications"` to `PROTECTED_ROUTES` | appends `"/visits"`                                    |
| `src/components/Topbar.astro:4-7`   | inserts a `Medications` nav entry              | inserts a `Visits` nav entry                           |
| `src/components/form/FormField.tsx` | consumes it unchanged                          | adds a `${id}-hint` id and widens `aria-describedby`   |
| `CLAUDE.md`                         | two rules at the tail of `## Domain schema`    | a dates rule and a `src/components/form/` rule         |
| date resolution                     | derives UTC `today` inside the data module     | creates `resolveToday(timeZone)` in `src/lib/dates.ts` |

`src/middleware.ts:4` is the certain one: a single-line array literal that both branches rewrite, so the conflict is unavoidable and the resolution unambiguous. `Topbar.astro` takes two entries at the same insertion point. None of this is hard to resolve; the risk is resolving it blind and silently dropping one slice's route guard or nav entry.

**Rule**: whichever slice merges second re-applies its own one-liners by hand rather than accepting either side of a conflict hunk, then confirms `PROTECTED_ROUTES` contains **both** `/medications` and `/visits`, and the topbar renders **both** entries. S-02's requested `navLinks` order (Medications between Dashboard and Specialists) will not survive a merge on its own and must be re-checked at that point.

### The cross-slice date rule

Agreed with S-03 on 2026-08-28, before either slice writes code, because the two plans reached opposite defaults independently and each was right about its own column.

- A date column an **RLS policy compares against Postgres `current_date`** is resolved in **UTC**. Today that is `dosage_changes.effective_date`, and `supply_events.occurred_on` by symmetry. `current_date` on Supabase is UTC, so a zone behind it — UTC-8 at 22:00 local writes _yesterday_ — would produce a row failing `effective_date >= current_date`, leaving the dosage just set uncorrectable. That is the precise bug Phase 1's migration exists to remove, so a user-local date here would reintroduce it for every western zone.
- A date resolved for **user-facing classification** — S-03's Upcoming/Past split — is resolved in the **user's stored zone**.
- **The two "todays" may differ by one calendar day, and that is intended.** S-04 must not assume the dashboard's "today" and a medication's `effective_date` were resolved the same way; S-05's segment boundaries sit directly on this seam.

**This slice does not import S-03's `src/lib/dates.ts`.** Depending on a file the sibling branch creates trades a merge conflict for a build dependency and destroys the parallelism both plans are built on. Keep deriving UTC `today` inside the data module; unification is the second merger's task, below.

### Merge order

**S-02 merges first.** It owns the migration, and S-03's plan forbids it from running `db:reset` — so S-03's suites can only ever run against the schema this slice applies. Merging S-03 first leaves this branch's migration unapplied beneath a database S-03 is not permitted to rebuild.

**S-03 merges second**, carrying three reconciliation tasks beyond re-applying its own one-liners:

1. `PROTECTED_ROUTES` holds **both** `/medications` and `/visits`, and the topbar renders **both** entries in the order this slice requested.
2. Swap this slice's inline UTC `today` derivation for `resolveToday("UTC")`, so one resolver serves both slices and the `CLAUDE.md` rule becomes true of the code rather than aspirational.
3. Migrate this slice's specialist `<select>` in `MedicationsManager` to S-03's `SelectField`, which was written against `FormField`'s prop contract for exactly this. **Do not build `SelectField` in this slice** — both branches creating the same new file is a create/create conflict, strictly worse than the inline control it would replace.

## References

- Roadmap: `context/foundation/roadmap.md` → S-02
- PRD: `context/foundation/prd.md` → FR-004, FR-005, FR-007, Business Logic
- Prior slice (the pattern this copies): `context/changes/manage-specialists/plan.md`
- Schema: `supabase/migrations/20260813185255_domain_schema.sql:59-201`, `:275-303`
- Data-module pattern: `src/lib/db/specialists.ts`
- API contract: `src/lib/api/json.ts`, `CLAUDE.md` → _API conventions_
- Recurring rules: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Relax the same-day dosage lock

#### Automated

- [x] 1.1 `npm run db:reset` applies all migrations with no error — 3455061
- [x] 1.2 `npm run db:test` still reports 70 passing assertions — 3455061
- [x] 1.3 `npm test` still reports 15 passing tests — 3455061
- [x] 1.4 `npm run lint` passes at 0 errors, 0 warnings — 3455061

#### Manual

- [x] 1.5 A `dosage_changes` row at `effective_date = current_date` deletes; one at `current_date - 1` does not — 3455061
- [x] 1.6 The renamed policy exists in `pg_policy` and the old name does not — 3455061
- [x] 1.7 `follow-ups/deferred-tests.md` written with the specification for the future test slice — landed with the plan commit, before implementation starts

### Phase 2: Validation schema and data module

#### Automated

- [x] 2.1 `npm run lint` passes at 0 errors, 0 warnings — 3a34bdd
- [x] 2.2 `npm run build` succeeds — 3a34bdd
- [x] 2.3 Exactly one `console.` call in `src/lib/db/medications.ts` — 3a34bdd
- [x] 2.4 No `.eq("user_id"` in `src/lib/db/medications.ts` — 3a34bdd

#### Manual

- [x] 2.5 Module conventions match `src/lib/db/specialists.ts` — 3a34bdd
- [x] 2.6 No `.upsert(` anywhere in the file — 3a34bdd
- [x] 2.7 `setDosage` captures the deleted dosage and re-inserts it if the replacement INSERT fails — 3a34bdd
- [x] 2.8 `listMedications` runs against the local stack: three embeds resolve and the fold returns the expected dosage and quantity — 3a34bdd

### Phase 3: API routes

#### Automated

- [x] 3.1 `npm run lint` passes at 0 errors, 0 warnings — 361baa9
- [x] 3.2 `npm run build` succeeds — 361baa9
- [x] 3.3 Every handler guards `context.locals.user` and a null client — 361baa9
- [x] 3.4 No request body is spread in any route — 361baa9

#### Manual

- [x] 3.5 Create, patch, dosage-twice-in-a-minute, refill, correct, archive, restore all answer as specified — 361baa9
- [x] 3.6 A `PATCH` naming another user's `specialist_id` answers 400 with `fieldErrors.specialist_id` — 361baa9
- [x] 3.7 A malformed body answers 400 in the contract's shape — 361baa9
- [x] 3.8 A create carrying `form: "liquid"` is rejected — 361baa9

### Phase 4: Page, island, and navigation

#### Automated

- [x] 4.1 `npm run lint` passes at 0 errors, 0 warnings
- [x] 4.2 `npm run build` succeeds with the dev server stopped
- [x] 4.3 `npm run db:test` and `npm test` still green

#### Manual

- [x] 4.4 Signed out redirects to `/auth/signin`; signed in renders
- [x] 4.5 Zero specialists shows the explanation and link, and no add form
- [x] 4.6 Add with dosage 1 / quantity 30 shows Active
- [x] 4.7 Two dosage changes in one minute both succeed
- [x] 4.8 Stop taking this → dosage 0, badge Not used, row still visible
- [x] 4.9 Add with quantity 0 → badge Out of stock, no error
- [x] 4.10 Refill +20 then correct to 5 → quantity 5; repeating the correction is a no-op
- [x] 4.11 A past expiry date renders the expired flag
- [x] 4.12 Archive, Show archived, and Restore all behave as specified
- [x] 4.13 Reassigning the specialist updates the row
- [x] 4.14 Topbar shows Medications and marks it active
- [x] 4.15 No horizontal scrolling at 320 px, including expanded forms
- [x] 4.16 Keyboard-only navigation reaches every control; the archive dialog traps and restores focus
- [x] 4.17 `CLAUDE.md` records the upsert rule and the column-scoped date rule agreed with S-03, phrased so it does not contradict S-03's user-zone resolution
