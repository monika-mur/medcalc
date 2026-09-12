# Mid-supply Dosage Change (S-05) Implementation Plan

## Overview

FR-006 and US-02: the user schedules a future dosage change — a new daily amount with an
effective date — and the dashboard immediately recalculates the supply-end date using the
old dose through the day before the change and the new dose from the change onward.

This is the roadmap's **north star**, the case the Vision says existing medication apps get
wrong. It is also, in code terms, the smallest of the remaining slices: the segmental
arithmetic already exists and already handles future-dated rows. What does not exist is a
way to write one, a guard against writing one in the past, and a vocabulary for a
medication whose dosage has not started yet.

## Current State Analysis

**The engine is finished.** `src/lib/supply.ts` was written during S-04 with this slice
named in its header — _"Written so S-05's future-dated dosage rows are simply more
breakpoints: the walk needs no change to accommodate them."_ Every `effective_date` is
already a breakpoint (`supply.ts:97-108`), the set is already bounded at
`bound = max(today, expiryDate)` so a row effective after expiry cannot produce a
supply-end date past the cap, and `doseInForce` (`supply.ts:55-64`) already selects the
greatest `effective_date` not after the date asked about. **No line of `src/lib/supply.ts`
is modified by this plan.**

**The schema is finished too.** `dosage_changes` carries
`unique (medication_id, effective_date)` — one dosage in force per medication per day — and
`dosage_changes_delete_uncommitted_own` permits DELETE while `effective_date >= current_date`.
The header of `20260829071323_relax_same_day_dosage_correction.sql:22-26` states the `>` half
of that predicate exists **for this slice**: a future-dated row must stay deletable until it
takes effect.

**Three things are missing, and one is a hole.**

1. **No way to send a date.** `dosageInputSchema` is `z.strictObject({ daily_dosage })` — a
   body carrying `effective_date` is _rejected_, not stripped. `setDosage`
   (`src/lib/db/medications.ts:393-445`) hardcodes `const written = todayUtc()` for both the
   DELETE `.eq()` and the INSERT. The panel hint reads "Takes effect today."

2. **The past is unguarded on INSERT.** `dosage_changes_insert_own` is
   `with check ((select auth.uid()) = user_id)` and nothing more. The DELETE policy guards
   the past; the INSERT policy does not. Today that is harmless because no route accepts a
   date. The moment one does, a raw request can back-date a row and rewrite the historical
   series the segmental calculation reads — the exact thing
   `20260813185255_domain_schema.sql:285-287` says the immutability rule exists to prevent.

3. **"Not yet started" reads as "Stopped".** A medication whose dosage rows are _all_
   future-dated folds to `current_dosage: 0` → `deriveStatus` sees
   `dosageCount > 0 && currentDosage === 0` → `not_used` → `/medications` says **"Not used"**
   and the dashboard card says **"Stopped"** with the reason line _"Dosage is set to 0, so
   nothing is being consumed."_ S-04 flagged this in writing and handed it here
   (`plan.md:187`, `change.md:351-356`): unreachable in S-04 because no surface could create
   the row, and _"S-05's whole purpose is writing one"_.

   **That last quote overstates what this slice does, and the correction matters.** Scheduling
   a change does not produce the state: a medication created through the UI always carries a
   row at `todayUtc`, so adding a future-dated one leaves two rows and the status stays
   `active`. "All rows future-dated" needs the today-or-earlier rows _gone_. The only path
   this slice opens is Phase 2 §6's cancel endpoint applied to today's date — which the DELETE
   policy permits, since it admits `effective_date >= current_date`. So the state is reachable
   by API, not through the panel, and the fixtures in _Testing Strategy_ still reach it through
   Studio. Raised in plan-review as F7.

**One latent error path becomes reachable.** `setDosage` maps every insert error that is not
`23503` to `"unknown"` → 500. It has **no `23505` branch**. With a single hardcoded date the
DELETE always clears the way first, so a uniqueness collision cannot happen; with user-chosen
dates and several pending rows it would become an ordinary mistake. Resolved below by keeping
the delete-then-insert keyed on the _target_ date, which preserves the by-construction
unreachability rather than adding a branch to handle it.

## Desired End State

On `/medications`, the "Change dosage" panel carries an effective-date field defaulting to
today. Leaving it at today behaves exactly as it does now. Choosing a future date writes a
scheduled change instead: the panel lists every pending change for that medication with a
Cancel control on each, and choosing a date that already holds a pending change asks for
confirmation before replacing it.

On `/dashboard`, a medication with a scheduled change shows one extra line naming it —
"Changes to 1.5 / day on 2026-09-21" — and its supply-end date and colour already reflect the
segmental calculation. A medication whose dosage has not started yet reads **"Starts
2026-09-21"**, not "Stopped".

At the database, `dosage_changes_insert_own` refuses any row dated before `current_date`.

**Verification.** Create a medication at 1/day with 30 on hand and a visit far out; note the
supply-end date. Schedule 3/day from a week today. The supply-end date must move earlier by
the amount the segmental walk predicts — 7 days at 1/day leaves 23, ÷3 is 7 more days — the
card must name the change, and the status must reclassify if the band changed. Cancel it; the
original date must return exactly.

### Key Discoveries

- `src/lib/supply.ts:24` — the engine's header names this slice as the reason it is shaped
  the way it is. `supply.ts:97-108` bounds the breakpoint set; `supply.ts:55-64` is
  `doseInForce`. **Do not modify this file.**
- `supabase/migrations/20260829071323_relax_same_day_dosage_correction.sql:22-26` — the `>`
  half of the DELETE predicate exists for this slice. Widening `>` to `>=` preserved it
  strictly; narrowing it back would break the cancel path.
- `src/lib/db/medications.ts:393-445` — `setDosage`'s DELETE-then-INSERT, its chained
  `.select("daily_dosage")` capturing what was removed, and the compensating restore at
  `:432-440`. `.upsert()` is impossible: PostgREST compiles it to `ON CONFLICT DO UPDATE` and
  there is no UPDATE policy.
- `src/lib/db/medications.ts:149-160` — `deriveStatus` already separates "no row" from "row
  says 0" by testing `dosageCount`, not the value. The new state is the third question in
  that family.
- `src/components/medications/MedicationsManager.tsx:53` — `PanelKind`; `:638-667` — the
  Radix `AlertDialog` confirm already used for Archive, the pattern the replace-confirm
  reuses.
- `src/lib/dashboard.ts:60-71` — `cardStateFor`; three `MedicationStatus` values short-circuit
  and the rest fall through to `classifySupplyStatus`.
- **The compiler's reach here is narrower than it looks, and this was checked.** Adding
  `not_started` to `MedicationStatus` (`medications.ts:31`) fails exactly two lines:
  `MedicationsManager.tsx:70` and `:78`, the two `Record<MedicationStatus, string>` maps.
  `CardState` (`dashboard.ts:27`) is structurally independent of `MedicationStatus` — it is
  `"no_dosage" | "stopped" | "out_of_stock" | SupplyStatus` — so `CARD_ORDER`
  (`dashboard.ts:82-90`) and `SupplyCard.astro:17-44` keep compiling. And `cardStateFor`
  (`dashboard.ts:60-71`), the only `switch` over `medication.status` in the tree, ends in
  `default:` with no `never` guard, so an unhandled variant falls through to
  `classifySupplyStatus` **silently**. Phase 4 §1 therefore adds that guard — otherwise the
  dashboard's half of this slice is discretionary, which is how S-04's defect got here.
  Raised in plan-review as F4.
- `src/lib/dates.ts:38-44` — `resolveToday(tz)`; `:71-74` — `resolveTodayForUser`.
  `medications.ts:119-121` — `todayUtc()`. The two-todays rule is `CLAUDE.md` → _Dates_.

## What We're NOT Doing

- **No change to `src/lib/supply.ts`.** The arithmetic is done. A plan that edits the engine
  to deliver this slice has misread it.
- **No _new_ automated tests of any kind** — not Vitest, and _not pgTAP for the new policy_.
  Explicit decision taken during planning with the trade-off stated: see _Testing Strategy_.
  It is the one place this plan knowingly departs from `lessons.md` → _State table privileges
  in the migration_, and Phase 1 records that in the migration header and in a follow-up file.

  **This does not extend to fixtures the migration invalidates.** Writing new coverage is
  deferred; repairing an existing assertion that Phase 1 breaks is Phase 1's job, because a
  suite that cannot run is not a deferred test, it is a red build. Phase 1 §2 is that repair.

- **Not fixing S-04 impl-review finding F0b**
  (`context/changes/supply-status-dashboard/follow-ups/timezone-classification.md`). That
  follow-up must decide _which date classifies a row at all_ and amend `CLAUDE.md` → _Dates_;
  it is a read-path redesign with four candidate designs and none obviously right. This slice
  widens the seam and says so in that file. It under-reports rather than over-reports, and no
  current user is in an affected zone.
- **No liquid medications** (S-06), no configurable thresholds, no split-dose entry, no
  history-browsing UI — all PRD non-goals or other slices.
- **No dosage-change entry on `/dashboard`.** That page mounts no island by deliberate S-04
  decision, for the sub-1-second NFR. It gains server-rendered text only.
- **No `clampScale` on `daily_dosage`.** The create and `setDosage` paths write it raw while
  the supply paths clamp. It is a real asymmetry, it predates this slice on both paths, and
  fixing it changes what S-02 and S-04 already wrote. Recorded as a follow-up instead.
- **No editing of a pending row in place.** There is no UPDATE policy and there will not be
  one. Cancel-and-reschedule is the whole vocabulary.
- **No cap on how many changes may be pending.** The unique constraint gives each date its own
  slot; the engine walks any number.

## Implementation Approach

Four phases, database outward, each independently verifiable.

The ordering is forced in one place: **the INSERT guard must land before any route accepts a
date**, because the window between "route accepts a date" and "database refuses a past one" is
a window in which the historical series is writable. That is Phase 1, and it is the only
migration.

Phases 2–4 then move outward — data module and API contract, then `/medications`, then
`/dashboard` — so each phase leaves the app working. After Phase 2 the capability exists and
is reachable by `curl`; after Phase 3 the user can drive it; Phase 4 explains it on the
dashboard.

## Critical Implementation Details

**Two clocks, and Phase 1 makes them matter.** `todayUtc()` reads the _Worker's_ clock;
`current_date` is _Postgres's_. Today nothing compares them. Once the INSERT policy reads
`effective_date >= current_date`, a request that computes `todayUtc()` at 23:59:59.9 UTC and
reaches Postgres after midnight is refused.

**It does not fail closed.** `setDosage` DELETEs the target row before it INSERTs
(`medications.ts:405-411`). If the day rolls between the two statements the DELETE has already
succeeded — the DELETE policy admitted it, because the date was still `>= current_date` when
it ran — and the INSERT is then refused `42501`. The compensating restore at `:432-440`
re-inserts at the _same_ now-past date, so it is refused too: the row is destroyed while the
route answers "nothing changed", and the loss renders as the deliberate "I have stopped taking
this" state. That is precisely the guarantee the function's header at `:385-392` says the
chained `.select("daily_dosage")` exists to provide. Phase 2 §2 closes it by re-resolving the
date on the restore path. (Raised in plan-review as F3; an earlier draft of this paragraph
claimed the window caused no corruption.)

The same window reaches `createMedication`, which logs a failed dosage insert and still
reports success (`medications.ts:300-305`), silently producing a `no_dosage` medication.
Phase 2 §7 maps that refusal to a failed create rather than letting it pass. The exposure is
not only post-merge: Phase 1 pushes the policy to cloud days before the PR lands, so production
runs S-04's code against the tightened predicate in the meantime.

**The minimum selectable date is UTC's today, not the user's.** The picker's `min` attribute,
the zod floor and the policy predicate must all name the same day, and the policy's day is
Postgres's. It must not be "fixed" by resolving the bound in the user's zone — doing so offers
a date the policy will refuse, which is the exact shape of the bug `20260829071323`'s header
describes.

How it reads on the user's wall clock depends on their side of UTC, and both directions
matter. **West** of UTC late in the evening, UTC has already rolled over, so the earliest
selectable date reads as "tomorrow". **East** of UTC early in the morning, UTC still lags, so
it reads as "yesterday". An earlier draft of this paragraph paired the east case with the
tomorrow reading; that pairing is backwards.

**Accepted risk, west of UTC: the panel's two days disagree.** Phase 2 §4 derives the pending
series against the **user's** today while this bound is UTC's. West of UTC in the evening
`utcToday > userToday`, so a medication's own current row — written at `todayUtc` — is
classified as pending: it appears in the pending list with a Cancel control, and the date
field's default value collides with it, firing the replace-confirm on an ordinary dosage
change. Phase 3's criterion _"Choosing today still replaces today's dosage with no confirmation
dialog"_ does not hold in those zones. Raised in plan-review as F5 and **accepted**: no current
user is in an affected zone, and the resolution is the same read-path question
`follow-ups/timezone-classification.md` already owns. Whoever fixes F0b fixes this with it.

**`setDosage`'s DELETE must key on the target date, not on today.** It currently does
`.eq("effective_date", written)` where `written = todayUtc()`. It must become the requested
date. This is what keeps `23505` unreachable by construction — the row occupying the target
slot is removed before the insert — and it is what makes "schedule onto a taken date" mean
"replace", the same semantics already live for today's row. The compensating restore at
`:432-440` keeps working unchanged, because it re-inserts at the same date variable.

## Phase 1: Guard the past at the database

### Overview

Tighten `dosage_changes_insert_own` so a row dated before `current_date` cannot be inserted,
closing back-dating before any route can send a date. Behaviour only — no table, column, type
or grant changes, so `npm run db:types` is not part of this phase.

### Changes Required:

#### 1. The migration

**File**: `supabase/migrations/<timestamp>_guard_dosage_effective_date_on_insert.sql`
(create with `npx supabase migration new guard_dosage_effective_date_on_insert`)

**Intent**: Make the immutability of the historical dosage series an enforced property rather
than an application convention, before S-05's route opens the door to violating it.

**Contract**: One `alter policy` statement. The predicate becomes
`(select auth.uid()) = user_id and effective_date >= current_date`. Keep the `(select …)`
wrapper — `20260821182457` rewrote every policy that way so the planner hoists it into a
once-per-statement InitPlan; a bare `auth.uid()` here would regress that.

The header must record, in the style of the three existing migrations:

- **What was true**: INSERT was guarded on ownership alone. DELETE has been guarded on
  `effective_date >= current_date` since `20260829071323`, so the past was protected against
  removal and not against rewriting.
- **Why now**: S-05 adds a user-chosen `effective_date` to the dosage route. Until this policy
  lands, that route can back-date a row.
- **The mirror**: the predicate is deliberately identical to the DELETE policy's. A row that
  can be inserted can be removed; a row that has taken effect can be neither. One rule.
- **The two-clock caveat**: `current_date` is Postgres's clock and the application derives
  `effective_date` from the Worker's. A request crossing UTC midnight between the two is
  refused. Sub-second, but it does **not** fail closed — `setDosage`'s DELETE has already
  committed by then, and its compensating restore is refused for the same reason the INSERT
  was. Phase 2 §2 re-resolves the date on the restore path; Phase 2 §7 stops
  `createMedication` reporting the refusal as success. See _Critical Implementation Details_.
- **That nothing asserts this policy.** Per this plan's testing decision no pgTAP assertion is
  added, which departs from `lessons.md` → _State table privileges in the migration_. Name the
  lesson, name the departure, and point at `follow-ups/deferred-tests.md`.
- **Rollback**: restore the ownership-only predicate. Neither direction destroys data.
- **Safe against a populated database**: a policy tightening needs no backfill. Existing rows
  are untouched; only future INSERTs are affected.

#### 2. Repair the pgTAP fixtures this policy invalidates

**File**: `supabase/tests/constraints.test.sql`

**Intent**: Keep `npm run db:test` runnable. This is fixture repair forced by the migration,
not the deferred test-writing — see _What We're NOT Doing_.

**Contract**: `constraints.test.sql:26` sets role `authenticated`, so every `dosage_changes`
insert below it is policy-checked. Four carry hardcoded past dates and all four are refused
`42501` under the new predicate: the **bare** insert at `:130` (`'2026-03-01'`) is not wrapped
in an assertion, so it aborts the transaction and takes every assertion after it with it; the
`23505` collision at `:133` and the `23514` negative-dosage check at `:147` would then fail
_for the wrong SQLSTATE_, because the file uses the four-argument `throws_ok` with a null
message and compares only the code; and the `lives_ok` at `:141` (`'2026-04-01'`) fails
outright.

Move the four to `current_date + N`, keeping `:130` and `:133` on the **same** day so the
unique-violation assertion still collides. Do **not** hoist the block above the `set local
role authenticated` at `:26` — that would run it as the table owner and stop it testing
anything under RLS.

The other three suites need no change, and the reason is worth recording: RLS is not `FORCE`d
anywhere, so `append_only.test.sql`'s past-dated fixtures (`:29-31`) and `rls.test.sql`'s
(`:149-151`) run as the owner because they sit **above** their own role switch.
`rls.test.sql:199-204` already expects `42501`. `supply_ledger.test.sql` and
`tests/integration/` never touch `dosage_changes` at all, so `npm test` is unaffected.

Raised in plan-review as F1.

#### 3. Apply to cloud

**File**: none — an operation, not an edit.

**Intent**: `lessons.md` → _Confirm every migration reached cloud_ records this failing twice
in five weeks, once leaving a 500 live in production for eight days. Merged and applied are
different states.

**Prerequisite — satisfied.** `scripts/check-migration-drift.mjs` did not exist on `master` at
plan-review time (raised as F2): `scripts/` held only `gen-db-types.mjs`, and the script lived
only on the unmerged branch `ci/migration-drift-check` (`01a79d5`), which `lessons.md` →
_Confirm every migration reached cloud_ already cited as though it were live. PR #38 landed
that branch on `master` (`dbb772c`, 2026-09-12), so `ci.yml` now runs "Check migrations are
applied to cloud" on every push, and the lesson's mitigation is no longer aspirational.

**Contract**: In PowerShell — `$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"` as its own statement,
once, then `npx supabase db push`. Close the step against `npx supabase migration list`
showing the new timestamp in the remote column, not against a green local suite.
`scripts/check-migration-drift.mjs` gates the deploy on this; do not route around it.

### Success Criteria:

#### Automated Verification:

- `ci/migration-drift-check` is merged to `master`, so `scripts/check-migration-drift.mjs`
  exists before the push
- `npm run db:reset` applies all migrations cleanly from scratch
- `npm run db:test` green with the repaired fixtures, at the same assertion count as before —
  and the two repaired `throws_ok` assertions still fail for their original SQLSTATEs
  (`23505`, `23514`), not for `42501`
- `npx supabase migration list` shows the new migration in the remote column
- `npm run lint` clean, `npm run typecheck` clean

#### Manual Verification:

- In Studio, as an authenticated test user, an INSERT into `dosage_changes` with
  `effective_date = current_date - 1` is refused; `current_date` and `current_date + 7` both
  succeed. Plain statements only — `lessons.md` → _Hand Studio plain SQL statements_.
- Creating a medication through the existing `/medications` form still succeeds and shows its
  dosage (proves `createMedication`'s UTC-derived insert still satisfies the new predicate)
- Changing today's dosage on an existing medication still works

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding. This phase has the only
migration and the only cloud push; everything downstream assumes both landed.

---

## Phase 2: The date through the domain layer and the API

### Overview

Carry an effective date from request to row, teach the read path to describe a dosage that has
not started, and expose the pending series. After this phase the capability is complete and
reachable by `curl`; no UI change yet.

### Changes Required:

#### 1. Validation schema

**File**: `src/lib/validation/medication.ts`

**Intent**: Accept an optional effective date on the dosage input, bounded so the form cannot
offer what the policy will refuse. Omitting it must keep meaning "today, derived server-side"
— that is what leaves every existing caller correct.

**Contract**: `dosageInputSchema` gains an optional `effective_date` typed with `z.iso.date()`,
matching how `medicationDetailsSchema` types `expiry_date`. The lower bound cannot live in the
static schema — it depends on the server's today — so export a factory
(`dosageInputSchemaFor(todayUtc: string)`) returning the bounded schema. **One export, not
two.** Both consumers call the factory: the route with its own resolved UTC today, the island
with the value the page passed down. An earlier draft also kept a today-independent export for
"the island's field-level checks" and then gave the island the factory anyway, leaving the
second export with no consumer — add it only when something actually needs it (plan-review
F10).

The comment block at the top of this file explains that every object is `strictObject` and
that a body carrying an unexpected key is _rejected, not stripped_. Extend it:
`effective_date` is the first date this codebase lets a client choose for a policy-compared
column, and the bound is the only thing standing between the form and a refused insert.
Cross-reference `CLAUDE.md` → _Dates_.

#### 2. `setDosage` keyed on the target date

**File**: `src/lib/db/medications.ts`

**Intent**: Let the caller name the date the dosage takes effect, defaulting to UTC today,
without changing the delete-then-insert shape that makes a collision unreachable.

**Contract**: `setDosage` takes the effective date as a parameter, defaulting to `todayUtc()`
when absent so existing call sites are unchanged in behaviour. Both the DELETE `.eq()` and the
INSERT use that date.

**The compensating restore at `:432-440` cannot stay as it is.** An earlier draft said it
could, on the reasoning that it re-inserts at the same date variable — which is exactly the
problem once that date can be refused. If the INSERT failed with `42501` because UTC midnight
passed after the DELETE committed, re-inserting at the same now-past date is refused for the
same reason, and the row the DELETE captured is lost for good. So: when the restore is itself
refused with `42501`, retry it **once** at a freshly-resolved `todayUtc()`, preserving the
dosage value at the new UTC day. Log both attempts under their own operation names. Guard the
retry so it fires only when the date was the server-derived default — a client-supplied date
that the policy refuses must not be silently relocated to another day. The resulting series
has nothing on the removed day, so `doseInForce` reads whatever preceded it there; that is a
one-day seam, and it is the cost of not destroying the value. Raised in plan-review as F3.

Add the missing error branch. A `with check` violation on INSERT raises **`42501`** (distinct
from the zero-rows semantics `append_only.test.sql:4-7` documents for a command with no
matching policy at all). Map it to a new `MedicationErrorKind` — `"date_not_allowed"` — so the
route can answer 400 with a field error rather than an unexplained 500. Log it (`lessons.md` →
_Log the database error before collapsing it to a domain kind_): reaching it means either a
raw request or the two-clock midnight window, and both are worth a trace.

Also return whether the DELETE removed anything, so the caller can distinguish "scheduled"
from "replaced" in its success message.

#### 3. Cancel a pending change

**File**: `src/lib/db/medications.ts`

**Intent**: Remove an uncommitted dosage row — one the DELETE policy still admits.

**Contract**: A new exported function taking the medication id and the effective date, issuing
a DELETE `.eq()` on both, chained with `.select()`. **Zero rows returned is a 404, not a
success** — `CLAUDE.md` → _API conventions_: under RLS a DELETE against a missing, foreign, or
already-effective row matches zero rows and returns success. Without the `.select()` check,
cancelling a stranger's row would answer 204. Returns the refreshed `MedicationView`.

**No date floor, and that is a decision rather than an oversight.** The DELETE policy admits
`effective_date >= current_date`, so this function also removes **today's** row — the dosage
currently in force — not only not-yet-effective ones. The panel never offers it, because
Phase 3 lists pending changes only; the API does. It is kept deliberately: it is the one path
that can produce a `not_started` medication through the app rather than through Studio, and
`setDosage` restores the row whenever the user wants it back. Say so in §6's route header so
the next reader does not "tighten" it into a bug. Raised in plan-review as F7.

#### 4. The new status and the pending series on the view

**File**: `src/lib/db/medications.ts`

**Intent**: Distinguish a medication whose dosage has not started from one the user stopped,
and expose the scheduled changes the UI must name.

**Contract**: `MedicationStatus` gains `not_started`. `deriveStatus` currently takes
`dosageCount`; it needs enough to tell "every row is future-dated" from "a row in force says
0", so pass the dosage rows — or a boolean precomputed in `toView` — rather than only the
count. Precedence: after `no_dosage` and before `not_used`, because a medication with no row
in force yet has no dosage today either way, and "has one scheduled" is the more specific
answer.

`MedicationView` gains the pending changes — rows with `effective_date > today` — sorted
ascending. **One field, not two**: an earlier draft added the soonest change alongside the
array it is the head of, which is a second copy of a value on a view whose schema rule is that
the absence of a second copy is what makes drift impossible. The dashboard's one-line summary
reads the head of the array at its single call site (plan-review F10).

Derive it in `toView` from the `dosage_changes` already embedded by `MEDICATION_SELECT`; no
extra query. Note in a comment that `today` here is the **user's** date, matching how
`current_dosage` and `is_expired` are already resolved, so "pending" means pending from the
reader's point of view — and that this is the day that disagrees with Phase 3's UTC-anchored
date field west of UTC, an accepted risk recorded under _Critical Implementation Details_.

#### 5. Route: extended dosage POST

**File**: `src/pages/api/medications/[id]/dosage.ts`

**Intent**: Accept the optional date, validate it against the server's UTC today, and map the
new error kind onto the contract's shape.

**Contract**: Resolve UTC today once, build the schema from the factory, parse. Pass the parsed
date (or `undefined`) to `setDosage`. Map `date_not_allowed` → **400** with
`fieldErrors.effective_date`; `not_found` → 404; everything else → 500, unchanged.

The route's header comment currently states _"The body carries no date"_ and explains why.
Rewrite it: the body may now carry one, the bound is UTC-derived server-side, and the reason
the _bound_ cannot come from the client is the same reason the date used to be derived — the
policy compares against Postgres `current_date`.

#### 6. Route: cancel a scheduled change

**File**: `src/pages/api/medications/[id]/dosage/[date].ts`

**Intent**: A cancel endpoint addressed by the thing being cancelled.

**Contract**: `DELETE`. Validate the path date with `z.iso.date()` — a malformed segment is a
**404**, matching how `readId` turns a non-uuid into 404 rather than letting Postgres `22P02`
surface as a 500 (`src/lib/api/params.ts:18-21`). Auth, client and id checks in the same order
as every sibling route. Returns the refreshed `MedicationView` as JSON, not 204 — the island
needs the recalculated row to update in place, the same reason the dosage POST returns one.

The header must record what §3 decided: this route also accepts **today's** date and removes
the dosage in force, because the DELETE policy admits `>= current_date` and that is the one
path to a `not_started` medication through the app. It is deliberate; do not add a floor.

#### 7. Stop `createMedication` reporting a refused dosage insert as success

**File**: `src/lib/db/medications.ts`

**Intent**: Close the one call site that swallows the failure Phase 1 makes possible. Named in
_Critical Implementation Details_ and, in an earlier draft, assigned to no phase item at all
(plan-review F6).

**Contract**: `createMedication` currently logs a failed `dosage_changes` insert and returns
success anyway (`medications.ts:298-305`), which under the new policy turns the two-clock
midnight window into a silently `no_dosage` medication. Map a `42501` there onto a failed
create rather than letting it pass — the medication row already exists at that point, so the
honest answer is an error naming the dosage, not a fabricated success. Keep the existing
`logDbError("create.dosage", …)` call; this adds a return path, not a second log.

Note the exposure is not only post-merge: Phase 1 pushes the policy to cloud days before this
code ships, so production runs S-04's `createMedication` against the tightened predicate in
the meantime. Nothing can be done about that window except to keep it short.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` clean — note this fails on `MedicationsManager.tsx:70` and `:78` only.
  It does **not** reach `dashboard.ts` or `SupplyCard.astro`: `CardState` is independent of
  `MedicationStatus` and `cardStateFor` ends in `default:`. Phase 4 §1 adds the guard that
  makes the dashboard's half compiler-mandated (plan-review F4)
- `npm run lint` clean at 0 errors, 0 warnings
- `npm run build` succeeds (dev server stopped first — `lessons.md` → _Never run a production
  build against a live dev server_)
- Existing pgTAP suite still green: `npm run db:test`

#### Manual Verification:

- `POST /api/medications/<id>/dosage` with `{"daily_dosage": 3, "effective_date": "<+7d>"}`
  returns 200 and a view whose `supply_end_date` has moved to the segmentally-correct date
- The same call with a past date returns **400** with `fieldErrors.effective_date`, not 500
- Posting with no `effective_date` behaves exactly as before (today's row replaced)
- `DELETE /api/medications/<id>/dosage/<date>` removes a pending row and returns the restored
  supply-end date; the same call for a date with no row returns **404**
- A `DELETE` for a date in the past returns 404 — confirming the zero-rows check is present
- A `DELETE` for **today's** date removes the in-force row and succeeds — the deliberate
  absence of a floor (§3), and the path that produces the next criterion's fixture
- A medication whose only dosage row is future-dated reports `status: "not_started"`
- Creating a medication through `/medications` still succeeds and shows its dosage — §7 adds a
  return path to `createMedication` and must not change the ordinary case

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 3: Schedule, list and cancel on `/medications`

### Overview

The user-facing write surface. The existing "Change dosage" panel gains a date field, a list of
pending changes with per-row cancel, and a confirmation before replacing a change already
scheduled for the chosen date.

### Changes Required:

#### 1. The date field in the dosage panel

**File**: `src/components/medications/MedicationsManager.tsx`, `src/pages/medications.astro`,
`src/components/form/FormField.tsx`

**Intent**: One panel, one mental model — "change the dosage, optionally from a later date".

**Contract**: A `FormField` of `type="date"` inside the existing `open === "dosage"` form,
defaulting to the UTC today the page passed in, with `min` set to the same value. The island
must not derive it — `CLAUDE.md` → _Dates_: resolve once, server-side, pass down as a prop.
`medications.astro` resolves `resolveToday("UTC")` alongside the user's today it already
resolves inline, and passes it to the island as a new prop.

**`FormField` cannot pass `min` today, so it has to gain the prop.** `FormField.tsx:7-20`
destructures a closed list and hands `Input` an explicit attribute set (`:53-65`) — there is no
rest spread, and `min=` has zero hits anywhere in the app. Add `min?: string` and forward it,
mirroring how `SelectField.tsx:18-27` extends the sibling contract. `src/components/form/` is
ours to edit (`CLAUDE.md` → _UI components_), but it is shared with the specialists and visits
islands, so the prop must stay optional. Raised in plan-review as F9.

The panel's existing hint text ("Takes effect today. Setting it again today replaces today's
value…") must be rewritten to cover both cases: today behaves as before; a future date
schedules; a date that already holds a change replaces it after confirmation.

"Stop taking this" keeps submitting `daily_dosage: 0` — but it must now submit the _date
field's current value_, not an implicit today, or the button silently disagrees with the form
it sits in. A scheduled stop is a legitimate thing to want.

#### 2. Pending changes list with cancel

**File**: `src/components/medications/MedicationsManager.tsx`

**Intent**: A scheduled change the user cannot see is a change they cannot undo — and cancel is
the only correction available, since the row cannot be edited.

**Contract**: Inside the dosage panel, above the form, render the medication's pending changes
ascending by date, each with a Cancel button issuing the Phase 2 `DELETE` and applying the
returned row via the existing `applyRow`. An empty list renders nothing. Follow the panel's
established shape — `disabled={pending}`, errors into `setPanelErrors`, and a success notice in
the same voice as `submitDosage`'s.

**`send()` cannot issue it as written.** `MedicationsManager.tsx:199-226` types `method` as
`"POST" | "PATCH"` and serialises a body unconditionally. Widen the union to include `"DELETE"`
and make the body optional, rather than dropping to an inline `fetch` the way
`SpecialistsManager.tsx:172` and `VisitsManager.tsx:258` do: `send` is what returns a
`MedicationView` and routes field errors, and the cancel needs both. Raised in plan-review as
F9.

#### 3. Replace confirmation

**File**: `src/components/medications/MedicationsManager.tsx`

**Intent**: Scheduling onto a date that already holds a change silently replaces it at the
database — that is what keeps `23505` unreachable. The user should say so on purpose.

**Contract**: Before submitting, if the chosen date matches an existing pending change's date,
open a Radix `AlertDialog` naming both values — what is scheduled for that date now, and what
it would become — with confirm and cancel. Reuse the Archive dialog's structure
(`MedicationsManager.tsx:638-667`), including returning focus to the trigger after close.

This is a **client-side check against the list already in props**, not a server round trip. It
can therefore be raced — two tabs, or a stale list — and the server's behaviour in that case is
to replace, unchanged. That is acceptable: the confirm exists to catch a mistyped date, not to
serialise concurrent edits.

Today's date is _not_ treated as a collision even though a row exists for it: replacing today's
dosage is the panel's original purpose and is already explained by the hint.

#### 4. The `not_started` label

**File**: `src/components/medications/MedicationsManager.tsx`

**Intent**: The list must name the new state. `STATUS_LABEL` and `STATUS_CLASS` are exhaustive
`Record`s, so this is compiler-mandated rather than discretionary.

**Contract**: `not_started` → a label naming the start date, e.g. **"Starts &lt;date&gt;"**, styled
`text-muted-foreground` — it is a neutral state, nothing is wrong. If the label must stay
static to fit `Record<MedicationStatus, string>`, use "Not started yet" in the map and render
the date beside it from the view's next-change field.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` clean
- `npm run lint` clean at 0 errors, 0 warnings
- `npm run build` succeeds (dev server stopped first)

#### Manual Verification:

- Scheduling 3/day from a week out on a 1/day medication succeeds; the panel lists it and the
  row's figures update without a page reload
- Choosing today still replaces today's dosage with no confirmation dialog
- Choosing a date that already holds a pending change opens the confirm naming both values;
  cancelling leaves the original intact, confirming replaces it
- Cancel on a pending row removes it and the medication's figures revert
- The date picker will not offer yesterday
- A medication whose only dosage row is future-dated reads "Starts &lt;date&gt;", **never** "Not used"
- "Stop taking this" with a future date in the field schedules a stop rather than stopping now
- The whole panel is usable at 320px wide with no horizontal scroll (NFR)
- Keyboard: the date field, the cancel buttons and the confirm dialog are all reachable, and the
  dialog returns focus on close

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human before proceeding.

---

## Phase 4: Surface the change on `/dashboard`

### Overview

The dashboard already recalculates — the engine has been doing the segmental walk since the row
existed. What it does not do is say why the number moved. Two server-rendered additions, no
island.

### Changes Required:

#### 1. Make `cardStateFor` exhaustive — and let `not_started` keep its colour

**File**: `src/lib/dashboard.ts`

**Intent**: Close the silent-fall-through hole, and **not** give `not_started` a card state of
its own.

**Contract**: Replace `cardStateFor`'s `default:` (`dashboard.ts:68-69`) with explicit
`case "active":` and `case "archived":` plus a `never` exhaustiveness guard, so any future
`MedicationStatus` variant fails the build here instead of falling through. `not_started` then
joins `active` in reaching `classifySupplyStatus`. `CardState` and `CARD_ORDER` are
**unchanged**.

An earlier draft routed `not_started` to a dedicated quiet card state, on the grounds that
`classifySupplyStatus` "would classify a supply nobody is consuming yet". That reasoning does
not survive contact with the engine. Traced with 30 on hand and a single 3/day row effective in
seven days: today's dose is 0, the zero-dose branch (`supply.ts:159-167`) consumes nothing
across the first span, the walk reaches the breakpoint and returns a real `supplyEndDate`. The
engine has a correct, actionable answer, and a quiet card throws it away — so a medication that
runs out before the next visit would read neutral, which is the "you have enough" direction the
PRD calls a product failure. The precedent being borrowed does not transfer either: `not_used`
→ `stopped` is right because consumption there is zero indefinitely; here it starts on a known
date. Raised in plan-review as F8.

#### 2. The card copy and the change line

**File**: `src/components/dashboard/SupplyCard.astro`

**Intent**: Say that the dosage has not begun, without suppressing the colour that says whether
to act; and explain a supply-end date the user cannot otherwise derive from the two figures
shown beside it.

**Contract**: `STATE_LABEL` and `STATE_CLASS` are **untouched** — `not_started` has no card
state, so the badge keeps whatever band `classifySupplyStatus` returned. The reason ternary at
`:54-62` carries the wording instead: when the medication's status is `not_started`, the reason
line names the start date — "Dosage begins on &lt;date&gt;" — and must **not** say "Dosage is set to
0, so nothing is being consumed", which is the defect S-04 handed over. That branch needs
`medication.status` in `SupplyCard.astro`, which it already has on `Props.medication`.

When a next scheduled change is present, render one line — "Changes to `N` / day on
&lt;date&gt;" — in the `<dl>` region beside "On hand" and "Dosage". The date is the stored
`YYYY-MM-DD` string inside a `<time datetime=…>`, **unformatted**: `SupplyCard.astro:76-78`
states that formatting it would mean parsing it into a `Date`, which is how this screen acquires
an off-by-one-day bug. Use `:root` tokens only, no hardcoded palette classes.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` clean
- `npm run lint` clean at 0 errors, 0 warnings
- `npm run build` succeeds (dev server stopped first)
- `npm run db:test` still green

#### Manual Verification:

- **The end-to-end north-star walk**: a medication at 1/day with 30 on hand and a visit far out
  shows some supply-end date. Schedule 3/day from a week today. The date moves to the
  segmentally-correct day (7 days at 1/day leaves 23, ÷3 is 7 more days), the card names the
  change, and the colour reclassifies if the band changed. This is US-02, and it is the slice's
  reason to exist.
- Cancelling the change on `/medications` returns the dashboard's date to its original value
  exactly
- A medication whose dosage has not started carries a reason line naming the start date — never
  "Dosage is set to 0" — **and keeps the supply band its figures earn**. Seed one that runs out
  before the next visit and confirm the badge reads "Order now", not a neutral state (§1)
- A medication with no scheduled change shows no extra line (no empty row, no "—")
- Group ordering and card ordering within a group are unchanged for medications without
  scheduled changes
- Dashboard renders at 320px with no horizontal scroll, and within a second for ~20 medications
  (NFR)

**Implementation Note**: After this phase's manual gate, run `/10x-impl-review` **before**
pushing the branch and opening the PR — `lessons.md` → _Run the implementation review before the
merge, not after_. Treat its findings as a merge gate, not as follow-up work. S-04's review found
two defects that a green CI run and a full manual walk both passed over, because every finding
came from reading the code rather than running it.

---

## Testing Strategy

**This slice writes no new automated tests.** That is a decision taken during planning with the
trade-off stated, not an omission — and it goes one step further than S-04's, which at least
left the existing pgTAP suite covering its schema: **the tightened INSERT policy from Phase 1
ships with nothing asserting it.**

It does touch `supabase/tests/constraints.test.sql`, and that is not a reversal. Phase 1 §2
repairs four fixtures the new policy invalidates — past-dated inserts sitting below that file's
`set local role authenticated` — because a suite that aborts is a red build, not a deferred
test. No assertion is added; the ones that exist keep testing what they tested.

`lessons.md` → _State table privileges in the migration_ is directly about this class: a policy
nothing asserts is a policy that can silently regress, and the incident it records cost a fall
from 57/57 to 14/57 on a routine CLI bump. That lesson's rule — assert it in the suite so an
inherited default cannot masquerade as a decision — is knowingly not followed here. Phase 1's
migration header names the departure and points at the follow-up, so a reader finds it by
reading rather than by bug report.

What this leaves protected only by a human walking a list:

- The segmental arithmetic itself — the PRD's hardest-guarded code, on the slice that exists to
  prove it works
- The INSERT policy's past-guard
- The `not_started` precedence in `deriveStatus`
- The 404-on-zero-rows check in the cancel path, whose absence is invisible: cancelling a
  stranger's row would answer success

`follow-ups/deferred-tests.md` records the specification so the eventual test slice inherits it.
It joins three existing queues — S-01's `specialists-tests.md`, S-02's `deferred-tests.md` and
S-04's `supply-engine-tests.md` — and that last one says plainly: whoever plans the test slice
should read them all and write **one** suite, not four.

### Manual Testing Steps:

1. Set up a medication at 1/day, 30 on hand, expiry far out, specialist with a visit ~30 days
   out. The arithmetic is easy to do in your head, which is the point.
2. Set up a second medication with **no** dosage row (created, then its dosage row deleted in
   Studio) so `no_dosage` and `not_started` can be seen side by side and confirmed distinct.
3. Walk each phase's Manual Verification list against those two fixtures.

S-04's change log records that its Desired-End-State scenario could not be seeded through the UI
because every supply write stamps `occurred_on = todayUtc()`. That constraint is unchanged for
supply events; it does **not** apply to this slice's dosage rows, which is the whole point — S-05
is the first slice that can create its own fixtures through the UI.

## Performance Considerations

Negligible, and worth one line so nobody re-derives it. The pending series comes from the
`dosage_changes` rows `MEDICATION_SELECT` already embeds — no extra query, no extra round trip.
`computeSupply` is `O(breakpoints × events)` (corrected from the S-04 plan's `O(breakpoints)` by
that slice's impl-review, finding F4); a scheduled change adds one breakpoint per medication. The
NFR — all supply statuses within one second for 20 medications — is unaffected, and the property
that makes it hold is that iterations are bounded by the breakpoint count and never by a day
count.

## Migration Notes

One migration, Phase 1, behaviour-only: no table, column, type, or grant changes, so
`npm run db:types` is not part of this slice and `src/db/database.types.ts` must not change. If
it does, something else moved — investigate before committing.

Safe against a populated database. Tightening a `with check` predicate affects future INSERTs
only; existing rows, including any already back-dated, are untouched. There are none in
production: no surface has ever been able to write one.

Rollback is a second `alter policy` restoring the ownership-only predicate. Neither direction
destroys data. Note that rolling back Phase 1 while Phases 2–4 remain deployed reopens the
back-dating hole — the two are a pair, and the deploy order is Phase 1 first.

Not schema-safe in one respect the first draft missed: four pgTAP fixtures in
`supabase/tests/constraints.test.sql` insert past-dated dosage rows below that file's role
switch, so the tightened predicate aborts the file. Phase 1 §2 repairs them in the same phase
as the migration — the two must land together or `npm run db:test` is red between them.

`lessons.md` → _Confirm every migration reached cloud_: close Phase 1 against
`npx supabase migration list` on the linked project, never against a green local suite. That
lesson cites `scripts/check-migration-drift.mjs` as the automated backstop; at plan-review time
the script was not on `master` (F2), only on the then-unmerged `ci/migration-drift-check`
(`01a79d5`). PR #38 landed it on `master` (`dbb772c`, 2026-09-12) before Phase 1 began, so the
backstop is live — see Phase 1 §3.

## References

- Roadmap slice: `context/foundation/roadmap.md` → `### S-05: Mid-supply dosage change`
- PRD: `context/foundation/prd.md` → FR-006, US-02, Business Logic (segmental calculation)
- The engine, unchanged by this slice: `src/lib/supply.ts` (header at `:1-24` names S-05)
- The DELETE policy the cancel path depends on:
  `supabase/migrations/20260829071323_relax_same_day_dosage_correction.sql:22-26`
- The handed-over defect: `context/changes/supply-status-dashboard/plan.md:187` and
  `context/changes/supply-status-dashboard/change.md:351-356`
- The deferred timezone finding this slice widens but does not fix:
  `context/changes/supply-status-dashboard/follow-ups/timezone-classification.md`
- Prior art for delete-then-insert under an absent UPDATE policy:
  `src/lib/db/medications.ts:393-445`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Guard the past at the database

#### Automated

- [ ] 1.1 `ci/migration-drift-check` merged to `master`, so `scripts/check-migration-drift.mjs` exists before the push
- [ ] 1.2 `npm run db:reset` applies all migrations cleanly from scratch
- [ ] 1.3 `npm run db:test` green with the repaired fixtures, same assertion count; the two repaired `throws_ok` still fail for `23505` and `23514`, not `42501`
- [ ] 1.4 `npx supabase migration list` shows the new migration in the remote column
- [ ] 1.5 `npm run lint` clean, `npm run typecheck` clean

#### Manual

- [ ] 1.6 Studio: INSERT with `effective_date = current_date - 1` refused; `current_date` and `current_date + 7` succeed
- [ ] 1.7 Creating a medication through `/medications` still succeeds and shows its dosage
- [ ] 1.8 Changing today's dosage on an existing medication still works

### Phase 2: The date through the domain layer and the API

#### Automated

- [ ] 2.1 `npm run typecheck` clean — fails on `MedicationsManager.tsx:70` and `:78` only; it does not reach `dashboard.ts` or `SupplyCard.astro`
- [ ] 2.2 `npm run lint` clean at 0 errors, 0 warnings
- [ ] 2.3 `npm run build` succeeds (dev server stopped first)
- [ ] 2.4 Existing pgTAP suite still green: `npm run db:test`

#### Manual

- [ ] 2.5 POST with a future `effective_date` returns 200 and a segmentally-correct `supply_end_date`
- [ ] 2.6 POST with a past date returns 400 with `fieldErrors.effective_date`, not 500
- [ ] 2.7 POST with no `effective_date` behaves exactly as before
- [ ] 2.8 DELETE removes a pending row and restores the supply-end date; unknown date returns 404
- [ ] 2.9 DELETE for a past date returns 404 (zero-rows check present)
- [ ] 2.10 DELETE for today's date removes the in-force row and succeeds (deliberate absence of a floor)
- [ ] 2.11 A medication whose only dosage row is future-dated reports `status: "not_started"`
- [ ] 2.12 Creating a medication through `/medications` still succeeds and shows its dosage (§7 must not change the ordinary case)

### Phase 3: Schedule, list and cancel on `/medications`

#### Automated

- [ ] 3.1 `npm run typecheck` clean
- [ ] 3.2 `npm run lint` clean at 0 errors, 0 warnings
- [ ] 3.3 `npm run build` succeeds (dev server stopped first)

#### Manual

- [ ] 3.4 Scheduling a future change succeeds; the panel lists it and the row updates without reload
- [ ] 3.5 Choosing today still replaces today's dosage with no confirmation dialog
- [ ] 3.6 A collision opens the confirm naming both values; cancel keeps the original, confirm replaces
- [ ] 3.7 Cancel on a pending row removes it and the figures revert
- [ ] 3.8 The date picker will not offer yesterday
- [ ] 3.9 A not-yet-started medication reads "Starts &lt;date&gt;", never "Not used"
- [ ] 3.10 "Stop taking this" with a future date schedules a stop rather than stopping now
- [ ] 3.11 The panel is usable at 320px with no horizontal scroll
- [ ] 3.12 Keyboard: date field, cancel buttons and confirm dialog reachable; dialog returns focus

### Phase 4: Surface the change on `/dashboard`

#### Automated

- [ ] 4.1 `npm run typecheck` clean
- [ ] 4.2 `npm run lint` clean at 0 errors, 0 warnings
- [ ] 4.3 `npm run build` succeeds (dev server stopped first)
- [ ] 4.4 `npm run db:test` still green

#### Manual

- [ ] 4.5 The end-to-end north-star walk: the scheduled change moves the supply-end date to the segmentally-correct day and reclassifies the status
- [ ] 4.6 Cancelling returns the dashboard's date to its original value exactly
- [ ] 4.7 A not-started medication's reason line names the start date, never "Dosage is set to 0", and it keeps the supply band its figures earn — one that runs out before the next visit reads "Order now"
- [ ] 4.8 A medication with no scheduled change shows no extra line
- [ ] 4.9 Group and card ordering unchanged for medications without scheduled changes
- [ ] 4.10 Dashboard renders at 320px with no horizontal scroll, within a second for ~20 medications
