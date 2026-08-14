# Domain Schema Foundation — Plan Brief

> Full plan: `context/changes/domain-schema-foundation/plan.md`
> Roadmap item: `context/foundation/roadmap.md` — F-01

## What & Why

MedCalc's entire value rests on one calculation: will this medication supply last until the next visit with the prescribing specialist? Every slice from S-01 to S-06 reads or writes the data behind that calculation, and the PRD binds the schema with a constraint most CRUD apps never face — dosage adjustments, quantity updates, and archival must all be timestamped and reconstructible from day one (`prd.md:127`). This change designs that schema once, correctly, before any slice starts writing data in a shape that would have to be retrofitted.

## Starting Point

`supabase/migrations/` does not exist — this is the project's first migration. Supabase Auth is fully working (sign-in, sign-up, session middleware, protected `/dashboard`), and the cloud project `medcalc` is live with production secrets set. But there are no domain tables, no `src/db/` directory, and `src/lib/supabase.ts:11` creates an untyped client, so every query result today is `any`.

Two facts about the trust boundary shape the whole design. **Supabase is server-only** — both vars are `context: "server", access: "secret"` (`astro.config.mjs:19-20`), no client component imports Supabase, and the auth forms are plain HTML POSTs to `/api/auth/*` — so application code is unavoidably in the path of every write. But PostgREST still executes each request **as the end user**, so RLS is what catches a route handler that forgets a `user_id` filter, and without it every table would be readable by any authenticated user.

## Desired End State

`npx supabase db reset` produces the complete domain schema locally; `supabase test db` proves user A cannot reach user B's medical data and that the recount ledger arithmetic holds; the app's Supabase client is typed against generated types so a mistyped column is a build error; and the same migration is applied to the live `medcalc` project with local and remote in sync. S-01 can then begin without inventing any schema.

## Key Decisions Made

| Decision            | Choice                                                      | Why (1 sentence)                                                                                                      | Source |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ |
| History mechanism   | Domain event tables                                         | The history _is_ the domain data — FR-006's segmental calculation needs the dosage series anyway.                     | Plan   |
| Dosage storage      | Only in `dosage_changes` rows; no column on `medications`   | A column plus a log is two sources of truth that can drift, and drift here produces a wrong "you have enough".        | Plan   |
| Quantity storage    | Delta ledger in `supply_events`                             | A true ledger showing what happened and why, rather than a snapshot that overwrites its own history.                  | Plan   |
| Ledger correctness  | Recount reconciliation events                               | Only a physical recount catches drift against reality — a missed refill is invisible to any internal check.           | Plan   |
| Discrepancy UX      | Notify only when counted ≠ projected                        | The signal carries information only when the numbers disagree; silence is the correct default.                        | Plan   |
| Enforcement style   | Declarative only — no triggers, no functions, no RPC        | Constraints appear in generated types, test with the same tooling, and cannot drift from a second copy of the rule.   | Plan   |
| Liquid medications  | Nullable columns on `medications` + one CHECK               | Makes creation a single atomic insert, which PostgREST can do and a two-table design could not.                       | Plan   |
| Zero dosage         | `daily_dosage >= 0`; 0 means "stopped, keep history"        | Distinct from archival, and it makes a partial 3-statement create a legal state instead of an unremovable orphan.     | Plan   |
| User timezone       | `auth.users.raw_user_meta_data`; capture here, read in S-04 | One preference does not earn a table, a trigger to populate it, a policy pair, and a backfill against live auth data. | Plan   |
| RLS shape           | `user_id` on every table, uniform `auth.uid() = user_id`    | Identical index-backed policies with no subqueries; nested ownership is where RLS bugs actually hide.                 | Plan   |
| Owner integrity     | Composite FKs `(child_id, user_id) → parent(id, user_id)`   | Closes the denormalisation hole structurally, so a cross-owner child row is impossible rather than merely wrong.      | Plan   |
| Deletion semantics  | Per-entity, literal to the FRs                              | Medications archived (FR-007), visits deletable (FR-010), specialists restricted while referenced.                    | Plan   |
| Past-visit deletion | App-layer confirmation gate, recorded as a contract         | "The user confirmed it never happened" is a human judgement the database has no way to observe.                       | Plan   |
| Dates & timezone    | `date` columns + a per-user IANA timezone                   | Removes an off-by-one that shifts supply-end dates by a day for anyone opening the app late at night.                 | Plan   |
| Current-state views | Deferred to S-04, invented once and reused                  | Designed against a real consumer rather than guessed — but explicitly not re-invented per slice.                      | Plan   |
| Migration workflow  | Local-first, then `supabase db push`                        | RLS policies and constraints need rehearsal against a throwaway database before touching real data.                   | Plan   |
| Verification        | pgTAP **and** Vitest integration tests                      | pgTAP proves policies at the database; Vitest proves them through PostgREST, the path the app actually takes.         | Plan   |
| Timezone capture    | Capture stays here (Phase 3); the reader defers to S-04     | A store with no producer holds its default forever — but a reader with no caller is dead code, so only capture lands. | Plan   |

## Scope

**In scope:** one migration creating `specialists`, `medications`, `dosage_changes`, `supply_events`, `visits`; constraints, indexes, RLS policies; pgTAP database tests; Vitest installation and integration tests; generated TypeScript types and a typed Supabase client; browser timezone capture at signup; `CLAUDE.md` updates; push to Supabase Cloud.

**Out of scope:** current-state views (deferred to S-04); any repository/data-access layer; the supply calculation engine; all UI beyond one hidden timezone field; history-browsing screens; CI-applied migrations; **any trigger, database function, or RPC** — and a `profiles` table, which in v1 would hold one preference already available on the session user.

## Architecture / Approach

Five tables built on four principles. **First**, mutable state that must be preserved is never stored as a column — dosage lives only in `dosage_changes`, quantity only in `supply_events` deltas, so nothing can drift from its own history because no second copy exists. **Second**, ownership is denormalised onto every table for uniform RLS policies, then made structurally sound with composite foreign keys. **Third**, the append-only mandate is enforced by RLS grants rather than developer discipline: `supply_events` allows only SELECT and INSERT, `dosage_changes` permits deletion only of not-yet-effective rows, and `medications` denies DELETE outright so FR-007's archival requirement is a database guarantee. **Fourth**, every invariant is declarative — a policy, a CHECK, a foreign key, or a uniqueness constraint, never a trigger.

One deliberate division of labour: the application supplies `counted_quantity`, `projected_quantity`, **and** the resulting `quantity_delta` on a recount, and a CHECK constraint rejects any row where the three disagree. Computing the projection requires the consumption engine S-04 builds in TypeScript, and duplicating that arithmetic in SQL would create a second implementation of the PRD's guarded calculation — so the database verifies the result rather than reproducing the work.

An earlier draft carried three triggers; all three are gone, and the full reasoning is recorded in the plan under "Decided: no procedural database code". In summary: the recount trigger duplicated a CHECK the plan was already writing; the deferred liquid trigger disappeared when the sub-type moved onto `medications` as nullable columns (which also made creation a single atomic insert — something two PostgREST calls could never be); and the `auth.users` → `profiles` trigger disappeared with the table, since its only field lives in `raw_user_meta_data` and is already on the session user. **This moved nothing out of the database** — every trigger-enforced invariant is now constraint-enforced. What it gives up is a timezone joinable in SQL, which nothing in v1 needs.

## Phases at a Glance

| Phase                              | What it delivers                                           | Key risk                                                                                 |
| ---------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1. Domain schema migration         | The full schema: tables, constraints, indexes, RLS         | Ordering inside the migration (composite FKs need their `UNIQUE` targets to exist first) |
| 2. pgTAP database tests            | Proof that RLS isolates and the recount arithmetic holds   | Unfamiliar pgTAP syntax; tests that pass without actually biting                         |
| 3. Typed client + timezone capture | Generated types, typed client, real timezone values        | Hydration mismatch on the timezone field; `react-compiler` lint is set to `error`        |
| 4. Vitest suite + docs             | Integration tests through PostgREST; corrected `CLAUDE.md` | Test-runner setup expanding beyond what a schema change needs                            |
| 5. Push to Supabase Cloud          | The migration applied to the live project                  | Irreversible, but purely additive — it writes no rows and does not touch `auth`          |

**Prerequisites:** **Confirm `npx supabase start` runs before anything else** — it is Phase 1's preflight gate, and all five phases depend on the local stack (rehearsal, pgTAP, type generation, Vitest). Also needs Docker running, Supabase account access with the `medcalc` project ref and an access token, and possibly the corporate-proxy workarounds noted in `CLAUDE.md` — note that a Node TLS failure and a Docker image-pull failure have different fixes.
**Estimated effort:** ~2–3 sessions across five phases; Phase 1 carries most of the design weight, Phase 5 is minutes.

## Open Risks & Assumptions

- **No independent check on ledger arithmetic.** A stamped running balance and a `verify_supply_ledger()` function were both considered and declined. Between recounts, a bug in future migration code could corrupt totals silently. Accepted given the data volume (one user, ≤20 medications) — but if a third correctness incident ever appears, the stamped balance is the fix.
- **Recount inserts are only meaningful once S-04 exists**, since the application supplies the projection. S-02 can build the recount UI, but the projection value it passes will be trivial until the engine lands.
- **The past-visit confirmation rule lives outside the database.** A future API route or a direct Studio edit can bypass it.
- **Existing cloud accounts carry no timezone**, and neither do JavaScript-disabled signups; only new signups with JS get a captured value. There is no UI to change it yet.
- **The `Europe/Warsaw` fallback has no owner until S-04.** The reader was specified in Phase 3 and cut — nothing in this change calls it, so it would have been dead code behind an uncheckable criterion. S-04 is the first thing that resolves "today" in the user's zone and must write the single reader every later slice uses; the intended default is recorded in the plan so it is not re-invented per call site.
- **`updated_at` ships with no maintainer.** The no-triggers principle rules out `moddatetime` and there is no repository layer, so the column will equal `created_at` until something sets it. Columns are created now (cheaper than a later migration); **S-01 decides**, since it writes the first real update path. Options recorded in the plan: `moddatetime` as a narrow extension exception, explicit assignment plus a test, or drop the columns.
- **Creating a medication is three statements and cannot be atomic over PostgREST.** `medications` → `dosage_changes` → `supply_events`, since dosage and quantity deliberately live outside the core table. The zero-dosage read semantics make a partial create a legal state rather than an orphan, but they do not prevent one — **S-02 must surface a failed write**, or a user sees dosage 0 and never learns their entry didn't save. RPC is the escape hatch if partial creates prove common.
- **A 0 dosage makes the supply-end date undefined.** S-04 returns "lasts indefinitely" for a zero-dosage segment rather than dividing by zero, and FR-006's segmental arithmetic must treat `5 → 0 → 5` as three segments, not a gap.
- **The recount delta is now supplied by the caller.** The CHECK rejects an inconsistent one, so a wrong value cannot land — but a caller that omits the column entirely gets a NOT NULL failure rather than a silently computed value, which is a behaviour change from the earlier trigger design that S-02's recount UI must account for.
- **The single-table liquid design assumes one sub-type.** A second one (injections, say) makes the nullable-column CHECK combinatorial and is the explicit signal to revisit the decision — recorded in the plan as a re-planning trigger rather than left to be rediscovered.
- **Declarative-only is a convention, not an enforced property of future migrations.** Phase 1 asserts zero rows in `pg_trigger`/`pg_proc` and `CLAUDE.md` records the rule, but nothing stops a later migration from adding one; the assertion is what makes it loud.
- **The current-state view shape is unknown** until S-04 defines what the dashboard needs — the deferral is deliberate, but it means S-04 carries schema-adjacent design work.
- **Assumption:** one dosage per medication per day is a valid constraint. If a user ever needs two changes effective the same date, the `UNIQUE (medication_id, effective_date)` constraint blocks it.

## Success Criteria (Summary)

- A developer can go from a clean checkout to a working local database with one command, and the test suite proves the two properties that matter — that medical data is isolated per user, and that the supply ledger's arithmetic is correct.
- Every downstream slice inherits a typed schema where the current dosage and current quantity have exactly one source each, so the PRD's "calculation accuracy" guardrail cannot be undermined by drifting copies.
- The live `medcalc` project carries the same schema, verified, with no procedural code under `public` and no rows written by the migration.
