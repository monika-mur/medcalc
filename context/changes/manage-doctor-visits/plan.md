# Manage Doctor Visits Implementation Plan

## Overview

Give the user a `/visits` screen where they can add a doctor visit (a date and one of their specialists), edit it, and delete it — FR-009 and FR-010. The CRUD spine is a direct application of the pattern S-01 established for specialists. Two things are genuinely new: a reusable native-`<select>` form field, and a single timezone-resolved "today" that drives both the Upcoming/Past split and the past-date hint.

## Current State Analysis

**The database is finished.** F-01 created `visits` and S-01's migration completed it. Nothing in this slice touches `supabase/migrations/`:

| Object                                        | Where                                      |
| --------------------------------------------- | ------------------------------------------ |
| Table, columns, composite FK, two indexes     | `20260813185255_domain_schema.sql:204-239` |
| Four RLS policies (full CRUD over own rows)   | `:305-314`                                 |
| `(select auth.uid())` rewrite of those four   | `20260821182457:143-151`                   |
| `grant … to authenticated`, `revoke … anon`   | `20260821182457:80,88`                     |
| `visits_updated_at_not_before_created_at`     | `20260821182457:102-104`                   |

Columns are `id`, `user_id` (`default auth.uid()`), `specialist_id`, `visit_date date`, `created_at`, `updated_at`. The FK is composite — `(specialist_id, user_id) references specialists (id, user_id) on delete restrict`.

**The application layer is a blank slot in a finished frame.** No visits module, route, page, or component exists. Every convention this slice needs is already live and proven in S-01:

- `src/lib/db/specialists.ts` — `Result<T>`, domain error kinds, `logDbError` before collapsing, explicit `updated_at` stamping, `.select()` chained to UPDATE and DELETE.
- `src/lib/api/json.ts` — `json` / `jsonError` / `noContent` / `readJsonBody` / `zodFieldErrors`.
- `src/lib/validation/specialist.ts` — one zod schema imported by both the island and the route.
- `src/pages/api/specialists/{index,[id]}.ts` — auth guard, client guard, body guard, parse, map kind → status.
- `src/pages/specialists.astro` + `SpecialistsManager.tsx` — SSR the list, hand it to a `client:load` island as `initial*`.
- `src/middleware.ts:4` `PROTECTED_ROUTES`, `src/components/Topbar.astro:4-7` `navLinks`.

**What has no precedent here**: a select control (only `alert-dialog`, `button`, `card`, `input`, `label` are installed under `src/components/ui/`), a date input (`FormField` forwards `type`, so `type="date"` needs no change), and any notion of "today".

## Desired End State

A signed-in user opens **Visits** from the topbar and sees their visits split into **Upcoming** (soonest first) and **Past** (most recent first), each row showing the date and the specialist's name and specialty. They add a visit by picking a specialist from a dropdown and a date; a date in the past or more than two years out draws a non-blocking note, and a visit that duplicates one already in the list asks for confirmation before saving. Any row can be edited in place or deleted after a confirmation dialog. With no specialists yet, the form is replaced by a prompt linking to `/specialists`.

Verified by: the browser walk in Phase 2's manual criteria, a signed-out `GET /visits` answering `302 → /auth/signin`, and the JSON contract walk in Phase 1's.

### Key Discoveries

- **No migration, and therefore no `db:types` run.** `src/db/database.types.ts` already types `visits` (`database.types.ts:202-235`) and must come back byte-identical at the end of this slice. See _Sharing the local stack with S-02_ below for why this matters more than usual right now.
- **The specialist name needs no PostgREST embed.** `visits_specialist_fk` is `ON DELETE RESTRICT`, so every visit's `specialist_id` is guaranteed to appear in the user's specialist list — the page already fetches that list to populate the `<select>`. Resolving the name from a `Map` in the island is exact, not a heuristic, and sidesteps the composite-FK embed question S-01 had to probe for its usage count.
- **`23503` means something different here.** In `deleteSpecialist` it means "still referenced" → 409. On a visit INSERT or UPDATE it means the chosen `specialist_id` is not a row of this user's — the composite FK carries `user_id`, so a foreign id fails it — and that is a **400 with `fieldErrors.specialist_id`**, because a form field holds a bad value.
- **Delete has no failure mode.** Nothing references `visits`. The only non-success outcome is the zero-rows-means-not-found case.
- **`user_metadata` is user-writable** via `auth.updateUser({ data })` — `signup.ts:4-8` says so and validates on write. A reader must not assume the stored zone is still valid.
- **`signup.ts:40` assigns the timezone fallback to S-04.** Building it here is a deliberate, recorded encroachment (`change.md` → _Scope taken from S-04_), taken because two independent "todays" would let the grouping and the hint disagree about the same row.

## What We're NOT Doing

- **No migration, no constraint.** No `unique (user_id, specialist_id, visit_date)`, no `check` on `visit_date`. Duplicates are permitted at every layer below the island.
- **No automated tests.** S-01's standing decision holds; the contract is written to `follow-ups/visits-tests.md` for the dedicated test skill instead.
- **No dashboard work.** The "no visit scheduled" state, the next-visit calculation, and the colour status are FR-011 and belong to **S-04**. This slice ships visit data entry and nothing that consumes it.
- **No changes to `/specialists`, to `specialists.ts`, or to any auth file.** In particular `isValidTimeZone` stays private to `signup.ts` rather than being lifted into the shared helper — a defensive `try`/`catch` in the reader gets the same protection without putting an auth route in this diff.
- **No new `src/components/ui/` primitive**, and no `npx shadcn add` run of any kind.
- **No visit notes, outcomes, or attachments.** Date and specialist only, per FR-009.

## Implementation Approach

Transcribe S-01's vertical slice, subtracting what visits doesn't need (the usage-count embed, the 409 path) and adding what it does (a date, a foreign key the user picks, a "today"). Phase 1 lands the whole server side and is verifiable entirely through the JSON contract with no UI. Phase 2 lands the screen.

The two new shared pieces are both built to be reused rather than to serve this screen alone: `SelectField` mirrors `FormField`'s prop contract exactly so S-02's medication form can adopt it, and `dates.ts` exposes the resolver S-04 was already scheduled to write.

## Critical Implementation Details

### Sharing the local stack with S-02

`lessons.md` → _Reset the database from your own worktree before you use it_ says `npm run db:reset` is an exclusive claim. **This slice must not take that claim.** It adds no migration, so this branch's migration set is master's set, which is a strict subset of whatever the S-02 worktree has applied. The existing suites therefore pass against S-02's database — extra tables are irrelevant to them — while a reset from here would *remove* S-02's schema mid-session.

So: run `npm test` and `npm run db:test` **without** resetting. If a suite fails in a way that looks schema-shaped, coordinate with the other session rather than reaching for `db:reset`. And never run `npm run db:types` in this slice at all — there is nothing to regenerate, and doing it against a database carrying S-02's migration would write medication tables into this branch's committed types file.

### Resolving "today" from a timezone

`Intl.DateTimeFormat("en-CA")` is the shortest route from an IANA zone to a `YYYY-MM-DD` string, which is directly comparable to `visit_date` as a plain string — no `Date` arithmetic and no UTC round-trip. The zone must be treated as hostile input even though `signup.ts` validated it on write, because `auth.updateUser({ data })` can replace it afterwards; an invalid zone throws `RangeError` at construction, which would take down the whole page rather than one field.

```ts
export function resolveToday(timeZone: string | undefined, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
}
```

The resolved string is computed **once**, in `visits.astro`, and passed to the island as a prop. The island must never call `new Date()` for this purpose — that is precisely the second "today" this design exists to prevent.

### The date input's own value format

`<input type="date">` reads and writes `YYYY-MM-DD`, which is also Postgres's `date` wire format and the format `resolveToday` returns. Every comparison in this slice is therefore a plain string comparison, and no timezone conversion happens anywhere except inside `resolveToday`. Introducing a `Date` object on this path is how an off-by-one-day bug gets in.

### Verifying a route by hand

Two traps S-01 documented, both of which will otherwise read as bugs in this slice's code:

- **Astro answers `403` to a cross-origin form POST**, and a `DELETE` with no body trips the same guard while a JSON `POST` does not. `403 Cross-site DELETE form submissions are forbidden` is the CSRF check, not an authorization failure. Driving the routes from the browser's DevTools console avoids it — the session cookie and the `Origin` header both come for free.
- **Never run `npm run build` while `astro dev` is serving.** Both share `node_modules/.vite`; the overlap yields a `200` with a zero-byte body and a React-internals stack trace naming a file this slice never touched. `lessons.md` → _Never run a production build against a live dev server_.

---

## Phase 1: Data layer

### Overview

Validation schema, the date helper, the visits data module, and the two API routes. No UI. At the end of this phase the full CRUD contract is exercisable from the DevTools console.

### Changes Required:

#### 1. Validation schema

**File**: `src/lib/validation/visit.ts` (new)

**Intent**: One definition of a valid visit input, imported by both the island and the routes so client-side and server-side validation cannot drift — the role `specialist.ts` plays for S-01.

**Contract**: Exports `visitInputSchema` and the inferred `VisitInput`. Two fields:

- `specialist_id` — a UUID. Message on failure: `"Choose a specialist"`, because the only way a user produces a bad value here is by not picking one.
- `visit_date` — a `YYYY-MM-DD` string that is a real calendar date, bounded to `1900-01-01 … 2100-12-31` inclusive. Messages: `"Enter a visit date"` when absent or unparseable, `"Enter a date between 1900 and 2100"` when out of range.

The bounds are a typo guard, not a domain rule — a past date is valid and must parse. Note in a comment that no database counterpart exists for either bound: `visit_date` is an unconstrained `date` column, so this schema is the only thing enforcing them.

#### 2. The date helper

**File**: `src/lib/dates.ts` (new)

**Intent**: Resolve one authoritative "today" from the user's stored timezone, and classify a visit date against it. Both the Upcoming/Past split and the inline hints read from here, so they cannot disagree.

**Contract**: Three exports, all pure and all operating on `YYYY-MM-DD` strings.

- `resolveToday(timeZone: string | undefined, now?: Date): string` — see the snippet in _Critical Implementation Details_. Falls back to UTC on an absent, malformed, or `RangeError`-throwing zone.
- `isPast(visitDate: string, today: string): boolean` — strict `<`. A visit dated today is **not** past; it belongs in Upcoming.
- `isFarFuture(visitDate: string, today: string): boolean` — more than two years after `today`. Implement by string-comparing against `today` with its year field incremented by 2, keeping the whole module free of `Date` arithmetic.

#### 3. Data module

**File**: `src/lib/db/visits.ts` (new)

**Intent**: The only place this slice talks to PostgREST. Mirrors `src/lib/db/specialists.ts` — same `Result<T>` shape, same `logDbError`-before-collapsing rule, same never-filter-by-`user_id` rule (RLS does that, and a redundant filter would hide a policy regression).

**Contract**: Exports `Visit` (`Tables<"visits">`), `VisitErrorKind`, `Result<T>`, and four functions taking `SupabaseClient` first.

- `listVisits(client)` → `Result<Visit[]>`, ordered by `visit_date` ascending. **No embed** — the specialist name is resolved in the island from the list the page already fetches; the `ON DELETE RESTRICT` FK guarantees that lookup always hits.
- `createVisit(client, input: VisitInput)` → `Result<Visit>`. `id`, `user_id`, `created_at`, `updated_at` all come from column defaults and are never passed.
- `updateVisit(client, id, input: VisitInput)` → `Result<Visit>`. Payload built field by field — `specialist_id`, `visit_date`, and an `updated_at` the module stamps itself. **`.update({ ...input })` on this path is a defect** whether or not anything currently fails: the UPDATE policies constrain no columns and `database.types.ts` exposes `updated_at` on `Update`, so a spread would let a client set it to any future value. There is no database-level alternative — see `specialists.ts:82-98` for the full argument, which applies here unchanged.
- `deleteVisit(client, id)` → `Result<null>`.

`VisitErrorKind` is `"not_found" | "invalid_specialist" | "unknown"`. Note the divergence from `SpecialistErrorKind` in a comment: there is no `still_referenced` because nothing references `visits`, and `invalid_specialist` is new — `23503` on an INSERT or UPDATE here means the chosen specialist is not one of the user's, since the FK is composite on `(specialist_id, user_id)`. Like `still_referenced` in S-01 it is an expected domain outcome and is **not** logged; every other error is logged before collapsing to `"unknown"`.

`.select()` must be chained onto both the UPDATE and the DELETE. Under RLS, either against a missing or foreign `id` matches zero rows and returns success with no error; an empty result array is the only signal that the row was not there.

#### 4. API routes

**Files**: `src/pages/api/visits/index.ts`, `src/pages/api/visits/[id].ts` (both new)

**Intent**: Expose the module over the JSON contract in `CLAUDE.md` → _API conventions_. Structurally identical to the specialists routes; the kind → status mapping stays in the routes because it differs between them.

**Contract**:

| Route                      | Outcome                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| `GET /api/visits`          | `200` array, `401` unauthenticated                                            |
| `POST /api/visits`         | `201` created row; `400` malformed JSON, failed parse, or `invalid_specialist` |
| `PATCH /api/visits/:id`    | `200` updated row; `400` as above; `404` missing, foreign, or non-UUID `id`   |
| `DELETE /api/visits/:id`   | `204`; `404` missing, foreign, or non-UUID `id`                                |

A non-UUID `id` segment is answered `404` via `z.uuid()`, matching `specialists/[id].ts:10-18` — it would otherwise reach Postgres as `22P02` and surface as a 500, and it means the same thing as a UUID matching nothing.

`invalid_specialist` returns `jsonError(400, "Check the highlighted fields", { specialist_id: "Choose a specialist from your list" })`, so the island can render it under the select exactly as a zod failure would.

Only `parsed.data` reaches the module — never `body.data`, and never a spread of it.

### Success Criteria:

#### Automated Verification:

- `npm run lint` — 0 errors, 0 warnings
- `npx astro check` — 0 errors, 0 warnings (5 pre-existing `tseslint.config` deprecation hints are expected)
- `npm test` and `npm run db:test` still pass, run **without** `db:reset` — see _Sharing the local stack with S-02_
- `git status` shows `src/db/database.types.ts` unmodified and `supabase/migrations/` untouched

#### Manual Verification:

- The JSON contract walks clean from the DevTools console: `GET` authed and signed out; `POST` valid, malformed JSON, missing fields, a specialist UUID belonging to another user; `PATCH` and `DELETE` against a real row, a random UUID, and a non-UUID segment
- A `PATCH` carrying `updated_at: "2099-01-01"` in the body stores the module's own stamp, not the caller's — the assertion with no database fallback
- A second signed-in user's `PATCH` and `DELETE` against the first user's visit return `404`, not silent success, and the row survives unchanged
- A past-dated `POST` (e.g. last month) succeeds — the date rules are permissive by decision
- No raw Postgres text appears in any response body

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Visits screen

### Overview

The select field, the island, the page, and the navigation wiring. At the end of this phase S-03's roadmap outcome is delivered.

### Changes Required:

#### 1. Select field

**File**: `src/components/form/SelectField.tsx` (new)

**Intent**: A labelled native `<select>` with the same error and aria contract as `FormField`, so the two sit together on a form without looking like two component systems. Native rather than a Radix listbox because the OS wheel picker is the right control for the PRD's stated moment of use — a phone, one hand, at the doctor's — and because adding to `src/components/ui/` would collide with the S-02 worktree.

**Contract**: Props mirror `FormField` exactly where they overlap — `id`, `name?`, `label`, `value`, `onChange(value: string)`, `error?`, `placeholder?` (rendered as a disabled, empty-valued first option) — plus `options: { value: string; label: string }[]`. Same `aria-invalid` / `aria-describedby` wiring to a `${id}-error` element, and the same `CircleAlert` error line. Style from the existing tokens — `border-input`, `bg-background`, the focus ring `Input` uses — never a hardcoded colour.

#### 2. The island

**File**: `src/components/visits/VisitsManager.tsx` (new)

**Intent**: The whole screen's behaviour, modelled on `SpecialistsManager.tsx` — same `fetch` + `readApiError` + optimistic-list-update shape, same `aria-live` notice region, same per-row edit form and per-row delete dialog.

**Contract**: Props are `initialVisits: Visit[]`, `specialists: SpecialistWithUsage[]`, and `today: string`. Behaviour that differs from S-01's island:

- **Rendering.** Split `visits` on `isPast(visit.visit_date, today)`: Upcoming ascending, Past descending, each under its own heading with its own empty line. The specialist name and specialty come from a `Map` built from the `specialists` prop.
- **Empty specialists.** When `specialists.length === 0`, render a prompt linking to `/specialists` in place of the add form. A select with no options can only produce a submit that fails.
- **Date hints.** Below the date field, live as the user types: past → a note that the date has already passed; `isFarFuture` → a note that it is more than two years away. Non-blocking, rendered through `FormField`'s existing `hint` slot, and never shown at the same time as a validation error (the `hint` slot already yields to `error`).
- **Duplicate confirm.** On submit, if another visit has the same `specialist_id` and `visit_date`, open an `AlertDialog` naming the specialist and date and asking whether to save anyway; proceed only on confirm. This gates nothing server-side and is a courtesy, not a rule — say so in a comment so a later reader does not mistake it for an invariant.
- **Delete.** Per-row `AlertDialog`, unconditional — there is no disabled-because-referenced state and no `409` branch. Keep S-01's focus fix: the trigger unmounts with its row, so move focus to the add form on the next tick.
- **Reordering after a write.** A created or edited visit must be re-sorted into the right group, and an edit can move a row from Upcoming to Past. Re-derive both groups from the single visits array on every render rather than keeping two lists in state.

#### 3. The page

**File**: `src/pages/visits.astro` (new)

**Intent**: SSR both lists so the screen paints complete, and resolve `today` once here.

**Contract**: Calls `listVisits` and `listSpecialists` server-side, resolves `today` via `resolveToday(Astro.locals.user?.user_metadata.timezone)`, and renders `<VisitsManager … client:load />` inside the same page chrome `specialists.astro` uses (`Layout`, `Topbar`, `max-w-3xl`, heading, lead paragraph). A failed load renders the same bordered notice `specialists.astro:36-41` does rather than an empty list, which would be a lie.

`listSpecialists` is reused as-is even though its two count embeds are surplus here — a second, count-free query would duplicate the module's only list function to save one join on a handful of rows.

#### 4. Navigation and route protection

**Files**: `src/middleware.ts`, `src/components/Topbar.astro`

**Intent**: Make `/visits` reachable and guarded.

**Contract**: Add `"/visits"` to `PROTECTED_ROUTES` (`middleware.ts:4`) and `{ href: "/visits", label: "Visits" }` to `navLinks` (`Topbar.astro:4-7`). Both are one-line additions; the active-link and redirect behaviour is already generic.

### Success Criteria:

#### Automated Verification:

- `npm run lint` — 0 errors, 0 warnings
- `npx astro check` — 0 errors, 0 warnings
- `npm run build` completes (with no `astro dev` server running)
- `npm test` and `npm run db:test` still pass, without `db:reset`
- `git status` still shows `src/db/database.types.ts` unmodified

#### Manual Verification:

- Signed out, `GET /visits` redirects to `/auth/signin`; signed in, the topbar shows **Visits** and marks it active with `aria-current="page"`
- The visit list is present in the raw HTML response before hydration, correctly split and ordered
- Add, edit, and delete each work and leave the list correctly grouped and sorted — including an edit that moves a row from Upcoming to Past
- A past date and a date more than two years out each raise their inline note, and neither blocks saving
- A duplicate specialist + date opens the confirm dialog, and confirming saves while cancelling does not
- With no specialists, the form is replaced by the prompt and `/specialists` is reachable from it
- A visit dated **today** appears under Upcoming, not Past
- The screen is usable at 320 px with no horizontal scrolling, the date and specialist controls included
- Every control is keyboard reachable with a visible focus ring; both dialogs trap and restore focus; the notice region announces
- Text and controls meet AA, and no error is signalled by colour alone

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human.

---

## Close-out

Not a phase — the wrap-up after Phase 2's gate closes.

- **`follow-ups/visits-tests.md`** — the test contract this slice does not write, in the shape of `manage-specialists/follow-ups/specialists-tests.md`. Lead with the same two priority assertions, since neither has a database-level fallback: a caller-supplied `updated_at` is ignored, and a missing or foreign row is not-found rather than silent success. Then the rest: CRUD round trip, cross-user isolation, a `specialist_id` belonging to another user rejected as `invalid_specialist`, the 1900–2100 bounds, and `resolveToday`'s UTC fallback on a malformed zone (the one piece of pure logic here that is trivially unit-testable and has no manual equivalent).
- **`CLAUDE.md`** — add the two conventions this slice establishes that a future slice would otherwise have to rediscover: dates on the domain path are `YYYY-MM-DD` strings compared as strings, with `resolveToday` the only place a timezone is interpreted; and `src/components/form/` is where shared form controls live, as distinct from the never-edited `src/components/ui/`.
- **`change.md`** — session state per phase, adaptations, and anything found that the plan did not predict.

## Testing Strategy

**This slice authors no tests.** S-01's decision of 2026-08-26 holds, and the reasoning is unchanged: the dedicated test skill is not yet installed. What that costs is stated plainly rather than glossed.

**Regression gates that do run**: `npm test` (15 integration tests) and `npm run db:test` (70 pgTAP assertions) in both phases. They cover F-01's schema and the auth paths, so they catch this slice breaking something older. They cover nothing this slice builds.

**Uncovered, and knowingly so**: `src/lib/dates.ts`, `src/lib/db/visits.ts`, both routes, `SelectField`, and the island. Two assertions matter more than the rest because manual verification is their only guard and a future change can break them silently — the caller-supplied `updated_at`, and zero-rows-as-404. Both are in Phase 1's manual criteria and both are the first entries in the follow-up.

**Manual verification is the whole test strategy for this slice.** It confirms behaviour once, on the day, and cannot fail a future change. That is the accepted trade, not an oversight.

## Performance Considerations

Nothing here needs optimising. `visits_user_visit_date_idx` already covers the one query, both list fetches are per-user and small, and the grouping is an O(n) partition over a list that fits on a screen. The one avoidable cost — `listSpecialists`'s count embeds, surplus on this page — is left in place deliberately (see Phase 2 §3).

## Migration Notes

**None.** This slice adds no migration and runs no `db:reset` and no `db:types`. Both are stated as criteria precisely because the shared local stack is in use by the S-02 worktree at the same time, and either command would damage that session's database or this branch's committed types file.

## References

- Roadmap item: `context/foundation/roadmap.md` → S-03
- Prior slice, the pattern source: `context/changes/manage-specialists/plan.md`, and its `change.md` for the traps found during implementation
- Deferred-test precedent: `context/changes/manage-specialists/follow-ups/specialists-tests.md`
- Schema: `supabase/migrations/20260813185255_domain_schema.sql:204-239`, `:305-314`; `supabase/migrations/20260821182457_grants_updated_at_guard_and_rls_perf.sql:80,88,102-104,143-151`
- Data-module pattern: `src/lib/db/specialists.ts` — the `updated_at` argument at `:82-98`, the zero-rows argument at `:96-98`
- Island pattern: `src/components/specialists/SpecialistsManager.tsx`
- Applicable lessons: `context/foundation/lessons.md` → _Reset the database from your own worktree_, _Log the database error before collapsing it to a domain kind_, _Never run a production build against a live dev server_

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer

#### Automated

- [ ] 1.1 `npm run lint` — 0 errors, 0 warnings
- [ ] 1.2 `npx astro check` — 0 errors, 0 warnings
- [ ] 1.3 `npm test` and `npm run db:test` pass, run without `db:reset`
- [ ] 1.4 `database.types.ts` unmodified and `supabase/migrations/` untouched

#### Manual

- [ ] 1.5 JSON contract walks clean across every status in the route table
- [ ] 1.6 A `PATCH` carrying a future `updated_at` stores the module's own stamp
- [ ] 1.7 A second user's `PATCH` and `DELETE` return 404 and the row survives
- [ ] 1.8 A past-dated `POST` succeeds
- [ ] 1.9 No raw Postgres text in any response body

### Phase 2: Visits screen

#### Automated

- [ ] 2.1 `npm run lint` — 0 errors, 0 warnings
- [ ] 2.2 `npx astro check` — 0 errors, 0 warnings
- [ ] 2.3 `npm run build` completes with no dev server running
- [ ] 2.4 `npm test` and `npm run db:test` pass, without `db:reset`
- [ ] 2.5 `database.types.ts` still unmodified

#### Manual

- [ ] 2.6 Signed-out redirect works; topbar shows and marks **Visits** active
- [ ] 2.7 The grouped list is in the SSR HTML before hydration
- [ ] 2.8 Add, edit, and delete leave the list correctly grouped and sorted
- [ ] 2.9 Past and far-future notes appear and do not block saving
- [ ] 2.10 The duplicate confirm dialog gates the save correctly
- [ ] 2.11 The zero-specialists prompt replaces the form and links out
- [ ] 2.12 A visit dated today appears under Upcoming
- [ ] 2.13 Usable at 320 px with no horizontal scrolling
- [ ] 2.14 Keyboard reachable, focus visible, dialogs trap and restore focus
- [ ] 2.15 AA contrast holds and no error is signalled by colour alone
