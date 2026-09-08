# Supply-status dashboard (S-04) — Plan Brief

> Full plan: `context/changes/supply-status-dashboard/plan.md`
> Research: `context/changes/supply-status-dashboard/research.md`

## What & Why

`/dashboard` becomes the PRD's Primary Success Criterion: for every medication, the date its supply lasts until and a green / yellow / red status against the next visit with the prescribing specialist. This is the first slice where the user gets real end-to-end value, and it owns the PRD's hardest guardrail — _"an incorrect 'you have enough' result is a product failure regardless of how smooth the rest of the experience is."_

## Starting Point

S-02 and S-03 are done and live. `src/lib/db/medications.ts` already folds dosage and quantity on read, and `:139-143` marks itself the S-04 swap point. But the ledger sum it reports never decays — there is no consumption event type, so `Σ quantity_delta` is "everything ever added" and equals real on-hand only on the day of the first event. `src/lib/dates.ts` has no way to add a day. `/dashboard` renders a welcome card and mounts no island.

## Desired End State

Medications grouped by prescribing specialist, groups ordered by soonest upcoming visit, most-urgent-first within each group. Each card shows the supply-end date, why that date (running out vs. expiring), the projected quantity on hand today, and a status badge that pairs its colour with a word. Correcting a count on `/medications` now writes a `recount` row recording what was projected against what was counted, so a discrepancy becomes a fact in the ledger rather than a number folded away.

## Key Decisions Made

| Decision           | Choice                                             | Why (1 sentence)                                                                                                                                                              | Source           |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Date library       | None — two functions in `dates.ts`                 | The whole gap is `addDays` and `daysBetween`, and `@internationalized/date` does not export the second one.                                                                   | Research         |
| Calculation home   | Pure TypeScript, no view                           | One implementation of the guarded arithmetic, S-05's walk is a natural loop, and pure functions can be tested where pgTAP cannot run.                                         | Plan             |
| Consumption anchor | Chronological walk from the **first** supply event | The balance decays with time so supply can never be over-reported; anchoring at the _last_ event discards consumption between events and over-reports by exactly that amount. | Plan (corrected) |
| Supply-end meaning | Last day a full dose is available                  | Reads naturally as "lasts until", and discarding the leftover partial dose errs toward "ask for a prescription" — the safe direction.                                         | Plan             |
| Dashboard "today"  | User's stored zone, threaded as a parameter        | It compares against visit dates, so it must agree with `/visits`; making the zone an argument also retires the UTC apology at `medications.ts:159-163`.                       | Plan             |
| Printed expiry     | Caps the supply-end date, with the reason labelled | Never displays "lasts until December" for a box expiring in October, and it is already the shape S-06 needs for liquids.                                                      | Plan             |
| Float precision    | Integer-scale both operands before dividing        | `0.9 / 0.3` is `2.9999999999999996` in JS — a one-day error landing exactly on the green/yellow boundary.                                                                     | Plan             |
| Status boundaries  | Red is `supplyEnd <= visit`, not `<`               | The bands partition on days of cover **after** the visit — yellow always has some, and a supply ending on the visit day has none. PRD amended to match.                       | Plan             |
| Missing dosage     | New `no_dosage` status, sorted above everything    | Dosage 0 currently means both "I stopped taking this" and "the app has no dosage on record"; collapsed, a lost row reads as a deliberate choice and sorts as "no action".     | Plan             |
| Warning colour     | `--warning` = amber-700, as coloured text          | amber-500 is 2.15:1 on white and fails even the non-text threshold; 700 is 5.02:1, the same ratio `--primary` already achieves. Filled badges would break green's rationing. | Plan             |
| Recount scope      | In scope, write path included                      | The engine now supplies `projected_quantity`, which is the only reason S-02 deferred it.                                                                                      | Plan             |
| Layout             | Grouped by specialist, urgency within              | Answers the actual moment of use — "which prescriptions do I ask _this_ doctor for today".                                                                                    | Plan             |
| Inclusion          | Everything but archived                            | A medication you have run out of is the most urgent thing this screen exists to tell you.                                                                                     | Plan             |
| Tests              | Deferred to a follow-up slice                      | Explicit decision; the plan specifies what that slice must cover.                                                                                                             | Plan             |

## Scope

**In scope:** `addDays` / `daysBetween`; exact decimal arithmetic; the supply engine (`computeSupply`, `classifySupplyStatus`); wiring it through `src/lib/db/medications.ts` with `today` threaded from callers; a `no_dosage` status splitting "never recorded" from "set to 0"; the dashboard page and its two presentation components; a `--warning` token (amber-700) plus its `@theme inline` mapping; amending the two `CLAUDE.md` lines this slice makes untrue; the `recount` write path.

**Out of scope:** unit/integration tests and any CI change; a Postgres view; future-dated dosage changes and the "dosage starts on \<date\>" state they need (both S-05); liquid medications (S-06); a new dependency; configurable thresholds; any island on the dashboard; a consumption event type; changing `createMedication`'s partial-success behaviour.

## Architecture / Approach

One pure engine, one chronological walk. The engine merges supply-event dates and dosage effective-dates into a breakpoint timeline; between breakpoints the dose is constant, so a span is one division rather than a loop over days. Both questions the dashboard asks — _how much is on hand today_ and _what is the last day a full dose is available_ — fall out of the same walk. `expiry_date` doubles as the walk's termination bound, which is both the product rule (supply-end is capped at expiry) and what keeps every intermediate quantity inside `Number.MAX_SAFE_INTEGER`.

Everything downstream is comparison: status is four string comparisons against the visit date and a `+14` offset, grouping is a sort. `YYYY-MM-DD` strings compare lexicographically as they compare chronologically, so no `Date` object appears anywhere on this path.

## Phases at a Glance

| Phase                   | What it delivers                                                                                               | Key risk                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Engine + data module | Date primitives, exact arithmetic, `computeSupply`, wired through `medications.ts` with `today` as a parameter | Touches six exported signatures and eight callers; `/medications` must come through with no regression, and with tests deferred the only gate is a hand-walk of four worked examples |
| 2. Dashboard            | `/dashboard` grouped, ordered and rendered server-side, no island                                              | Getting the status boundaries right — equal-to-visit-date is red, visit+1 and visit+14 are yellow, visit+15 is green                                                                 |
| 3. Recount write path   | Corrections record `counted` against `projected`                                                               | `quantity_delta` must come from the exact-subtraction helper or Postgres rejects the row with `23514`                                                                                |

**Prerequisites:** S-02 and S-03 done (both are, and live in production). A local Supabase stack claimed from this worktree before Phase 3's `db:test`.
**Estimated effort:** ~3 sessions, one per phase; Phase 1 is the largest.

## Open Risks & Assumptions

- **No automated tests ship with this slice.** The engine is the arithmetic the PRD guards hardest and it lands with hand-verification only. CI runs lint and build, so a regression in `computeSupply` would go green. The follow-up test slice is load-bearing, not optional, and the four worked examples in the plan are the minimum manual gate until it lands.
- **Three silent behaviour changes on `/medications`.** Out-of-stock now reflects projected rather than ledger quantity, so long-stale medications flip on first deploy; `is_expired` moves to the user's zone; and a medication with no dosage row moves from "Not used" to "No dosage recorded". All three are corrections, but none is visible in a diff of the dashboard.
- **`no_dosage` surfaces a pre-existing data-loss path rather than fixing it.** `createMedication` still reports success when its dosage insert fails (`medications.ts:208-222`); this slice makes the result legible instead of preventing it. Whether that partial-create behaviour is right is a question for a later slice.
- **The PRD was amended for the red boundary.** `prd.md` now reads "on or before the next specialist visit" in all three places it stated the thresholds (Secondary success criterion, FR-011's note, Business Logic), with the reasoning recorded alongside. Frontmatter is untouched — `version: 1` stays, because `roadmap.md` pins `prd_version: 1` and this is a clarification, not a rewrite.
- **`CLAUDE.md` says current-state views land at S-04.** This plan deliberately does not create one, so that line has to be amended in Phase 2 rather than left contradicting the code.
- **The decimal scaling clamps at 6 places.** Zod bounds magnitude but not precision, so a hostile API caller sending 13 decimals is rounded rather than rejected. Documented, not guarded.
- **`daily_dosage` and `quantity_delta` are still unbounded `numeric`.** F-01's follow-up F2 (numeric scale) remains open, and this slice adds a consumer that depends on their magnitude staying sane.

## Success Criteria (Summary)

- Opening `/dashboard` before an appointment answers "which prescriptions do I ask this doctor for today" without scrolling past irrelevant specialists.
- The supply-end date is arithmetically correct across multiple refills, a mid-supply dosage change, a zero-dosage pause, and an early printed expiry.
- A count correction records the discrepancy between what the app projected and what the user counted.
