---
date: 2026-09-06T15:35:08+02:00
researcher: Monika Murawska (via Claude Code)
git_commit: b2fc3c19a00713447246cb3b986e8318886fa681
branch: master
repository: monika-mur/medcalc
topic: "Would @internationalized/date be valuable for implementing S-04 (supply-status dashboard)?"
tags: [research, codebase, dates, dependencies, supply-status-dashboard, s-04, s-05, s-06]
status: complete
last_updated: 2026-09-06
last_updated_by: Monika Murawska (via Claude Code)
---

# Research: Would `@internationalized/date` be valuable for implementing S-04?

**Date**: 2026-09-06T15:35:08+02:00
**Researcher**: Monika Murawska (via Claude Code)
**Git Commit**: `b2fc3c19a00713447246cb3b986e8318886fa681`
**Branch**: `master`
**Repository**: `monika-mur/medcalc`

## Research Question

> supply-status-dashboard — please verify if `@internationalized/date` would be valuable in the context of implementation of S-04.

Scope agreed before research: judge the library against the **S-04 + S-05 + S-06 horizon** (not S-04 alone), and evaluate **comparatively** against realistic alternatives rather than in isolation.

## Summary

**Verdict: no. Do not adopt `@internationalized/date` for S-04.** Recommended instead: add two functions (~28 lines) to the existing `src/lib/dates.ts`.

The library clears the project's hardest constraint — its core is genuinely free of JS `Date` objects, verified from source — so this is not a rejection on correctness grounds. It fails on proportion:

1. **The entire missing capability is two primitives.** Across S-04, S-05 _and_ S-06 the only date operations not already available are `addDays` and `daysBetween`. Everything else is `YYYY-MM-DD` string comparison (free, already pervasive), `min`/`max` (reduces to comparison), `resolveToday` (already exists), or display formatting (native `Intl`).
2. **The library does not export the second one.** `@internationalized/date` has no days-between function. You would reach through `calendar.toJulianDay()` or hand-roll it anyway — so adopting the dependency still leaves you writing the primitive S-05 hard-depends on.
3. **The no-library version is 28 lines and was differentially validated** against `Date.toISOString()` over 20,000 consecutive days with zero mismatches, plus 12 hand-written edge cases (leap years, 1900 century non-leap, 2000 400-year leap, month/year boundaries, negative offsets).
4. **The project's own dependency bar rules it out.** Reconstructed from four completed changes: prefer what is already installed or built in; defer to the _first real consumer_; install only inside the phase whose scope needs it. F-01 names reaching for machinery "out of habit" as the wrong instinct and deleted an entire `profiles` table on that reasoning.
5. **Bundle size is not the argument either way.** The Worker sits at roughly 3% of Cloudflare's 64 MiB limit, and S-04's date code belongs server-side by this repo's established pattern. Size is a non-issue; this verdict rests on proportion and API fit, not weight.

**The more consequential finding is that this is the wrong question to be deciding first.** The real S-04 fork is whether the calculation lives in TypeScript at all, or in a `security_invoker` Postgres view — which `CLAUDE.md` affirmatively sanctions at exactly this slice. Postgres supplies `date + integer`, `date - date`, `least`/`greatest` (NULL-ignoring, which solves an S-06 edge case for free) and exact `numeric` division natively. Down that route TypeScript needs close to **no** date arithmetic, and the library question dissolves entirely. Six open decisions listed under [Open Questions](#open-questions) dominate this one.

## Detailed Findings

### 1. What S-04/S-05/S-06 actually require

Derived from `context/foundation/prd.md` (FR-006, FR-008, FR-011, US-01, US-02, Business Logic), `context/foundation/roadmap.md`, and all three migrations.

| #      | Primitive                      |      S-04      |   S-05   |    S-06     | Status today                                           |
| ------ | ------------------------------ | :------------: | :------: | :---------: | ------------------------------------------------------ |
| P1     | Compare two dates              |       ✅       |    ✅    |     ✅      | **Free** — `YYYY-MM-DD` lexicographic == chronological |
| P2     | Min of dates                   |       ✅       |    —     |     ✅      | Reduces to P1. Must be NULL-tolerant for S-06          |
| P3     | Max of dates                   |       ⚪       |    ✅    |      —      | Reduces to P1; latent in `foldDosage`                  |
| **P4** | **`addDays(date, n)`**         |       ✅       |    ✅    |     ✅      | **MISSING — required by all three**                    |
| P5     | Subtract N days                |       ❌       |    ❌    |     ❌      | Not a separate primitive; `addDays(d, -n)`             |
| **P6** | **`daysBetween(a, b)`**        | ⚠️ conditional |    ✅    | ⚠️ inherits | **MISSING — mandatory in S-05**                        |
| P7     | Parse                          |    internal    | internal |  internal   | Only ever inside P4/P6                                 |
| P8     | Format for display             |       ✅       |    ✅    |     ✅      | New surface; native `Intl` covers it                   |
| P9     | Validate user-supplied date    |       —        |    ✅    |     ✅      | **Exists** — `z.iso.date()`                            |
| P10    | Resolve today                  |       ✅       |    ✅    |     ✅      | **Exists** — `resolveToday(tz)`                        |
| P11    | `daysFrom(qty, dose)` rounding |       ✅       |    ✅    |     ✅      | Missing; a domain convention, not a date primitive     |

**Net new date code required: P4 and P6. That is the whole gap.**

Three things sharpen this:

- **The status thresholds need no day-arithmetic at all.** Green/yellow/red reduces to four comparisons, one min-reduction, and exactly one `+14` offset. Because FR-011 requires the supply-end _date_ to be displayed anyway, it must be materialised as a date regardless — and once it is, status is pure comparison. Date-space strictly dominates day-space here.
- **`addDays` cannot be faked by string manipulation.** `isFarFuture` gets away with splicing the year field (`+2 years`) only because the month/day substring is untouched; its own comment admits it tolerates producing the non-existent `2030-02-29`. That trick does not generalise — `2026-01-25 + 14` crosses a month boundary.
- **S-06 is the cleanest case for a first-class `addDays`**: `opened_on + post_opening_expiry_days`, where `post_opening_expiry_days` is a plain `integer` column. No division, no rounding.

### 2. The library, verified

Facts established against the npm registry, the published source of v3.12.4, and the official docs — not from memory.

| Property                                     | Finding                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Latest version                               | **3.12.4**, Apache-2.0, `adobe/react-spectrum`                            |
| Min+gzip                                     | **~11 KB** whole-package (upper bound; tree-shaken subset **unmeasured**) |
| ESM / `sideEffects: false`                   | Yes — tree-shakeable in principle                                         |
| Runtime dependencies                         | **One**: `@swc/helpers` ^0.5.0 — would be new to this tree                |
| `parseDate` / `add` / `compare` / `toString` | **Genuinely `Date`-free**                                                 |
| Days-between                                 | **No such export**                                                        |
| Workers compatibility                        | **Unverified either way** — no reports of success _or_ failure            |

**The Date-free claim checks out, from source.** `compareDate(a, b)` is literally `a.calendar.toJulianDay(a) - b.calendar.toJulianDay(b)` — integer Julian-day arithmetic. `parseDate` is a regex match into a `CalendarDate` constructor. `add` walks `balanceYearMonth`/`balanceDay` over plain numeric fields. `GregorianCalendar`'s `toJulianDay`, `fromJulianDay`, `isLeapYear` are all plain arithmetic. No JS `Date` anywhere on that path.

That matters, because it means the library would **not** reintroduce the bug class this codebase is organised around. The rejection is not "it's dangerous" — it is "it is disproportionate, and it does not even cover the gap."

Three specific frictions:

- **`.toDate(timeZone)` sits on every `CalendarDate`** and returns a real JS `Date`. It is one autocomplete away on a path where `CLAUDE.md` says a `Date` object is how the off-by-one bug gets in. The hand-rolled module has no such method to reach for.
- **It reintroduces an object with a parse/serialise boundary.** `CalendarDate` is not `Date`, so the timezone hazard does not return — but every call becomes `parseDate → operate → toString`, and the project's discipline is that domain dates are strings end to end.
- **`string.ts` statically imports the timezone machinery** (`toAbsolute`, `possibleAbsolutes`, `getLocalTimeZone`, …) at module scope, because `parseDate` shares a module with `parseZonedDateTime`. Tree-shaking _should_ drop it. Nobody measured whether it does.

### 3. The alternatives, compared

|                      | `@internationalized/date` | **Hand-rolled (recommended)** | Postgres view    | `date-fns` / `dayjs` / `luxon` | `Temporal`      |
| -------------------- | ------------------------- | ----------------------------- | ---------------- | ------------------------------ | --------------- |
| `Date`-free          | ✅                        | ✅                            | ✅ (SQL)         | ❌                             | ✅              |
| Covers `addDays`     | ✅                        | ✅                            | ✅ `date + int`  | ✅                             | ✅              |
| Covers `daysBetween` | ❌ **no export**          | ✅                            | ✅ `date - date` | ✅                             | ✅              |
| Cost                 | dep + `@swc/helpers`      | **28 LOC**                    | a migration      | dep                            | polyfill ~60 KB |
| Workers-verified     | ⚠️ unknown                | ✅ trivially                  | ✅               | ✅                             | 🔴 **hazard**   |
| Fits project bar     | ❌                        | ✅                            | ✅ sanctioned    | ❌                             | ❌              |

`date-fns`, `dayjs` and `luxon` are all `Date`-in/`Date`-out and are excluded by `CLAUDE.md` → _Dates_ without further analysis.

`Temporal` is excluded on operational grounds: Cloudflare shipped native `Temporal` to the deployed Workers fleet on 2026-07-30 with `Temporal.Now` **stuck at epoch 0**, silently deactivating `typeof Temporal`-guarded polyfills and computing time-dependent logic against 1970 with no error raised. Reverted 2026-08-04 after a failed first revert. Native support is still planned with no timeline. This project deploys to Workers.

### 4. Where the real risk actually is

None of the calculation risk in S-04 is calendar arithmetic. It is domain convention:

- **The rounding convention is undefined.** `floor(q/d)`, `ceil(q/d)` and the `−1` variants differ by one day, and the green/yellow boundary is an exact comparison against `visit_date + 14`. A ±1-day convention error flips a status at the boundary — precisely what the PRD's hard guardrail forbids: _"An incorrect 'you have enough' result is a product failure."_ No file in the repo states the convention. **No library solves this.**
- **`quantity_on_hand` is not what it looks like.** There is no consumption event type, so the ledger sum equals real on-hand only on the day of the last event. Whether S-04 needs `daysBetween` at all hinges on whether the balance anchor is `today` or `MAX(supply_events.occurred_on)`.
- **`numeric` → JS `number`.** Postgres `numeric` is exact decimal; the generated types surface it as `number`, so a repeating binary can bite at an exact boundary. A view doing the division in `numeric` avoids the round-trip entirely — a genuine correctness argument, not tidiness.
- **The zero-dose segment.** `5 → 0 → 5` is three segments with zero consumption in the middle. Skipping the zero segment as an "optimisation" silently shortens the supply-end date by the length of the pause. Most likely S-05 bug; deserves a dedicated test.

### 5. Two hazards found in passing

- **A plain view would silently bypass every RLS policy in the schema.** Views execute with their owner's rights; migrations run as `postgres` and these tables are owned by `postgres`. Any current-state view **must** be `create view … with (security_invoker = true)`. `config.toml` pins PG 17, so it is available. This is the highest-risk detail of the view route.
- **`CLAUDE.md` claims the no-procedural-code property "is asserted as a test". It is not.** A grep for `pg_proc`, `pg_trigger`, `functions_are`, `triggers_are` across `supabase/tests/` and `tests/integration/` returns nothing — only prose references. The property is documented, not enforced.

Also worth recording: **`src/lib/dates.ts` has zero unit-test coverage.** There is no `dates.test.ts` anywhere. `resolveToday`, `isPast` and `isFarFuture` are untested, and CI runs neither `npm test` nor `npm run db:test` — lint and build are the entire gate. Adding `addDays` and `daysBetween` without tests would extend an existing blind spot on the exact path the PRD guards hardest.

## Code References

- [`src/lib/dates.ts:38-44`](https://github.com/monika-mur/medcalc/blob/b2fc3c19a00713447246cb3b986e8318886fa681/src/lib/dates.ts#L38-L44) — `resolveToday`, the only place a timezone is interpreted
- [`src/lib/dates.ts:58-61`](https://github.com/monika-mur/medcalc/blob/b2fc3c19a00713447246cb3b986e8318886fa681/src/lib/dates.ts#L58-L61) — `isFarFuture`'s year-splice; the trick that does _not_ generalise to days
- [`src/lib/db/medications.ts:86-88`](https://github.com/monika-mur/medcalc/blob/b2fc3c19a00713447246cb3b986e8318886fa681/src/lib/db/medications.ts#L86-L88) — `todayUtc()` = `resolveToday("UTC")`
- [`src/lib/db/medications.ts:121-130`](https://github.com/monika-mur/medcalc/blob/b2fc3c19a00713447246cb3b986e8318886fa681/src/lib/db/medications.ts#L121-L130) — `foldDosage`; skips future-dated rows on purpose, ahead of S-05
- [`src/lib/db/medications.ts:139-143`](https://github.com/monika-mur/medcalc/blob/b2fc3c19a00713447246cb3b986e8318886fa681/src/lib/db/medications.ts#L139-L143) — self-declared S-04 swap point: _"the exported signatures do not change"_
- [`src/lib/db/medications.ts:148`](https://github.com/monika-mur/medcalc/blob/b2fc3c19a00713447246cb3b986e8318886fa681/src/lib/db/medications.ts#L148) — `quantity_on_hand` as the raw ledger sum
- [`src/lib/db/medications.ts:159-163`](https://github.com/monika-mur/medcalc/blob/b2fc3c19a00713447246cb3b986e8318886fa681/src/lib/db/medications.ts#L159-L163) — `is_expired` compared in UTC, with an explicit apology
- [`src/pages/visits.astro:40`](https://github.com/monika-mur/medcalc/blob/b2fc3c19a00713447246cb3b986e8318886fa681/src/pages/visits.astro#L40) + [`:60`](https://github.com/monika-mur/medcalc/blob/b2fc3c19a00713447246cb3b986e8318886fa681/src/pages/visits.astro#L60) — resolve server-side, pass `today` as a prop
- [`src/components/visits/VisitsManager.tsx:30-36`](https://github.com/monika-mur/medcalc/blob/b2fc3c19a00713447246cb3b986e8318886fa681/src/components/visits/VisitsManager.tsx#L30-L36) — _"The island must never call `new Date()` for this"_
- [`src/pages/dashboard.astro:9-13`](https://github.com/monika-mur/medcalc/blob/b2fc3c19a00713447246cb3b986e8318886fa681/src/pages/dashboard.astro#L9-L13) — the S-04 placeholder; no island mounted yet
- `supabase/migrations/20260813185255_domain_schema.sql:70-71`, `:85-86` — `post_opening_expiry_days integer`, `opened_on date`; the S-06 `addDays` case
- `supabase/migrations/20260813185255_domain_schema.sql:3-8` — the no-triggers/no-functions/no-RPC declaration
- `supabase/migrations/20260829071323_relax_same_day_dosage_correction.sql:22-48` — the `>=` relaxation, and its header stating the `>` half exists **for S-05**
- `src/db/database.types.ts:238-240` — `Views: { [_ in never]: never }`; no view exists yet
- `.github/workflows/ci.yml:18-21` — `npm ci` → `astro sync` → `lint` → `build`; **no test step**

## Architecture Insights

- **The string-date discipline is enforced by omission, not by convention.** `src/lib/dates.ts` exports three functions and none of them can produce a `Date`. `resolveToday` — the only function that touches a timezone — is imported _exclusively_ by SSR code (`visits.astro`, `medications.ts`); the one island doing date work imports only the two pure string predicates and receives `today` as a prop. Adding a library whose every object carries `.toDate(tz)` weakens a property currently guaranteed by what is absent.
- **Server-side is the established pattern for date work**, and S-04 should follow it. All five `client:*` directives in the repo are `client:load`; `medications.astro` passes _no_ date-shaped prop because `is_expired` and the dosage fold are already folded server-side before props are built. Putting supply-end arithmetic in an island would be the first violation of "resolve once, server-side, pass down as a prop."
- **S-04 is the first slice that straddles both "todays".** `foldDosage` and `is_expired` currently use UTC; visit classification wants the user's zone. S-02 and S-03 flagged this seam explicitly. It must be decided, not inherited.
- **The view route is pre-sanctioned and pre-scoped.** `CLAUDE.md` names current-state views as S-04's job; F-01 deferred them "to the point of first need — S-04 — so it is designed against a real consumer rather than guessed"; and `medications.ts:139-143` already marks itself as the swap point with unchanged exported signatures. A plain `VIEW` is declarative and does **not** violate the no-procedural-code rule, which prohibits only triggers, functions and RPC.
- **F-01's objection to SQL arithmetic is about duplication, not about SQL.** _"Duplicating that arithmetic in SQL would create a second implementation of the PRD's guarded calculation."_ It cuts against the view only if TypeScript keeps its own copy. If the view becomes the sole implementation, the objection dissolves — but then `recordSupply`'s `projected_quantity` must read from the view rather than recompute.

## Historical Context (from prior changes)

- `context/changes/manage-doctor-visits/plan.md:97-99` — the origin of the string rule, verbatim: _"Every comparison in this slice is therefore a plain string comparison, and no timezone conversion happens anywhere except inside `resolveToday`. Introducing a `Date` object on this path is how an off-by-one-day bug gets in."_ Generic against `Date`-based libraries, though never phrased as rejecting a named one.
- `context/changes/manage-medications/plan.md:393-401` and `context/changes/manage-doctor-visits/plan.md:344-350` — the two-todays rule, negotiated 2026-08-28 _before either slice wrote code_, because the two plans reached opposite defaults independently. Contains the direct warning to this slice: _"S-04 must not assume the dashboard's 'today' and a medication's `effective_date` were resolved the same way; S-05's segment boundaries sit directly on this seam."_
- `context/changes/domain-schema-foundation/plan.md:39` — _"It must be invented once there and reused, not reimplemented per slice"_ (current-state views, deferred to S-04).
- `context/changes/domain-schema-foundation/plan.md:132` — the dependency-restraint precedent: _"`pgcrypto` is not required and should not be enabled out of habit."_
- `context/changes/domain-schema-foundation/plan.md:60-68` — the `profiles` table deleted for being machinery built ahead of need, _and_ the recorded contingency: _"If S-04's view wants it, `profiles` returns as an additive migration."_ Directly relevant if the view needs the user's zone in SQL.
- `context/changes/manage-doctor-visits/reviews/impl-review.md` F9 — `today` resolved once at page render goes stale across midnight; recorded as intended and _"handed to S-04 as a known bound."_
- `context/changes/manage-doctor-visits/reviews/impl-review.md` F8 — `<input type="date">` can emit a 5-digit year (`"10000-01-01"`), which sorted as "past". Fixed by gating on zod. Note both `parseDate` and the hand-rolled `toEpochDay` **throw** on such input; whichever lands needs the same guard, and an unguarded throw mid-dashboard-render is the F5 failure shape again.
- `context/changes/domain-schema-foundation/reviews/impl-review.md:129-137` F5 — an unvalidated timezone string could crash the S-04 render with `RangeError`; fixed with a `try`/`catch` around `Intl.DateTimeFormat`, chosen partly because _"constructing a `DateTimeFormat` is the exact call S-04 makes to render."_
- **No date library has ever been considered, discussed or rejected in writing** — nothing in `context/`, git log, commit messages or code comments mentions `date-fns`, `dayjs`, `luxon`, `Temporal` or `@internationalized/date`. This document is the first written evaluation.

## Related Research

None. This is the first `research.md` in the project — no prior change folder contains one, and `context/archive/` is empty.

## Open Questions

Six decisions S-04 planning must settle. None are answered anywhere in the repo, and all of them matter more than the library question:

1. **The rounding convention** for supply-end — `floor(q/d)`, `ceil(q/d)`, or a `−1` variant. They differ by a day at the green/yellow boundary, which is exactly where the PRD's accuracy guardrail bites. Must be one shared function across S-04 and S-05.
2. **The balance anchor** — `today`, or `MAX(supply_events.occurred_on)`. This alone decides whether `daysBetween` is an S-04 primitive or only an S-05 one.
3. **Is `recount` / `projected_quantity` in S-04's scope?** F-01's plan assigns it to S-04; the roadmap's S-04 outcome does not mention it. If yes, `daysBetween` becomes mandatory in S-04.
4. **Which "today" does the dashboard resolve** — user-zone or UTC — given `foldDosage` and `is_expired` currently use UTC with an explicit apology in the code.
5. **Does the current-state view land in S-04**, and if so does it stop at current state (latest dosage, ledger balance, next visit per specialist) or go all the way to the supply-end date? **This is the decision that makes the library question moot.**
6. **S-06 unknowns** that reach back into the S-04 engine's shape: what `quantity_delta` means for a liquid (there is no container-count column); whether `estimated_daily_consumption` or `dosage_changes.daily_dosage` drives a liquid's dose (a liquid gets both, and `estimated_daily_consumption` is a mutable column with no history table, so it is **not** segmentable the way a solid's dosage is); and whether liquid red-status uses printed expiry, post-opening expiry, or the min of both.

Unverified in this research, flagged rather than guessed:

- The exact publish date of `@internationalized/date@3.12.4` (npmjs.com returned HTTP 403).
- The **actual tree-shaken** bundle size for `parseDate`/`add`/`compare`/`toString`. The ~11 KB figure is the whole-package upper bound. Cheap empirical test if it ever matters: an `esbuild --bundle --minify` on a file importing only `parseDate`.
- Any positive confirmation that `@internationalized/date` runs on Cloudflare Workers. No reports of success _or_ failure exist. Absence of reported problems is not confirmation.
- `dist/` measurements (Worker 429 KB gzip / 2.1 MB raw) are from a stale, gitignored build dated 2026-08-27. Re-measure before relying on them.
