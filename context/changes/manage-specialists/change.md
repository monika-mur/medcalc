---
change_id: manage-specialists
title: Manage specialists — add, list, edit, and delete the specialists a user tracks
status: plan_reviewed
created: 2026-08-20
updated: 2026-08-21
archived_at: null
---

## Notes

from @context/foundation/roadmap.md

Roadmap item **S-01** (slice, prerequisites `F-01`) — GitHub [#2](https://github.com/monika-mur/medcalc/issues/2).

- **Outcome:** user can add a specialist (name, specialty), see the list they track, edit an entry, and delete one that has no medications or visits assigned.
- **PRD refs:** FR-003. The Socratic note there is load-bearing — a managed entity exists precisely because "inconsistent spelling of specialist names breaks the core calculation."
- **Unlocks:** S-02 (medications) and S-03 (visits) both require an existing specialist to assign to.
- **Baseline:** the `specialists` table, its constraints, and all four RLS policies already exist from F-01 (`supabase/migrations/20260813185255_domain_schema.sql:35-48`, `:265-273`). No domain-facing route, page, or component exists anywhere in `src/` yet — this slice creates the first.

### Why this slice is larger than its outcome suggests

It is the first domain-facing vertical slice, so it sets patterns S-02, S-03, and S-04 inherit: the per-entity data module, the JSON API error contract, the validation approach, and the SSR-then-hydrate list shape. F-01 deliberately refused to design a data-access layer before a consumer existed — this is that consumer.

Two pieces of tracked debt are paid here rather than deferred again:

- **`updated_at`** — F-01's plan review deferred the maintainer decision explicitly to S-01, and the implementation review (F8) added that the column is also client-writable. The two halves are settled in **different phases**, which plan review corrected: Phase 1's `check (updated_at >= created_at)` blocks backdating, but only Phase 3's rule that the data module constructs its update payload explicitly — never spreading a request body — closes forward-dating by a client. There is no database-level fix for the second half, since revoking column UPDATE would block the module's own write and a trigger is ruled out by the no-procedural-code property.
- **Review finding F4** — the `(select auth.uid())` policy rewrite and the missing `user_id` indexes ride along in this slice's migration rather than needing their own change.

F3 (account erasure under GDPR Art. 17) stays queued in `domain-schema-foundation/follow-ups/review-fixes.md` — it needs a local-stack rehearsal and it interacts with the delete guard chosen here.

### Scope added during planning

The user chose to install shadcn primitives **and restyle the existing screens** to match, so the app carries one visual system rather than two. That is beyond the roadmap outcome and is recorded here as a deliberate addition, not drift. It is sequenced before the new screens so those are built on final primitives.

Scope widened twice on 2026-08-21, both times by explicit decision:

- **A design direction was set** — clinical white/slate surfaces with green as a rationed accent (green-700 for text and fills, green-600 for rings, red-600 for destructive), expressed as `:root` design tokens in `src/styles/global.css` rather than per-component classes. AA contrast is a stated requirement, not an aspiration.
- **The restyle became app-wide rather than auth-only.** Dropping the dark cosmic/glassmorphism theme touches every existing screen, because leaving one dark is what shipping two designs means. Phase 2 therefore also repaints `dashboard.astro` (visually only — S-04 still owns building it), replaces the starter `Welcome.astro` landing with a minimal MedCalc one, and deletes `ui/LibBadge.astro`.

### Plan

`plan.md` (full) and `plan-brief.md` (two-pager) written 2026-08-20 across four phases.

### Review

`reviews/plan-review.md` — 2026-08-21, verdict REVISE → SOUND after triage. 0 critical, 6 warnings, 2 observations; 7 fixed, 1 dismissed (F6, subsumed by F7's replacement of the starter landing). All dimensions PASS.
