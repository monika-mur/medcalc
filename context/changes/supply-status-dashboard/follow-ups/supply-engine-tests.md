# Follow-ups — supply-status-dashboard

Queued during S-04 but deliberately not built here. Each entry names where it
came from so the reasoning stays findable after this change is archived.

## Write the supply-engine test suite — deferred to a dedicated test slice

**Status**: open.

**Source**: the same standing decision that deferred S-01's and S-02's suites —
_"Let's forget about tests right now, we will create later a new slice for it."_
**The decision is not being reopened.** This entry exists so the specification
lives in the queue that gets read for outstanding work, rather than only inside a
plan that becomes immutable on archive.

It joins `manage-specialists/follow-ups/specialists-tests.md` and
`manage-medications/follow-ups/deferred-tests.md`. Whoever plans the test slice
should read all three and write one suite, not three.

**This entry differs from those two in one respect, and it is why it leads with
specific assertions rather than a list of surfaces.** S-01 and S-02 deferred
coverage of CRUD paths whose failures are visible: a row is missing, a status is
wrong, a request 500s. S-04 defers coverage of _arithmetic whose failures are
plausible-looking numbers_. The PRD guards it harder than anything else in the
product — "an incorrect 'you have enough' result is a product failure regardless
of how smooth the rest of the experience is" — and a wrong supply-end date
renders identically to a right one. Nothing on the screen says which it is.

---

## Lead with these two: the assertions most likely to be silently "corrected"

Both encode a decision that reads as a bug to someone who has not read the
reasoning. A later reader who "fixes" either produces a green suite and a wrong
product, so **each needs its reasoning in the test name**, not only in a comment.

### 1. `classifySupplyStatus` puts `supplyEnd === visit` in RED, not yellow

```ts
it("classifies supply ending exactly on the visit date as red, because the three bands partition on days of cover AFTER the visit and this one has none", ...)
```

Assert all boundaries in one block so the partition is visible as a whole:

| supply-end relative to visit | expected  |
| ---------------------------- | --------- |
| `visit − 1` (before)         | `red`     |
| **`visit` (equality)**       | **`red`** |
| `visit + 1`                  | `yellow`  |
| `visit + 14`                 | `yellow`  |
| `visit + 15`                 | `green`   |

**Why it looks wrong.** The PRD reads "Red: supply-end date is before the next
specialist visit", and `supplyEnd === visit` is not before it. A reader comparing
code to PRD finds an off-by-one and fixes it.

**Why it is right.** The bands partition on days of cover _after_ the visit —
green is more than 14, yellow is 1 through 14, red is none. Every medication in
yellow has some cover left after the appointment; this one is at zero the day
after, and the visit is the last chance to prevent that. It also makes yellow
exactly 14 days wide rather than 15 with a ragged edge. `plan.md` records this as
a deliberate one-case deviation, read as an ambiguity the PRD did not consider
rather than a decision it made — the PRD's own yellow gloss ("supply ends ≤ 14
days after the visit date") is written in days-after terms, and zero days after
is not one through fourteen. `prd.md` was amended in `f75ee41` to carry the
partition reading.

### 2. Worked example 5 — a breakpoint past the expiry cap

```ts
it("bounds the breakpoint set at max(today, expiryDate), so a dosage row effective after expiry cannot produce a supply-end date past the cap — this is the one failure mode that OVER-reports cover", ...)
```

```
events:    +100 on 2026-09-01
dosages:   1/day from 2026-09-01, 3/day from 2026-09-20
expiry:    2026-09-15
today:     2026-09-06
expect:    { supplyEndDate: "2026-09-15", supplyEndReason: "expiry", projectedQuantity: 95 }
```

**Why it needs naming.** Getting `2026-09-18` — or any date after the expiry —
means the breakpoint set was not bounded and the walk consumed straight through
the cap. The following span then has negative length. Both disappear once the set
is bounded at `bound = max(today, expiryDate)`, which is why `expiryDate` is
itself a breakpoint rather than a comparison the walk might straddle.

**Why it leads.** Of every assertion in this file, this is the one whose failure
points the wrong way: it tells a user they have cover they do not have. Every
other engine defect found during S-04 under-reported. Walk it deliberately rather
than by pattern.

**Its sibling, worked example 6, needs its reasoning in the name for the mirror
reason** — a reader who sees the walk continue past an exhaustion will read it as
a missing `return`:

```ts
it("continues the walk past an exhaustion, because a later refill un-ends it — returning early reports 'out of stock' to a user holding a nearly full box", ...)
```

```
events:    +30 on 2026-09-01, +30 on 2026-10-15
dosages:   1/day from 2026-09-01
expiry:    2027-01-01
today:     2026-10-20
expect:    { supplyEndDate: "2026-11-13", supplyEndReason: "consumption", projectedQuantity: 25 }
```

This shape is reachable from the ordinary UI — `occurred_on` is always
`todayUtc()`, so "ran out, refilled a fortnight later" produces it. It was found
by the mechanical harness on 2026-09-06 and cost a mid-implementation re-plan;
none of the then-five worked examples exercised it, so Progress 1.8 would have
passed with the defect live.

---

## Unit tests

The scratch harness at `../scratch/engine-harness.md` already asserts everything
below and ran **49/49 green** against `src/lib/{dates,decimal,supply}.ts` on
2026-09-08. **Lift it rather than re-deriving it** — but port it as named `it()`
blocks, not as its current `eq(label, ...)` calls, so a failure names the rule
rather than a line number. The harness holds _copies_ of the three modules and is
stale the moment `src/lib/` changes; the ported suite imports them, which is the
whole point of porting it.

### `computeSupply` — the six worked examples

All six from `plan.md` → _Testing Strategy_, examples 5 and 6 named as above:

1. Single refill, constant dose → `2026-09-30`, projected 25 on `2026-09-06`.
2. Two refills → `2026-10-30`. A last-event anchor answers `2026-11-09`; that
   ten-day gap, not the absolute date, is what the example catches.
3. Dosage change between events → `2026-09-20`.
4. Expiry cap → `2026-10-01`, reason `expiry`.
5. Breakpoint past the cap → `2026-09-15`, reason `expiry`. **Leads.**
6. Exhaustion then refill → `2026-11-13`, projected 25. **Leads.**

### `computeSupply` — edges

- No supply events at all → `{ null, null, 0 }`.
- No `dosage_changes` rows → dose 0, stock intact, supply-end is the expiry.
- A `5 → 0 → 5` series exhausting exactly at the pause → `2026-09-10`. Three
  spans with zero consumption in the middle, never a gap to skip, and the
  zero-dose branch must never divide (`CLAUDE.md` → _Domain schema_).
- `today` before the first event (reachable through UTC skew) → projected 0.
- Expiry preceding the first event → returns before the walk, reason `expiry`.
- Expired in the past → the walk still reaches `today` for the projection.
- **Exhaustion landing exactly on `bound` resolves to `consumption`, not
  `expiry`.** This one is not in `plan.md`'s list: the harness found it on
  2026-09-06 when the final span finished fully covered, so `exhausted` never got
  set and the post-walk cap mislabelled a date consumption had produced.
  `plan.md` step 6 already specified that ties resolve to consumption; the code
  did not. Fixed by treating `remaining === 0` at the end of the walk as
  exhaustion at `bound`. **A regression here is invisible** — the date is right
  and only the reason line is wrong.

### `addDays` / `daysBetween`

Month boundaries, year boundaries, negative offsets, leap years (2024 leap, 2100
**not** leap, 2000 leap), signed `daysBetween`, and the differential run against
`Date.toISOString()` over 5000 consecutive days.

Two guards that are **stricter than the plan's stated contract**, both
deliberate — assert them so a later reader does not read either as accidental and
remove it:

- `addDays("2026-02-30", 1)` **throws**. The plan said "throw on a string that is
  not a valid `YYYY-MM-DD`"; the implementation adds a round-trip check that also
  rejects a well-formed but calendrically non-existent day. (S-04 impl-review F5.)
- `addDays("2026-09-10", NaN)` **throws**. Added by S-04's impl-review (F0a): the
  date argument was validated and the offset was not, so a `NaN` offset produced
  the literal string `"0NaN-NaN-NaN"`, which then compared lexicographically
  against real dates and rendered into a `<time>` element. Assert the throw, and
  assert that a finite negative offset still works.

### `floorDivide` / `subtractExact` / `clampScale`

Name the failing pairs, since the point is the float class and not the operation:

- `floorDivide(0.9, 0.3)` is **3**, not 2 — `0.9 / 0.3` is `2.9999999999999996`
  in JS, and a naive `Math.floor` yields a one-day error landing exactly on the
  green/yellow boundary.
- `subtractExact(0.3, 0.1)` is exactly **`0.2`** — JS gives `0.19999999999999998`.
- `clampScale(0.1234567)` is **`0.123457`**, the six-place boundary.
- **`floorDivide(10, 4e-7)` throws a `RangeError`** rather than returning
  `Infinity`, and `floorDivide(0, 4e-7)` throws rather than returning `NaN`.
  Scaling caps at `10^6`, so any divisor below `5e-7` rounds to zero. The
  docstring used to promise only that "callers guarantee `b > 0`" — true at every
  call site, and the wrong guarantee. Pair this with a validation test that
  `daily_dosage: 0.0000004` is **rejected** by `dailyDosageField` while `0`,
  `0.000001`, `0.25` and `1000` are all still accepted. (S-04 impl-review F0a —
  the failure over-reported cover, so it is the same class as worked example 5.)

### Complexity, for whoever extends the engine

`plan.md` → _Performance Considerations_ says the engine is `O(breakpoints)`. It
is actually **`O(breakpoints × events)`**: the walk rescans the full `events`
array at every breakpoint (`supply.ts:120`), and breakpoints ≈ events + dosages,
so it is quadratic in ledger length.

Irrelevant at the PRD's volume — 20 medications with a handful of events each —
and the NFR conclusion the plan drew from it still holds, because iterations are
bounded by the **breakpoint count** and never by a day count, which is the
property that makes a far-future expiry cost the same as a near one. Recorded so
S-05 inherits the accurate figure rather than the plan's optimistic one; bucketing
events by date makes it linear if volume ever justifies it. (S-04 impl-review F4.)

---

## The display path uses the same exact arithmetic as the write path

**Found during Phase 3 manual verification on 2026-09-10, and not predicted by
the plan.** Criterion 3.7 passed at the database level and failed on screen: the
`recount` row held `quantity_delta = -0.2` exactly, while the success notice read

> Frac-Point3 corrected to 0.1 on hand — **0.19999999999999998** fewer than projected.

`discrepancyPhrase` in `MedicationsManager.tsx` computed its number with
`Math.abs(after - before)`. The plan mandated `subtractExact` on the write path
and said nothing about the display path, so the island reintroduced the exact
float class the data module spends a paragraph preventing — in the one place the
arithmetic is actually _visible to the user_. Fixed by importing `subtractExact`
into the island.

```ts
it("renders a fractional discrepancy as 0.2, not 0.19999999999999998 — the notice is the only place this arithmetic is visible to the user", ...)
```

Assert at least: `before 0.3 / after 0.1` → `"0.2 fewer"`; `before 0.1 / after
0.3` → `"0.2 more"`; `before 1.005 / after 0.9` → `"0.105 fewer"`. Include an
integer case (`30 → 18` → `"12 fewer"`) and the clamped case
(`5 → 0.123457` → `"4.876543 fewer"`) so a future change to the helper cannot
quietly alter what already worked.

**The general rule this is an instance of**, worth a review check rather than
only a test: _any_ arithmetic over two values that came from `numeric` columns
goes through `@/lib/decimal`, on the client as well as the server. The
server-side rule was written down and followed; the client-side one was not
written down and was not followed. Nothing in the type system distinguishes a
`number` that came from `numeric` from one that did not, which is why this is a
test and a convention rather than a compiler guarantee.

---

## Integration tests

`tests/integration/`, using `createAuthenticatedClient`. `npm test` requires a
running local stack and the helper refuses a non-local `SUPABASE_URL`.

- **A recount round-trip through PostgREST with fractional values**, asserting
  the row lands rather than tripping `23514`. This is the assertion that would
  have caught the display defect above had it been written at the _route_ level
  rather than the module level — the row was always correct.
- `counted_quantity`, `projected_quantity` and `quantity_delta` are all populated
  and satisfy `quantity_delta = counted − projected` in exact `numeric`.
- **`projected_quantity` excludes the row being written.** A correction from 30
  to 18 stores `projected_quantity = 30`, not 18. If the projection were
  self-referential the CHECK would still pass and every correction would record a
  zero discrepancy — the failure is silent by construction, which is what makes
  it worth an explicit assertion.
- A seven-decimal `counted` posted directly to the route stores as the six-place
  rounding, and the delta agrees with the stored column. No UI can produce this;
  only a raw request reaches it.
- A correction to exactly the projected figure writes **no** row and returns 200
  with the unchanged medication.
- A dashboard render for a user with two specialists, asserting group order (by
  next visit ascending, no-visit groups last, ties by specialist name) and card
  states.
- `deriveStatus` over all four dosage/quantity combinations **plus the empty
  series**, asserting that "no dosage row" and "dosage set to 0" do not collapse
  onto one status. The first is a data gap the app must admit to; the second is
  the user's own choice.
- No `medications.recordSupply.*` line reaches the log for a successful
  correction — an expected outcome is not an incident (`lessons.md` → _Log the
  database error before collapsing it to a domain kind_).

---

## What ships without coverage

S-04 adds no automated test of any kind. The 70 pgTAP assertions and the Vitest
integration suite still run, but nothing in them exercises a single line of
`src/lib/{supply,decimal,dashboard}.ts` or the new `recount` write path.

Worth stating plainly, because a green CI badge on this slice means less than
usual: **CI runs `lint`, `typecheck` and `build`** (`.github/workflows/ci.yml:20-29`)
and **no test of behaviour**. All three of this slice's automated criteria do run
on a pull request — the typecheck gate landed in `668b675` on 2026-09-06, closing
`manage-doctor-visits/follow-ups/typecheck-in-ci.md` — so a green check says the
code compiles, type-checks and lints. It says nothing about whether the
arithmetic is right, and this slice's arithmetic is the product's highest-stakes
code.

Everything that protected this slice's arithmetic was a human walking a list, or
a scratch harness living in `%TEMP%` that is not in the repo and holds copies of
the modules it tests. Both found real defects — the harness found the
exhaustion-then-refill walk and the tie-resolution mislabelling; the manual walk
found the display-arithmetic defect. Neither will run again on its own.

## Why it was not done here

Not a defect in this slice — `plan.md` → _What We're NOT Doing_ excludes tests
explicitly and the developer chose the deferral with the trade-off stated. The
cost is recorded rather than hidden, in the same words, in the plan's
_Testing Strategy_.
