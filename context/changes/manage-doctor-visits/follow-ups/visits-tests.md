# Follow-ups — manage-doctor-visits

Queued during S-03 but deliberately not built here. Each entry names where it
came from so the reasoning stays findable after this change is archived.

## Write the deferred integration tests for the visits data layer

**Source**: `plan.md` → _Testing Strategy_ and _What We're NOT Doing_, written
2026-08-27. The deferral is S-01's standing posture carried forward unchanged:
the dedicated test skill is not yet installed. **The decision is not being
reopened.** This entry exists only so the specification lives in the queue that
gets read for outstanding work, rather than inside an archived plan.

**Where it goes**: `tests/integration/visits.test.ts`, using
`createAuthenticatedClient` from the existing helper. Per `CLAUDE.md` →
_Testing_, `npm test` requires a running local stack (`npx supabase start`); the
helper refuses to run against a non-local `SUPABASE_URL`.

**What exists today**: nothing in this slice carries automated coverage — not
`src/lib/dates.ts`, not `src/lib/db/visits.ts`, not the two routes, not
`SelectField`, not the island. The passing integration tests and pgTAP
assertions cover F-01's schema and the pre-existing auth paths only. All the
behaviour below was confirmed by hand across 2026-08-29 and 2026-08-30
(`change.md` → _Session state_) and by reading the module; it is unguarded, not
unimplemented.

**No migration is involved.** This slice added none, so a test author needs no
schema work — `visits` has been complete since F-01, finished by S-01's
migration. See `plan.md` → _Current State Analysis_ for the object-by-object map.

### Write these two first

They are the only automated proof of rules the plan calls load-bearing, and
**neither has a database-level fallback** — that is what makes them different in
kind from the rest of the list, not merely more important. Both are the visits
counterparts of the two `manage-specialists/follow-ups/specialists-tests.md`
names first, and the argument transfers verbatim.

1. **A caller-supplied `updated_at` is ignored.** Call `updateVisit` with an
   object carrying an `updated_at` far in the future alongside a valid
   `specialist_id` and `visit_date`; assert the stored value is the module's own
   timestamp, not the caller's.

   `visits_updated_at_not_before_created_at`
   (`20260821182457_grants_updated_at_guard_and_rls_perf.sql:102-104`) blocks
   backdating and nothing else: the UPDATE policy constrains no columns and
   `database.types.ts` exposes `updated_at` on `Update`, so a client can still
   set a future value. There is no database-level alternative — revoking column
   UPDATE would block the module's own write, and a trigger is ruled out by the
   schema's no-procedural-code property (`CLAUDE.md` → _Domain schema_). The
   application path is the only lever. Until this test exists it is held by code
   review, the specification comment in `src/lib/db/visits.ts`, and manual step
   1.6 alone.

2. **A missing or foreign row is not-found, not success.** Assert that updating
   and deleting a random UUID each produce `not_found` rather than reporting
   success, and that a second user doing the same against the first user's real
   visit gets the same `not_found` result and leaves the row unchanged.

   Under RLS, an UPDATE or DELETE against a missing or foreign `id` matches zero
   rows and returns success with no error; the `.select()` chained onto both
   statements is the only signal. A cross-user isolation test that asserts only
   that the row survives **does not cover this** — that stays true when the
   handler wrongly reports success. That is precisely the regression this test
   catches and that one does not.

### Then the rest of the contract

Kept verbatim from `plan.md` → _Close-out_ so nothing is rediscovered:

- Full CRUD round trip through the module against PostgREST
- Cross-user isolation: a second authenticated client sees and mutates nothing
  of the first's
- **A `specialist_id` belonging to another user is rejected as
  `invalid_specialist`.** This is the one mapping with no analogue in S-01.
  `visits_specialist_fk` is composite on `(specialist_id, user_id)`, so a
  specialist id that is real but not the caller's fails the FK and raises
  `23503`. The module must map that to `invalid_specialist` and the route must
  answer **400** with `fieldErrors.specialist_id`, not 409 — 409 keeps meaning
  only "blocked by references", and nothing references a visit. Assert the
  status, not just the failure.
- The `1900-01-01 … 2100-12-31` bounds in `visitInputSchema` reject on both
  sides, and a past date inside them is accepted. **The bounds have no database
  counterpart** — `visit_date` is an unconstrained `date` column, so the schema
  is the only thing enforcing them and a test is their only guard.
- `resolveToday` falls back to UTC on a malformed zone. The one piece of pure
  logic in this slice that is trivially unit-testable and has **no manual
  equivalent** — see the note below on why the manual walk could not reach it.

### Three things worth knowing before writing these

- **Duplicates are legal and must stay legal.** There is no
  `unique (user_id, specialist_id, visit_date)` constraint, and the API accepts a
  duplicate posted directly; the confirm dialog in the island is a UX courtesy,
  not an invariant. A test that asserts a duplicate is rejected would be
  asserting the opposite of the design (`change.md` → _Decisions taken during
  planning_).
- **Error mapping is observable.** Following the lesson _Log the database error
  before collapsing it to a domain kind_, the module logs unexpected Postgres
  errors through `logDbError` before collapsing them to `"unknown"`. A test that
  trips an unexpected code will print a line; that is intended, not a leak.
  `invalid_specialist` is an expected domain outcome and is deliberately **not**
  logged.
- **`resolveToday`'s two branches were indistinguishable during manual
  verification.** On 2026-08-29 the stored zone (`Europe/Warsaw`) and the UTC
  fallback both resolved to `2026-08-29`, so the walk could not tell them apart.
  A unit test with a pinned `now` and a deliberately offset zone — the signature
  takes `now` as a second argument precisely for this — is the only way to
  exercise the difference. Note that UTC is the *normal* path, not a degraded
  one: the zone is stamped only by the signup page's inline script, so every
  account the integration helper creates has no stored zone at all.
- **`today` is resolved once per page render and never refreshes.** A tab left
  open across midnight keeps a stale Upcoming/Past split and stale date hints
  until reload. This is not a defect to test against — it is the direct
  consequence of the rule the slice is built on (`CLAUDE.md` → _Dates_: resolve
  once server-side, and an island must never call `new Date()`), and the
  alternative reintroduces the second "today" that rule exists to prevent. Any
  test pinning a `today` prop is testing the classification, not the freshness.
  **S-04 inherits the same bound** for the dashboard's next-visit calculation
  and should decide there, once, whether a long-lived tab warrants a refresh
  mechanism — rather than rediscovering this as a visits bug.
