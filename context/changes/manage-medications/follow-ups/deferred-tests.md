# Follow-ups — manage-medications

Queued during S-02 but deliberately not built here. Each entry names where it
came from so the reasoning stays findable after this change is archived.

## Write the medications test suite — deferred to a dedicated test slice

**Status**: open.

**Source**: an explicit decision by the developer at planning, 2026-08-27, in
answer to the plan's testing-scope question: _"Let's forget about tests right
now, we will create later a new slice for it."_ **The decision is not being
reopened.** This entry exists so the specification lives in the queue that gets
read for outstanding work, rather than only inside a plan.

It joins `manage-specialists/follow-ups/specialists-tests.md`, which defers the
S-01 data-layer suite on the same grounds. Whoever plans the test slice should
read both and write one suite, not two.

### What ships without coverage

S-02 adds no automated test of any kind. The existing 70 pgTAP assertions and 15
Vitest integration tests still run in every phase, but purely as a regression net
— they were written for F-01's schema and the pre-existing auth paths, and
nothing in them exercises a single line of S-02's code.

Three mechanisms are novel to this slice and have no machine coverage at all:

1. **The non-atomic three-insert create.** `medications`, then `dosage_changes`,
   then (only when the starting quantity is positive) a `refill` supply event.
   PostgREST offers no transaction and the schema's no-trigger / no-RPC property
   forbids wrapping them. This is the one that most needs a test, because a
   partial result is **indistinguishable from a legitimate state by design** —
   dosage 0 and quantity 0 are both proper states — so a manual walk cannot tell
   a failed second insert from a user who has stopped taking the medication.

2. **The same-day dosage replace.** `setDosage` deletes any row at today's
   `effective_date` and re-inserts, because `unique (medication_id,
   effective_date)` blocks a second insert and `.upsert()` is unavailable
   (PostgREST compiles it to `ON CONFLICT DO UPDATE`, and `dosage_changes` has
   no UPDATE policy for the conflict branch to use). Phase 1's policy relaxation
   is what makes the DELETE half legal.

3. **The read-then-write correction arithmetic.** A count correction reads the
   ledger sum, computes `counted − sum`, and inserts an `adjustment`. A wrong
   sign or an off-by-one here silently corrupts the quantity S-04 will calculate
   from.

### What the test slice must assert

**Database level — `supabase/tests/`** (per `CLAUDE.md` → _Testing_: invariants
belong here):

- `dosage_changes` DELETE **at** `effective_date = current_date` succeeds, and
  at `current_date - 1` still affects zero rows. Neither is asserted today:
  `append_only.test.sql:29-31` seeds only `current_date ± 10`, which is why
  Phase 1's relaxation broke no test — and gained no protection either.
- The renamed policy `dosage_changes_delete_uncommitted_own` exists.
- A `refill` with `quantity_delta = 0` is rejected — the reason the create path
  skips the third insert entirely when the starting quantity is zero.

**Client path — `tests/integration/medications.test.ts`**, using
`createAuthenticatedClient` from the existing helper. `npm test` requires a
running local stack; the helper refuses a non-local `SUPABASE_URL`.

- Create writes exactly three rows for a positive starting quantity, and exactly
  two when the starting quantity is zero.
- A medication with no `dosage_changes` rows reads as dosage 0; one with no
  `supply_events` rows reads as quantity 0. Both are `ok`, never an error.
- Status derivation follows the documented precedence: `archived` beats
  `not_used` beats `out_of_stock` beats `active`.
- `setDosage` twice within one minute leaves **one** row at today's date holding
  the second value — the behaviour Phase 1 exists to enable.
- `setDosage` does not disturb a row at `current_date - 1`.
- A correction to the current quantity writes nothing and returns `ok`.
- A correction downward writes a negative `adjustment`, and the recomputed
  quantity equals the counted figure.
- `counted_quantity` and `projected_quantity` are null on every row this slice
  writes — no `recount` exists until S-04 can project.
- Archive then restore round-trips, and a DELETE against `medications` still
  affects zero rows.
- Cross-user isolation on all four tables through the data module, not only
  through raw PostgREST as `schema.test.ts` already does.
- `createMedication` naming another user's `specialist_id` returns
  `no_specialist`, not `unknown` — the FK-violation mapping.

**Island branches** (`MedicationsManager.tsx`) have no harness. S-01 declined to
introduce one and S-02 did not revisit it; the test slice should decide
deliberately rather than inherit the omission.

### Why it was not done here

Not a defect in this slice — the plan's non-goals exclude it explicitly and the
developer chose the deferral with the trade-off stated. The cost is recorded
rather than hidden: the plan's _Testing Strategy_ names the accepted gap in the
same words.
