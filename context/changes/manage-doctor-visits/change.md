---
change_id: manage-doctor-visits
title: Manage doctor visits — add, list, edit, and delete a visit (date + specialist)
status: impl_reviewed
created: 2026-08-27
updated: 2026-08-30
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
- **A visit has a date, and dates need a "today".** Grouping and the past-date warning both need one, and they must be the _same_ one.

### Decisions taken during planning

| Decision                   | Choice                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Past-dated visits          | Allowed. Hard-reject only outside 1900–2100                                        |
| Past / far-future feedback | Inline, non-blocking hint under the date field. Far future = more than 2 years out |
| Duplicate visits           | Allowed. Client-side confirm dialog only — no constraint, no migration             |
| List organisation          | Upcoming (ascending) then Past (descending)                                        |
| Specialist control         | Native `<select>` wrapped in a new `src/components/form/SelectField.tsx`           |
| Source of "today"          | `user_metadata.timezone`, UTC fallback, resolved once server-side and passed down  |
| Surface                    | New `/visits` page + Topbar link                                                   |
| Tests                      | None authored — S-01's standing posture held; contract queued in `follow-ups/`     |

Two consequences worth stating plainly, because both were chosen over a stronger alternative:

1. **Nothing prevents a duplicate visit.** The confirm dialog is a UX courtesy; the API accepts a duplicate posted directly. This was chosen over a `unique (user_id, specialist_id, visit_date)` constraint specifically to keep `supabase/migrations/` untouched while S-02 works the same shared local stack — see `lessons.md` → _Reset the database from your own worktree before you use it_. Duplicates are harmless to S-04, whose "next visit" is a minimum over future dates.
2. **This slice ships with no automated coverage**, exactly as S-01 did. The two assertions `manage-specialists/follow-ups/specialists-tests.md` calls _"write these first"_ apply verbatim to visits: a caller-supplied `updated_at` must be ignored, and a foreign or missing row must be not-found rather than silent success. Neither has a database-level fallback. They are held by code review and a manual step, and will regress silently.

### Scope taken from S-04, deliberately

`src/pages/api/auth/signup.ts:40` assigns the timezone-fallback reader to **S-04**. This slice builds it anyway, in `src/lib/dates.ts`, because the Upcoming/Past split and the past-date hint both need a "today" and having two of them — a UTC one on the server and a device-clock one in the browser — would let the grouping and the warning disagree about the same row. S-04 inherits the helper rather than writing it.

### Plan

`plan.md` (full) and `plan-brief.md` (two-pager) written 2026-08-27 across two phases plus close-out.

### Session state — 2026-08-29

Phase 1 landed as `c152215`. Phase 2 landed as `9559c16` (screen, `SelectField`,
the `FormField` aria fix, middleware and topbar one-liners), with its progress
shas recorded in `46115b6`.

`master` was merged in as `0b6b74e`. That merge caught a defect this branch was
carrying: having branched before S-02 flipped its own roadmap row, it would have
reverted S-02 from `planning` to `proposed`. Resolved by hand per
_Parallel-slice coordination_ — S-02's row and status block from master, S-03's
from here. Docs only; nothing under `src/` moved.

**Phase 2 manual verification is partial.** 2.6–2.8 verified in the browser and
ticked; **2.9–2.16 remain open** — the date hints, the duplicate dialog, the
zero-specialists prompt, the today-is-upcoming case, 320 px, keyboard and focus,
AA contrast, and the hint's aria wiring. Close-out 3.1–3.4 is untouched.

Two things the plan did not predict, both worth carrying forward:

- **The S-02 worktree runs its own dev server on 4321**, so `astro dev` here
  binds 4322 instead. `GET localhost:4321/visits` answers 404 — that is S-02's
  build, not a fault in this slice. Check the port before reading a 404 as a bug.
- `resolveToday` returns the same `2026-08-29` for both UTC and Europe/Warsaw
  today, so the current manual walk cannot distinguish the stored-zone path from
  the UTC fallback. A date near midnight, or a deliberately offset zone, is
  needed to exercise that difference.

Next session: finish 2.9–2.16 against `http://localhost:4322/visits`, then
close-out. The delivery merge to `master` stays blocked until S-02 merges first
(_Merge order_); S-02 is at `3a34bdd` with its Phase 3 manual checks and all of
Phase 4 still open.

### Session state — 2026-08-30

**Phase 2 is closed.** Manual checks 2.9–2.16 — the date hints, the duplicate
confirm dialog, the zero-specialists prompt, the today-is-upcoming case, 320 px,
keyboard and focus, AA contrast, and the hint's aria wiring — were all confirmed
in the browser against `9559c16` and ticked in `aacc338`. Close-out 3.1–3.4
follows in the epilogue commit. No code changed this session; every edit is under
`context/` or in `CLAUDE.md`.

A third thing the plan did not predict, and the one that cost the most time:

- **A dead local Supabase stack surfaces as an opaque `internal error;
reference = <id>` on sign-in, with no mention of Supabase, connections, or
  ports.** Docker Desktop was not running, so `signInWithPassword` fetched a dead
  `127.0.0.1:54321`; under `@astrojs/cloudflare` the dev server runs in workerd,
  which swallowed the connection failure and re-emitted it with a fresh reference
  id per attempt. The id matches nothing in the codebase — `grep -rn "reference"
src/` finds no such string — and the accompanying `remote: true` is a
  distraction, since the adapter auto-enables `IMAGES` and `SESSION` KV as remote
  bindings that no application code touches. **Check `docker info` before reading
  this error as an application fault.** Recovery was launching Docker Desktop and
  waiting; the containers restarted themselves and the `supabase_db_medcalc`
  volume survived, so no migrations were re-applied and no `db:reset` claim was
  taken on the stack shared with S-02. The signal that it was fixed: a bad-password
  POST to `/api/auth/signin` answering `302 → /auth/signin?error=Invalid%20login%20credentials`
  instead of the internal error. `supabase_vector_medcalc` stayed in a restart
  loop afterwards — that is the log-shipping container only, and auth, REST and
  the database were all healthy without it.

Also correcting last session's note: **4321 is not reliably S-02's.** It was free
today because that worktree's dev server was not running, so this slice's server
took the default. Read the port off `astro dev`'s own banner rather than assuming
either number.

Nothing else diverged from the plan. `src/db/database.types.ts` and
`supabase/migrations/` are untouched, as the plan requires.

**The delivery merge to `master` stays blocked until S-02 merges first**
(_Merge order_), and this slice still carries the three reconciliation tasks
listed there — re-applying its own `middleware.ts` and `Topbar.astro` one-liners
by hand, swapping S-02's inline UTC `today` for `resolveToday("UTC")`, and
migrating S-02's specialist `<select>` onto `SelectField`. Until task 2 lands,
`CLAUDE.md` → _Dates_ deliberately stops short of claiming `resolveToday` is the
only place a timezone is interpreted; that sentence would be false on arrival.

### Implementation review — 2026-08-30

`/10x-impl-review` run over the full plan. Report at
`reviews/impl-review.md`; verdict **NEEDS ATTENTION** on 0 critical, 3 warning
and 7 observation findings. All 12 planned items verified as implemented; all
eight scope guardrails clean. Every gate re-run at review time: lint 0/0,
typecheck 0/0 (5 pre-existing hints in `eslint.config.js`), 15 integration
tests, 70 pgTAP assertions, build completing, and `src/db/` plus
`supabase/migrations/` byte-identical to `master`.

Correcting the claim two paragraphs above that nothing else diverged from the
plan — **one adaptation was made and not recorded**:

- **A `404` on edit prunes the row** (`VisitsManager.tsx:159-169`). The plan
  described S-01's edit-failure handling, and `SpecialistsManager.handleEdit`
  only sets errors and a notice. This slice additionally drops the row from
  local state and closes the editor, because a `404` on `PATCH` means the row is
  genuinely gone — deleted in another tab — and leaving an editor open over
  something that is not there is a lie of the same kind the null-client guard in
  `visits.astro` exists to prevent. The reasoning was already in a code comment;
  what was missing was this record.

One review finding was fixed during triage:

- **F1 — a client-side validation failure was silent to assistive tech.**
  `handleSubmit` clears the `aria-live` region and then, on a zod rejection,
  only set field errors, so a screen-reader user pressing **Add visit** with no
  specialist chosen heard nothing at all. `focusFirstError` now moves focus to
  the topmost invalid control, whose `aria-describedby` error text is read on
  arrival. `/specialists` carries the same hole and was deliberately left alone
  per _What We're NOT Doing_; it is S-01's to fix.
