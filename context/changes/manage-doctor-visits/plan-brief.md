# Manage Doctor Visits — Plan Brief

> Full plan: `context/changes/manage-doctor-visits/plan.md`

## What & Why

Roadmap slice **S-03** (FR-009, FR-010): the user can add a doctor visit — a date and one of their specialists — and edit or delete it. The dashboard S-04 builds cannot compute anything without visit dates to compare supply against; this slice supplies them. It is the second half of the entity layer, running in parallel with S-02 (medications).

## Starting Point

The database is already finished. F-01 created `visits`; S-01's migration completed it with grants, the `(select auth.uid())` policy rewrite, and the `updated_at` guard. **This slice adds no migration.** The application layer is empty — no module, route, page, or component for visits — but S-01 built and proved every pattern it needs: the `Result<T>` data module, the JSON error contract in `src/lib/api/json.ts`, the shared zod schema, and the SSR-page-plus-hydrated-island shape. What has no precedent in the codebase is a select control, a date input, and any notion of "today".

## Desired End State

A signed-in user opens **Visits** from the topbar and sees their visits split into Upcoming (soonest first) and Past (most recent first), each row naming the date and the specialist. They add one by picking a specialist from a dropdown and a date; an unusual date draws a note but is never refused, and a visit duplicating one already listed asks for confirmation. Any row edits in place or deletes after a confirm. With no specialists yet, the form is replaced by a prompt linking to `/specialists`.

## Key Decisions Made

| Decision                   | Choice                                                                | Why (1 sentence)                                                                                                              |
| -------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Past-dated visits          | Allowed; hard-reject only outside 1900–2100                           | FR-009's Socratic note puts the passed-visit case in FR-011's hands, and forbidding the past would make a past visit uneditable |
| Unusual-date feedback      | Inline, non-blocking note; far future = more than 2 years             | A mistyped year is self-evident once named, and a deliberate historical entry should not hit a modal every time                |
| Duplicate visits           | Allowed; client-side confirm dialog only, no constraint               | A `unique` constraint means a migration, which would diverge the shared local stack from the S-02 worktree mid-session         |
| List organisation          | Upcoming ascending, then Past descending                              | "Which visit is next" is the question the app exists to answer, and it must stay the top row as history accumulates            |
| Specialist control         | Native `<select>` in a new `src/components/form/SelectField.tsx`      | The OS picker is the right control on a phone, and nothing new lands in `src/components/ui/` to collide with S-02              |
| Source of "today"          | `user_metadata.timezone`, UTC fallback, resolved once server-side     | One `today` threaded from page to island means the grouping and the date hint can never disagree about the same row            |
| Specialist name resolution | Client-side `Map`, no PostgREST embed                                 | `ON DELETE RESTRICT` guarantees every visit's specialist is in the list the page already fetches — exact, not a heuristic       |
| Tests                      | None authored; contract queued in `follow-ups/`                       | Holds S-01's standing 2026-08-26 decision rather than silently reopening it                                                    |

## Scope

**In scope:** validation schema · `src/lib/dates.ts` · `src/lib/db/visits.ts` · `GET`/`POST /api/visits` and `PATCH`/`DELETE /api/visits/:id` · `SelectField` · `VisitsManager` island · `/visits` page · topbar link and route protection · a follow-up test contract.

**Out of scope:** any migration or constraint · automated tests · the dashboard, next-visit calculation, and "no visit scheduled" state (all S-04) · changes to `/specialists` or any auth file · new `src/components/ui/` primitives · visit notes, outcomes, or attachments.

## Architecture / Approach

A straight transcription of S-01's vertical slice, minus what visits doesn't need and plus what it does.

```
visits.astro ──► listVisits + listSpecialists + resolveToday(user_metadata.timezone)
      │
      └─► <VisitsManager initialVisits specialists today client:load />
                 │  fetch
                 ▼
        /api/visits[/:id] ──► lib/db/visits.ts ──► PostgREST (RLS)
                 ▲                    ▲
       lib/validation/visit.ts   lib/dates.ts
        (shared with island)      (shared with island)
```

Subtracted: the usage-count embed and the `409` path — nothing references `visits`, so delete has no failure mode. Added: `23503` now means "that specialist is not yours" (the FK is composite on `(specialist_id, user_id)`) and maps to a **400 with a field error**, not the 409 it means in `deleteSpecialist`.

## Phases at a Glance

| Phase                | What it delivers                                                    | Key risk                                                                                                     |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1. Data layer        | Validation, date helper, module, both routes — no UI                | The `updated_at` and zero-rows-as-404 rules ship with manual verification as their only guard                 |
| 2. Visits screen     | `SelectField`, island, page, nav wiring                             | Date handling is where an off-by-one-day bug hides; the whole slice compares `YYYY-MM-DD` strings, never `Date`s |
| Close-out            | Test contract, `CLAUDE.md` conventions, `change.md` epilogue        | —                                                                                                            |

**Prerequisites:** F-01 and S-01 both done (they are). A running local Supabase stack, **shared with the S-02 worktree** — this slice must not run `db:reset` or `db:types`, both of which would damage that session or this branch's committed types.
**Estimated effort:** ~2 sessions, one per phase, with a manual gate at each boundary.

## Open Risks & Assumptions

- **Nothing prevents a duplicate visit.** The confirm dialog is a courtesy; a duplicate posted straight to the API is accepted. Harmless to S-04, whose next-visit is a minimum over future dates — but it is not an invariant and must not be read as one.
- **Timezone comes from `user_metadata`, which is user-writable** via `auth.updateUser({ data })`. The reader treats it as hostile input and falls back to UTC, so a tampered zone degrades the grouping rather than throwing `RangeError` on the page.
- **Users who signed up with JavaScript disabled have no stored zone** and get UTC. Their visit dated today can sit in the wrong group for part of the day.
- **The clock-skew gap S-01 accepted applies here unchanged** — `updated_at` is stamped from the runtime clock while `created_at` comes from Postgres, so an edit inside the skew window can trip the CHECK and surface as a 500.
- **This slice takes a small piece of S-04's stated scope** (`signup.ts:40` assigns the timezone fallback there). Recorded deliberately; S-04 inherits the helper rather than writing it.

## Success Criteria (Summary)

- A user can add, edit, and delete a doctor visit, and the list always shows the next one first.
- A visit dated in the past is stored without complaint but is visibly separated from what is still upcoming.
- Nothing in `supabase/migrations/` or `src/db/database.types.ts` changes, so the parallel S-02 session is unaffected.
