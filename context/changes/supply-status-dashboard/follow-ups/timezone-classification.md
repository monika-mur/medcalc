# Follow-up — the date a row is classified against, when the writer and the reader disagree

**Status**: open.

**Source**: `/10x-impl-review` of S-04, 2026-09-10 (finding F0b, report at
`../reviews/impl-review.md`). Deferred by explicit decision rather than fixed
during triage — see _Why it was not fixed there_ at the bottom.

## The defect

`recordSupply`, `createMedication` and `setDosage` stamp their rows with
`todayUtc()`. That is **correct and required**: the RLS policies compare
`effective_date` and `occurred_on` against Postgres `current_date`, which is UTC
(verified during the review — `select current_date, current_timestamp at time
zone 'UTC'` agree). `CLAUDE.md` → _Dates_ is emphatic that this must not be
"fixed" by routing policy-compared writes through the user's zone; doing so
reintroduces the bug S-02's migration removed.

The `MedicationView` those functions return, however, is folded against the
**user's** `today`. When UTC has ticked over to tomorrow and the user's zone has
not, the row that was just written is dated _in the future_ relative to the date
it is being classified against. `doseInForce` skips it (`effective_date > at` →
`continue`, `supply.ts:58`) and returns 0, so `deriveStatus` sees
`dosageCount === 1` with `currentDosage === 0` and answers `not_used`.

What the user sees:

- **Create** "30 tablets, 2/day" → the row immediately reads **"Not used"**, 0 on
  hand, and the dashboard card says "Dosage is set to 0, so nothing is being
  consumed." The app asserts a choice the user did not make, on their first
  interaction with the feature.
- **Refill** +60 on a medication with stock → the walk excludes the just-written
  event, so the success notice reports the **pre-refill** total. The user is told
  they have fewer tablets immediately after adding them. This one is worse for
  being plausible rather than obviously broken.

**Neither the engine nor the write stamp is wrong. The pairing is.** This is not
the sanctioned two-todays divergence: `CLAUDE.md` permits two todays differing by
a calendar day for _classification vs. policy-compared writes_, and says nothing
about classifying a row against a date earlier than that row's own write stamp.
That third case was never considered, which is why nothing in the codebase
forbids it.

## The window, measured

It is UTC's early morning — not the user's evening, which is how the finding was
first written up before the timing was checked:

| Zone                  | In-window UTC hours |
| --------------------- | ------------------- |
| `America/New_York`    | 00:00 – 04:00       |
| `America/Los_Angeles` | 00:00 – 07:00       |
| `Pacific/Honolulu`    | 00:00 – 10:00       |
| `Etc/GMT+12`          | 00:00 – 12:00       |

Every zone **at or east of UTC is never affected**, Europe/Warsaw included. The
current userbase is one developer in Warsaw, permanently outside the window —
which is both why this is deferred and why no manual walk was ever going to find
it.

## How to reproduce when the slice is picked up

The zone comes from `user_metadata.timezone`, which is user-writable, so a test
account can be put into the window without waiting on the clock:

1. In Studio, set the test user's `raw_user_meta_data` to `{"timezone": "Etc/GMT+12"}`.
   Sign out and back in so the session carries it.
2. Work between **00:00 and 12:00 UTC**.
3. Create a medication with a positive dosage and quantity. It should read
   "Active" with the real figure; the bug shows "Not used" and 0.
4. Refill an existing medication. The notice should state the post-refill total;
   the bug states the pre-refill one.
5. Restore the zone afterwards.

A faster route that skips the clock entirely: call `computeSupply` and
`doseInForce` directly with `today` one day _behind_ the row's `effective_date`
and assert the status is not `not_used`. That is the shape the eventual
regression test should take, and it belongs beside the cases in
`supply-engine-tests.md`.

## What the slice has to decide

The narrow patch is `max(today, written)` at the four mutation returns
(`medications.ts:317`, `:437`, `:475`, `:537`), establishing the invariant _a
view never classifies against a date earlier than the row it just wrote_. It is
a string comparison on two `YYYY-MM-DD` values, so no `Date` enters the path.

**But it is a partial fix, and that is the reason this is a slice rather than a
patch.** It corrects the response to the write; `listMedications` on the next
page load still classifies against the user's `today`, so the row reverts to
"Stopped" until UTC catches up. It converts a persistent wrong state into a
transient one.

The real question the slice must answer is **which date should classify a row at
all**, given that the write stamp is fixed to UTC by RLS and the display date is
the user's by design. Options worth weighing, none obviously right:

- Accept the transient wrong state and take the narrow patch, documenting the
  page-load gap as known.
- Classify against `max(userToday, latestWrittenDate)` everywhere, not just on
  the mutation return — which makes the read path depend on the ledger's own
  dates rather than on a caller-supplied `today`.
- Move classification to UTC entirely and accept that a user's "today" on the
  dashboard can be a day ahead of their wall clock — simpler, and the opposite
  of the direction S-04 deliberately moved in.
- Store a per-user offset and resolve both dates from it.

Whichever is chosen, it interacts with `CLAUDE.md` → _Dates_, which is a live
contract with a documented history of a bug caused by getting this wrong. **The
amendment to that section is part of the slice, not an afterthought.**

## S-05 widens the same seam from the other side of UTC

`/10x-plan-review` of S-05 (mid-supply-dosage-change), 2026-09-12, found the mirror-image
case (finding F5, report at `../../mid-supply-dosage-change/reviews/plan-review.md`) and
accepted it into this file rather than fixing it in that plan.

S-05's plan derives a medication's **pending changes** — the list `/medications` shows with a
Cancel control — against `effective_date > userToday`, matching how `current_dosage` and
`is_expired` are already resolved. Its date-picker floor, by contrast, is anchored at
`todayUtc`, because that is the day the INSERT policy compares against. West of UTC in the
evening `utcToday > userToday`, so a medication's own **current** row — written at
`todayUtc` when it was created or last changed — reads as `effective_date > userToday` and is
classified as _pending_ rather than in force: it appears in the pending list with a Cancel
button, and the date field's default value (also `todayUtc`) collides with it, firing a
replace-confirmation dialog on what is, from the user's side, an ordinary same-day dosage
change.

This is the same defect class as the one this file documents, arrived at from the opposite
clock direction. F0a/F0b above is a row classified as **earlier** than it should be
(east-of-UTC write, read against a user-today that hasn't caught up, in the narrow post-write
window); F5 is a row classified as **later** than it should be (west-of-UTC evening, a
UTC-anchored floor disagreeing with a user-zone read, persistent rather than a narrow
post-write window). Both trace back to the same unresolved question this file already asks:
_which date should classify a row at all_, given that a write stamp fixed to UTC by RLS and a
display date resolved in the user's zone are not the same day for part of every day. Neither
finding was fixed in place, for the same reason — a partial fix decided under a different
slice's pressure is the wrong shape for a question that has to be answered once, consistently,
for every surface that reads `effective_date` or `occurred_on` against a `today`.

Whoever picks up this follow-up should read S-05's `plan-review.md` finding F5 in full before
choosing an option under _What the slice has to decide_ — the option chosen there has to also
resolve F5's pending-list/date-field disagreement, or the fix will need a second visit for the
half of the seam this file did not originally describe.

## Why it was not fixed during the review

Three reasons, recorded so the deferral is not mistaken for an oversight:

1. **It under-reports, never over-reports.** The user is told they have less than
   they do. That is not the class the PRD's guardrail names — unlike F0a in the
   same review, which was fixed immediately.
2. **The exposure is currently nil.** No user of this application is in an
   affected zone.
3. **A partial fix applied under review pressure is the wrong shape.** Half of
   the defect would be closed, the two-todays rule would gain a third case with
   no design decision behind it, and the remaining half would be harder to find
   because the obvious symptom would be gone.

The alternative considered and rejected was applying the narrow patch and
recording the rest here. It was rejected because the patch's own blind spot is
what makes the remaining work hard to see later.
