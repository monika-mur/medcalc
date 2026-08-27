# Review follow-ups — domain-schema-foundation

Queued from `reviews/impl-review.md` triage (2026-08-19). Each entry names the
finding it came from so the report stays the source of the reasoning.

## F2 — Pin numeric scale so the recount CHECK survives the JS round-trip

**Source**: F2 (WARNING, Safety & Quality) — `supabase/migrations/20260813185255_domain_schema.sql:189-193`

**Why deferred**: the exact scale is tied to S-04's liquid-volume units, which do
not exist yet. Nothing in the current suite exercises a fractional quantity, so
there is no live failure.

**What to do**, in a new migration (the `20260813185255` migration is already
pushed to cloud and must not be edited):

1. `alter table supply_events alter column quantity_delta type numeric(12,3)`,
   same for `counted_quantity` and `projected_quantity`.
2. Decide whether `daily_dosage` (and the liquid columns `container_capacity`,
   `estimated_daily_consumption`) get the same scale — recommended, since ½ and ¼
   pill doses live there and a declared scale makes the contract visible in
   `database.types.ts`.
3. Round the delta client-side to the same scale before insert at the S-04
   recount site.
4. Add a fractional-quantity case to `supabase/tests/supply_ledger.test.sql` —
   every existing assertion uses integers, which is why this is invisible today.

**Scale rationale**: ½ (0.5), ¼ (0.25), ⅛ (0.125) are exact at 3 places _and_
exact in float64, so they never drift. The drift class is decimal tenths
(0.1, 0.2, 0.3) — liquid ml amounts and subtraction results like `28.1 − 28.2`,
which a client sends as `-0.10000000000000142` and the exact-decimal CHECK
rejects with `23514`. Thirds (⅓) are lossy at any decimal scale; if they become
real, model them as a fraction pair or as units-per-pill, not as more decimals.

**Also**: the plan's _Critical Implementation Details_ carries the false
assurance ("numeric is exact decimal, so this equality is not subject to
floating-point drift" — true inside Postgres, false across the wire). Correct it
there too, or S-04 inherits it.

**Untested blind spot**: whether PostgREST rounds or errors on an over-scale
input.

## F3 — Decide the account-erasure story (GDPR Art. 17)

**Source**: F3 (WARNING, Safety & Quality) — `supabase/migrations/20260813185255_domain_schema.sql:37-38` vs `:116-118`, `:216-218`

**Why deferred**: needs a rehearsal against the local stack (Docker), and it is a
schema change to a foundation five slices depend on — not something to land
blind.

**The collision**: `specialists.user_id → auth.users ON DELETE CASCADE` tries to
remove the user's specialists; `medications_specialist_fk` and
`visits_specialist_fk` are `ON DELETE RESTRICT`, so the cascade trips `23503` and
the whole delete fails. `supabase.auth.admin.deleteUser()` and the dashboard's
_Delete user_ button both fail for any user who has ever created a medication.
The user cannot clear the blockers either — `medications` has no DELETE policy by
design.

**Why the plan's note is not enough**: the plan weighed this against the FR list
("No v1 requirement is affected — the PRD has no account-deletion FR"). For an
application storing medical data, GDPR Art. 17 is an obligation that does not
appear as an FR. That is a materially different bar than the one the plan
applied.

**Candidate fix** (schema-side): change both specialist FKs to `ON DELETE
CASCADE` and rely on the _absence of a DELETE policy_ — not the FK — to block
user-initiated specialist deletion. Add a pgTAP assertion that `delete from
auth.users` succeeds and leaves no orphans.

- Postgres gives no ordering guarantee between sibling cascades, so verify rather
  than assume.
- `constraints.test.sql:118-121` asserts the RESTRICT in isolation; no test
  exercises `delete from auth.users`, which is why the collision is invisible.

**Alternative not yet weighed**: an application-level deletion routine (delete
leaves, then the account). The plan's own Migration Notes suggest "a deliberate
deletion order in the app". Pick one deliberately and record the decision.

## F4 — Wrap `auth.uid()` in RLS policies and add the missing `user_id` indexes

**Status**: ✅ **RESOLVED 2026-08-25** by
`supabase/migrations/20260821182457_grants_updated_at_guard_and_rls_perf.sql`,
carried in the `manage-specialists` slice (S-01) rather than in its own change —
the plan folded it into that migration deliberately. Both numbered items below
shipped: all 16 policies now carry the wrapped predicate, and both `user_id`
indexes exist. Verified locally at pgTAP 70/70, plus a spot-check counting **19
`auth.uid()` occurrences, 19 wrapped, 0 bare**.

Two corrections to what this entry originally said, kept visible rather than
edited away:

- **The count was 23; it is 19.** Measured against the schema during S-01 Phase 1
  (`manage-specialists/change.md` → _Automated (1.1–1.5)_). The 23 below is
  wrong — do not re-derive work from it.
- **The migration is local-only.** It has not been pushed to cloud, so the
  performance rewrite is not live in production yet. Tracked separately; the
  `revoke … from anon` in the same file is the part with security weight.

**Still open from this entry**: only the "Also noted" partial-index remark at the
bottom. Nothing in the numbered list remains to do.

---

**Source**: F4 (WARNING, Safety & Quality) — `supabase/migrations/20260813185255_domain_schema.sql:265-314` (policies), `:231`, `:234` (indexes)

**Why deferred**: grouped with F2/F3 — all three are migrations that want a local
stack to verify. No live problem at MVP volumes; this is about doing the cheap
thing before S-04 builds query paths on top of it.

**What to do**, in a follow-up migration: — _done; see Status above_

1. Rewrite all 16 policies from `auth.uid() = user_id` to
   `(select auth.uid()) = user_id`. There are 23 bare occurrences and zero
   wrapped ones (**superseded: the real count was 19**). `auth.uid()` is
   `stable`, not `immutable`, so Postgres
   re-evaluates it per row scanned; the scalar subquery turns it into an InitPlan
   evaluated once per statement. This is Supabase's own documented RLS
   recommendation.
2. Add `user_id`-leading indexes on `dosage_changes` and `supply_events` — both
   are indexed on `(medication_id, …)` only, while RLS injects
   `user_id = auth.uid()` into every read. An unfiltered read (what a "recent
   activity" or "all discrepancies" dashboard query looks like) degrades to a seq
   scan with a per-row function call.

Behaviour is identical either way, so the existing pgTAP and integration suites
are the regression net.

**Also noted** — ⏳ **still open**, not addressed by `20260821182457`:
`medications_user_id_active_idx` is partial (`where archived_at is null`), so the
FR-007 archive view will not use it. Decide whether the archive path needs its
own index when that screen is built.

## F9 — Gate CI on the test suites this change added

**Source**: F9 (OBSERVATION, Success Criteria) — `.github/workflows/ci.yml`

**Why deferred**: wiring a Supabase service container into CI is its own change,
not a fix to this one. Triaged as a follow-up rather than skipped because the
exposure grows with every slice that lands on top of this schema.

**The gap**: this change added 57 pgTAP assertions and 15 Vitest integration
tests. `ci.yml` runs `npm run lint` and `npm run build`, then **deploys to
production on every push to `master`** (`:25-30`) with no test in between. The
plan did leave `ci.yml` alone deliberately — but that decision was scoped to
_migrations_ ("No CI-applied migrations… `db push` stays a deliberate manual
step"). The testing-strategy section never addressed CI, so the suites are
ungated by omission rather than by decision.

**What to do**:

1. Add a `"typecheck": "astro check"` script to `package.json` and run it in the
   workflow. `@astrojs/check` is already a dependency, but with no script wired
   up, `.astro` compile errors are not surfaced by `npm run lint` — criterion 3.2
   was verified by hand, not by CI.
2. Stand up the local stack in CI behind `supabase/setup-cli@v1` and run
   `npm run db:test` (pgTAP) and `npm test` (Vitest integration).
   - The Vitest helper refuses a non-local `SUPABASE_URL` by design
     (Phase 4 deviation 2), so CI must point at the CLI-started stack, not at the
     `SUPABASE_URL` secret the build step uses.
3. Order the deploy steps **after** the test steps, so a red suite blocks the
   production deploy rather than following it.

**Untested blind spot**: how long `supabase start` adds to each CI run, and
whether the pgTAP + integration pair is fast enough to sit in front of a deploy
without making pushes painful.

---

## D-01 — Mirror table grants to each table's RLS policy set

**Renamed 2026-08-27**: this entry was previously labelled `S-05`, which collides
with the roadmap's S-05 (mid-supply dosage change, the north star) — a different
piece of work, wired into GitHub #6 and Linear MON-27. The roadmap ID is canonical,
so this one moved to `D-01` (deferred item). `manage-specialists` cites the old
label in two places; both now point here.

**Source**: not an impl-review finding. Surfaced 2026-08-21 while fixing the
missing-`GRANT` defect in S-01 Phase 1.

**Why deferred**: it is real hardening with a real blast radius, and it arrived
as a side effect of a Supabase CLI upgrade. Riding it into S-01 would have
changed a documented behavioural contract on the way past.

**The gap**: S-01 Phase 1 grants all four DML privileges uniformly to
`authenticated` on all five domain tables. That restores the platform default
the schema always silently relied on, but it means enforcement rests on a single
layer — RLS policy asymmetry. Grants that instead mirrored each table's policy
set would be strictly stronger:

```sql
grant select, insert, update, delete on public.specialists    to authenticated;
grant select, insert, update         on public.medications    to authenticated;
grant select, insert,         delete on public.dosage_changes to authenticated;
grant select, insert                 on public.supply_events  to authenticated;
grant select, insert, update, delete on public.visits         to authenticated;
```

Under that set, a future migration that mistakenly adds a `DELETE` policy to
`medications` still cannot delete anything — the privilege layer refuses first.
It also makes `append_only.test.sql`'s own header comment literally true; today
that file believes it tests grants ("a future migration that loosens one of
these grants should fail here loudly") while actually testing policies.

**Measured, not theorised**: the mirrored set was applied to a live local stack
on 2026-08-21. Result was **44/57** — `append_only.test.sql` fails outright. The
uniform set on the same stack was **57/57**.

**Why it breaks things**: withholding the privilege converts "the statement runs
and RLS matches zero rows" into `42501 permission denied`. Three artifacts encode
the first behaviour:

1. `supabase/tests/append_only.test.sql` — 13 assertions checking affected row
   count and row survival. Its header explicitly warns that `throws_ok` here
   "would pass for the wrong reason".
2. `CLAUDE.md` → _Domain schema_ — "Under RLS a DELETE with no policy matches
   zero rows rather than raising, so tests assert the row survives."
3. S-01 Phase 3's JSON error contract maps `23503`→409 and zero-rows→404. A
   `42501` currently has no mapping and would fall through to 500.

**What to do**:

1. Replace the uniform grants with the mirrored set above.
2. Rewrite `append_only.test.sql` to assert `42501` for the privilege-denied
   commands, keeping row-survival checks as the positive control. Decide
   deliberately which assertions stay row-count-based (those where a policy, not
   a grant, is the blocker — e.g. `dosage_changes` DELETE past its effective
   date).
3. Amend the `CLAUDE.md` rule to describe two layers rather than one.
4. Map `42501` in the API error contract, or assert it can never reach a route.

**Untested blind spot**: whether any legitimate application path performs a
command it is not granted and currently relies on the silent zero-rows result.
Nothing in `src/` touches these tables yet, so the answer is "no" today — but it
must be rechecked after S-02, S-03, and S-04 land.
