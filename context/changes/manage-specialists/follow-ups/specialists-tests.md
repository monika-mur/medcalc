# Follow-ups — manage-specialists

Queued during S-01 but deliberately not built here. Each entry names where it
came from so the reasoning stays findable after this change is archived.

## Write the deferred integration tests for the specialists data layer

**Source**: impl-review finding F5 (OBSERVATION, Scope Discipline), 2026-08-26.
The deferral itself was an explicit decision at the Phase 2/3 boundary the same
day, recorded in `change.md` → _Scope reduced 2026-08-26 — test authoring leaves
the slice_ and in `plan.md` → _Accepted gap_. **The decision is not being
reopened.** This entry exists only so the specification lives in the queue that
gets read for outstanding work, rather than inside an archived plan.

**Where it goes**: `tests/integration/specialists.test.ts`, using
`createAuthenticatedClient` from the existing helper. Per `CLAUDE.md` →
_Testing_, `npm test` requires a running local stack (`npx supabase start`); the
helper refuses to run against a non-local `SUPABASE_URL`.

**What exists today**: nothing in Phases 3–4 carries automated coverage — not
`src/lib/db/specialists.ts`, not the four routes, not the island. The 15 passing
integration tests and 70 passing pgTAP assertions cover Phase 1's schema and the
pre-existing auth paths only. All the behaviour below was confirmed working by
hand on 2026-08-26 (`change.md` → _Manual (3.5–3.6)_) and by reading the module
during this review; it is unguarded, not unimplemented.

### Write these two first

They are the only automated proof of rules the plan calls load-bearing, and
**neither has a database-level fallback** — that is what makes them different in
kind from the rest of the list, not merely more important.

1. **A caller-supplied `updated_at` is ignored.** Call the update path with an
   object carrying an `updated_at` far in the future alongside a valid `name`;
   assert the stored value is the module's own timestamp, not the caller's.

   This is the regression test for the half of `domain-schema-foundation`
   impl-review F8 that Phase 1's `check (updated_at >= created_at)` provably
   cannot reach: the CHECK blocks backdating, but the UPDATE policies constrain
   no columns and `database.types.ts` exposes `updated_at` on `Update`, so a
   client can still set a future value. There is no database-level alternative —
   revoking column UPDATE would block the module's own write, and a trigger is
   ruled out by the schema's no-procedural-code property. The application path is
   the only lever. Until this test exists it is held by code review, the
   specification comment in `specialists.ts:67-83`, and manual step 3.6 alone.

2. **A missing or foreign row is not-found, not success.** Assert that updating
   and deleting a random UUID each produce the not-found outcome rather than
   reporting success, and that a second user doing the same against the first
   user's real specialist gets the same not-found result.

   Under RLS, an UPDATE or DELETE against a missing or foreign `id` matches zero
   rows and returns success with no error; the `.select()` chained onto both
   statements is the only signal. **The pre-existing cross-user isolation test
   does not cover this** — it asserts only that the row survives, which stays
   true when the handler wrongly reports success. That is precisely the
   regression this test catches and that one does not.

### Then the rest of the contract

Kept verbatim from `plan.md` Phase 3 §5 so nothing is rediscovered:

- Full CRUD round trip through the module against PostgREST
- Cross-user isolation: a second authenticated client sees and mutates nothing of
  the first's
- Blank and whitespace-only input rejected
- `updated_at` advances on update (the complement to priority test 1)
- Delete blocked while referenced, with the mapped domain error and the row
  surviving; delete succeeds once unreferenced

**Fixture note**: creating the referencing medication needs a
`dosage_changes`-free minimal insert — `medications` requires only
`specialist_id`, `name`, and `expiry_date`.

### Two things worth knowing before writing these

- **Error mapping is now observable.** Following impl-review F1, the module logs
  unexpected Postgres errors through `logDbError` before collapsing them to
  `"unknown"`. A test that trips an unexpected code will print a line; that is
  intended, not a leak.
- **The `23514` clock-skew case is a known, accepted gap** (impl-review F2,
  decided SKIPPED). `updated_at` is stamped from the runtime clock while
  `created_at` comes from Postgres, so an edit within the skew window can raise a
  check violation and surface as a 500. If a test ever flakes that way, this is
  the cause — the fix is to send `updated_at: "now"` so both columns come from
  the database, not to loosen the assertion.
