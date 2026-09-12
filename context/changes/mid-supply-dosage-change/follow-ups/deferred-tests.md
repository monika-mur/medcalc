# Follow-ups — mid-supply-dosage-change (S-05)

Queued during S-05 planning but deliberately not built here. Each entry names where it came
from so the reasoning stays findable after this change is archived.

## The test suite — deferred, including the pgTAP assertion for the new policy

**Status**: open.

**Source**: the standing decision that deferred S-01's, S-02's and S-04's suites — _"Let's
forget about tests right now, we will create later a new slice for it."_ Reaffirmed during
S-05 planning on 2026-09-10, when it was put as an explicit question with the trade-off
stated, and answered _defer everything, including the policy test_. **The decision is not
being reopened.** This entry exists so the specification lives in the queue that gets read
for outstanding work, rather than only inside a plan that becomes immutable on archive.

It joins `manage-specialists/follow-ups/specialists-tests.md`,
`manage-medications/follow-ups/deferred-tests.md` and
`supply-status-dashboard/follow-ups/supply-engine-tests.md`. Whoever plans the test slice
should read all four and write **one** suite, not four.

---

### This one differs from the other three: it defers a test of a policy the same slice wrote

S-01, S-02 and S-04 deferred coverage of code. S-05 defers coverage of a **new RLS policy it
introduced in the same change** — Phase 1 tightens `dosage_changes_insert_own` from
`(select auth.uid()) = user_id` to
`(select auth.uid()) = user_id and effective_date >= current_date`, and no assertion anywhere
in the repo names it.

`lessons.md` → _State table privileges in the migration_ is about exactly this shape, and its
rule is unambiguous: assert it in the test suite so an inherited default can never masquerade
as a decision. The incident it records — a routine CLI bump changing a platform default, and
pgTAP falling from 57/57 to 14/57 — happened because nothing in the repo asserted that a
privilege the schema depended on was actually there.

The parallel is not exact. That case borrowed a guarantee from the platform; this one states
its guarantee in a migration, so the policy is at least written down. But the failure mode is
the same in the direction that matters: **if the predicate is loosened — by a bad merge, a
`db reset` against a diverged branch, or a later migration rewriting the policy set — nothing
fails.** The app keeps working, because the app never tries to back-date. The hole reopens
silently, and the only surface that would notice is a raw request nobody sends.

Write this one first when the test slice is planned.

```sql
-- supabase/tests/append_only.test.sql, alongside the existing dosage_changes block at :96-126
select lives_ok(
  $$ insert into public.dosage_changes (medication_id, daily_dosage, effective_date)
     values ('<med>', 2, current_date + 7) $$,
  'a future-dated dosage change can be inserted — this is S-05 scheduling a change'
);
select throws_ok(
  $$ insert into public.dosage_changes (medication_id, daily_dosage, effective_date)
     values ('<med>', 2, current_date - 1) $$,
  '42501',
  null,
  'a back-dated dosage change is refused by dosage_changes_insert_own — the historical series the segmental calculation reads must not be rewritable'
);
select lives_ok(
  $$ insert into public.dosage_changes (medication_id, daily_dosage, effective_date)
     values ('<med>', 2, current_date) $$,
  'today is still insertable — the INSERT predicate mirrors the DELETE policy exactly'
);
```

Note the assertion style: an INSERT `with check` violation **raises `42501`**, unlike a
command with no matching policy at all, which matches zero rows and returns success. The
existing file's header (`append_only.test.sql:4-7`) documents the zero-rows semantics and
every assertion in it counts affected rows for that reason. These three are the exception and
should say so in a comment, or a later reader will "fix" them into row-count checks and lose
the assertion.

---

### The rest of the slice, in priority order

#### 1. The segmental walk — the arithmetic this slice exists to prove

`computeSupply` needs no change for S-05, so its existing worked examples still apply and are
specified in `supply-status-dashboard/follow-ups/supply-engine-tests.md`. What is untested is
the shape S-05 makes reachable for the first time: **a dosage row dated after `today`**.

```
events:    +30 on 2026-09-10
dosages:   1/day from 2026-09-10, 3/day from 2026-09-17
expiry:    2027-01-01
today:     2026-09-10
expect:    supplyEndDate 2026-09-24, reason "consumption", projectedQuantity 30
```

Seven days at 1/day leaves 23; 23 ÷ 3 is 7 whole days, so the last full dose falls on
2026-09-24. Getting 2026-10-09 means the future row was ignored (`doseInForce` never advanced);
getting 2026-09-19 means the new dose was applied from `today` rather than from its own
effective date. Both are plausible-looking dates, which is the whole problem with this class.

Also worth naming, because it is the case FR-006's own example describes and the one a reader
is most likely to get backwards:

- **A scheduled decrease extends the supply-end date.** Same fixture with 0.5/day from
  2026-09-17: 23 remaining ÷ 0.5 is 46 more days. A test that only covers an increase will
  pass with an `abs()` or a mis-signed comparison in a future refactor.
- **A scheduled stop (`daily_dosage: 0`) is not the end of supply.** The zero-dose branch
  never divides (`supply.ts:159-167`) and consumption simply pauses; the supply-end date
  becomes the expiry. Distinct from running out.
- **Two pending changes compose.** 1/day, then 3/day from +7, then 1/day again from +14 —
  three segments, and the middle one is the one a "find the next change" implementation
  quietly drops.

#### 2. `deriveStatus` and the `not_started` precedence

Assert all five status outcomes in one block so the precedence is visible as a whole, and name
the reasoning in the test title for the two that read as bugs:

```ts
it("reports not_started when every dosage row is future-dated, NOT not_used — a medication whose dosage starts next Monday has not been stopped, and 'Stopped' is what S-04 shipped for this row", ...)
```

| dosage rows                         | in force today | expected      |
| ----------------------------------- | -------------- | ------------- |
| none                                | —              | `no_dosage`   |
| one, dated `today + 7`              | none           | `not_started` |
| one, dated `today`, value 0         | 0              | `not_used`    |
| one dated `today` at 0, one at `+7` | 0              | `not_used`    |
| one, dated `today`, value 2         | 2              | `active`      |

Row four is the one worth arguing about and worth pinning: a user who stopped today _and_
scheduled a restart is stopped today. `not_started` means "has never been in force", not "will
change".

#### 3. The cancel path's 404 — an invisible failure

```ts
it("returns not_found when the DELETE matches zero rows, because under RLS cancelling a stranger's or an already-effective change succeeds with zero rows and would otherwise answer 204", ...)
```

This is `CLAUDE.md` → _API conventions_ → _Zero rows is not an error, so 404 has to be
detected_, and it is the assertion most likely to be lost in a refactor, because removing the
chained `.select()` produces code that looks cleaner and passes every test that does not check
this. Cover: a date with no row (404), a date already in the past (404 — the policy matched
nothing), another user's medication (404), and the happy path (200 with the recalculated view).

#### 4. Route-level validation

- `effective_date` of yesterday → **400** with `fieldErrors.effective_date`, not 500. The
  bound is UTC-derived server-side; a test that computes the expected boundary from the local
  clock will be flaky for part of every day in a non-UTC zone — derive it with
  `resolveToday("UTC")`, the same function the route uses.
- Omitting `effective_date` entirely → behaves exactly as before this slice (today's row
  replaced). This is the assertion that protects every pre-S-05 caller.
- A malformed date in the cancel route's path segment → **404**, not 500 — matching how
  `readId` handles a non-uuid rather than letting Postgres `22P02` surface.
- `effective_date: null` and `effective_date: ""` are both rejected by the schema rather than
  silently treated as "today".

#### 5. Replace semantics

Scheduling onto a date that already holds a pending change replaces it, and `23505` is never
raised — the DELETE keyed on the target date clears the slot first. Assert the row count for
that medication is unchanged and the value is the new one. If a future refactor moves the
DELETE back to a hardcoded today, this test is what catches it, and the symptom would
otherwise be a 500 on an ordinary user action.

---

## `clampScale` is not applied to `daily_dosage`

**Status**: open. Not introduced by S-05 — recorded here because S-05 planning found it.

`recordSupply` clamps both `quantity` and `counted` to six decimal places on the way in
(`medications.ts:317`, `:524`), with a paragraph explaining why: `@/lib/decimal` scales by
`10^6`, and a value stored at greater precision than the arithmetic can represent makes the
stored figure and the divided figure disagree.

`daily_dosage` is written **raw** on both paths — `createMedication` (`medications.ts:302`) and
`setDosage` (`:418`). `dailyDosageField` bounds magnitude and explicitly not precision
(`validation/medication.ts:12-15`), so `daily_dosage: 0.12345678901` reaches the unbounded
`numeric` column at full precision and then gets divided at six places by `floorDivide`.

It has never produced a visible defect, because unlike the supply path there is no CHECK
comparing two dosage figures against each other — `supply_events_recount_delta_is_discrepancy`
is what made the supply-path drift fatal, and `dosage_changes` has no equivalent. So this is
an asymmetry rather than a live bug.

Not fixed in S-05 because it changes what S-02 and S-04 already wrote on both paths, and the
symmetric fix (clamp on write, everywhere) deserves to be planned rather than ridden in on a
slice that touches one of the two call sites for other reasons. Whoever fixes it should also
decide whether `dailyDosageField` should bound precision directly, which would make the clamp
unnecessary rather than redundant.
