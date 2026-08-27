---
change_id: manage-doctor-visits
title: Manage doctor visits — add, list, edit, and delete a visit (date + specialist)
status: plan_reviewed
created: 2026-08-27
updated: 2026-08-27
archived_at: null
---

## Notes

from @context/foundation/roadmap.md

Roadmap item **S-03** (slice, prerequisites `F-01`, `S-01`) — GitHub [#4](https://github.com/monika-mur/medcalc/issues/4).

- **Outcome:** user can add a doctor visit (date, specialist), and edit or delete it.
- **PRD refs:** FR-009, FR-010. FR-009's Socratic note is load-bearing for the date rules chosen here — _"What happens when a visit passes and no new one has been entered?"_ is answered by FR-011 in **S-04**, not by refusing to store the past-dated row.
- **Unlocks:** S-04 (dashboard) needs both medications and visits to compute status against the next visit.
- **Parallel with:** S-02 (medications), running in a sibling worktree against the same local Supabase stack.

### What is already in place

Unlike S-01, this slice **needs no migration**. F-01 and S-01's migration between them already ship every database object visits requires:

- Table, columns, composite FK and indexes — `supabase/migrations/20260813185255_domain_schema.sql:204-239`
- All four RLS policies, full CRUD over own rows — `:305-314`, rewritten to `(select auth.uid())` in `20260821182457:143-151`
- `grant … to authenticated` / `revoke … from anon` — `20260821182457:80,88`
- `visits_updated_at_not_before_created_at` — `20260821182457:102-104`

S-01 also set every pattern this slice inherits: the per-entity data module returning `Result<T>`, `logDbError` before collapsing a Postgres error, the `src/lib/api/json.ts` error contract, the shared zod schema imported by both island and route, `z.uuid()` → 404 for a malformed id segment, `.select()` chained to detect the zero rows RLS returns for a foreign or missing row, and the SSR-then-hydrate page + island shape.

### Where visits differ from specialists

- **Delete is unconditional.** Nothing references `visits`, so there is no `409 still_referenced` path and no usage-count embed. The data module is strictly smaller than `specialists.ts`.
- **A visit carries a foreign key the user picks.** `23503` therefore means something new here — "that specialist is not yours or no longer exists" — and is a **400 with a field error**, not the 409 it maps to in `deleteSpecialist`.
- **A visit has a date, and dates need a "today".** Grouping and the past-date warning both need one, and they must be the *same* one.

### Decisions taken during planning

| Decision                     | Choice                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Past-dated visits            | Allowed. Hard-reject only outside 1900–2100                                        |
| Past / far-future feedback   | Inline, non-blocking hint under the date field. Far future = more than 2 years out |
| Duplicate visits             | Allowed. Client-side confirm dialog only — no constraint, no migration             |
| List organisation            | Upcoming (ascending) then Past (descending)                                        |
| Specialist control           | Native `<select>` wrapped in a new `src/components/form/SelectField.tsx`           |
| Source of "today"            | `user_metadata.timezone`, UTC fallback, resolved once server-side and passed down  |
| Surface                      | New `/visits` page + Topbar link                                                   |
| Tests                        | None authored — S-01's standing posture held; contract queued in `follow-ups/`     |

Two consequences worth stating plainly, because both were chosen over a stronger alternative:

1. **Nothing prevents a duplicate visit.** The confirm dialog is a UX courtesy; the API accepts a duplicate posted directly. This was chosen over a `unique (user_id, specialist_id, visit_date)` constraint specifically to keep `supabase/migrations/` untouched while S-02 works the same shared local stack — see `lessons.md` → _Reset the database from your own worktree before you use it_. Duplicates are harmless to S-04, whose "next visit" is a minimum over future dates.
2. **This slice ships with no automated coverage**, exactly as S-01 did. The two assertions `manage-specialists/follow-ups/specialists-tests.md` calls _"write these first"_ apply verbatim to visits: a caller-supplied `updated_at` must be ignored, and a foreign or missing row must be not-found rather than silent success. Neither has a database-level fallback. They are held by code review and a manual step, and will regress silently.

### Scope taken from S-04, deliberately

`src/pages/api/auth/signup.ts:40` assigns the timezone-fallback reader to **S-04**. This slice builds it anyway, in `src/lib/dates.ts`, because the Upcoming/Past split and the past-date hint both need a "today" and having two of them — a UTC one on the server and a device-clock one in the browser — would let the grouping and the warning disagree about the same row. S-04 inherits the helper rather than writing it.

### Plan

`plan.md` (full) and `plan-brief.md` (two-pager) written 2026-08-27 across two phases plus close-out.
