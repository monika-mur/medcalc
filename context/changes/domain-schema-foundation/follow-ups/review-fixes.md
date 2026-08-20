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

**Source**: F4 (WARNING, Safety & Quality) — `supabase/migrations/20260813185255_domain_schema.sql:265-314` (policies), `:231`, `:234` (indexes)

**Why deferred**: grouped with F2/F3 — all three are migrations that want a local
stack to verify. No live problem at MVP volumes; this is about doing the cheap
thing before S-04 builds query paths on top of it.

**What to do**, in a follow-up migration:

1. Rewrite all 16 policies from `auth.uid() = user_id` to
   `(select auth.uid()) = user_id`. There are 23 bare occurrences and zero
   wrapped ones. `auth.uid()` is `stable`, not `immutable`, so Postgres
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

**Also noted**: `medications_user_id_active_idx` is partial
(`where archived_at is null`), so the FR-007 archive view will not use it. Decide
whether the archive path needs its own index when that screen is built.

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
