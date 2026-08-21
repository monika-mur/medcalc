---
change_id: manage-specialists
title: Manage specialists — add, list, edit, and delete the specialists a user tracks
status: implementing
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

### Post-review: the schema was missing every GRANT

Found 2026-08-21, after the review, while updating the Supabase CLI from 2.98.2 to 2.115.0 ahead of implementation. The bundled Postgres image ships a restricted default ACL for the `postgres` role in `public` (`authenticated=Dxtm` — no SELECT/INSERT/UPDATE/DELETE). Because `20260813185255_domain_schema.sql` issues no `GRANT` at all and the tables are owned by `postgres`, a from-scratch local reset left every domain table unreachable to `authenticated`. pgTAP went 57/57 → 14/57.

This is a latent F-01 defect, not a CLI regression — the schema had always depended on an implicit platform default. The upgrade surfaced it before S-01 built a data module, four routes, and an integration suite on top.

Resolved by adding uniform `GRANT`s to Phase 1's migration, verified at 57/57 against a live stack. The stronger per-table mirrored set was also measured (44/57 — it breaks `append_only.test.sql`, whose header explicitly documents the zero-rows semantics it depends on) and is queued as **S-05** in `domain-schema-foundation/follow-ups/review-fixes.md`.

**Open:** cloud is expected to still carry the old permissive grants and therefore still work. Unverified as of 2026-08-21. Phase 1 manual step 1.8 now performs that check as read-only reconnaissance and records the result here — the query and how to read each outcome are in `plan.md` → _Verifying cloud_.

| Checked | Result                     |
| ------- | -------------------------- |
| —       | pending (Phase 1 step 1.8) |

## Session state — 2026-08-21 (paused mid Phase 1)

**Where things stand:** Phase 1 code is written and all five automated criteria pass. The phase is **not closed** — its four manual checks are unconfirmed, so `status` stays `implementing` and rows 1.6–1.9 stay unticked.

### Resume with

```
/10x-implement manage-specialists phase 1
```

That lands on step 1.6, the first unticked row.

### Done and verified (1.1–1.5)

| Step | Result                                                                |
| ---- | --------------------------------------------------------------------- |
| 1.1  | `npm run db:reset` applies both migrations from scratch               |
| 1.2  | pgTAP **66/66** — the prior 57 plus 3 CHECK and 6 grant assertions    |
| 1.3  | Grants survive a from-scratch reset with no manual `GRANT` in between |
| 1.4  | Generated types byte-identical to the committed file                  |
| 1.5  | `npm run lint` exits 0                                                |

Independent spot-checks beyond the criteria: 16/16 policies carry the wrapped predicate, **19 `auth.uid()` occurrences, 19 wrapped, 0 bare** (matching the count corrected during plan review — the plan originally said 23), both new indexes present, all three CHECK constraints present, `anon` holds no DML on any table.

### Pending — manual, needs a human

- **1.6** In Studio, an UPDATE setting `updated_at` before `created_at` is rejected on `specialists`, `medications`, `visits`
- **1.7** `authenticated` holds all four DML privileges on all five tables and `anon` holds none. Local evidence already produced and green; re-confirm if you want to see it yourself
- **1.8** The same query against **cloud** returns five complete rows — see `plan.md` → _Verifying cloud_ for the query and how to read each outcome
- **1.9** `npx supabase migration list` shows the new migration as local-only. **Blocked:** the CLI returns `401 Unauthorized` because the access token was revoked during the F-01 impl-review triage (finding F1). Run `npx supabase login` first, with `$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"` set as its own statement

Because 1.6–1.9 are unconfirmed, the phase-end commit ritual has **not** run: rows 1.1–1.5 carry no commit SHA yet. Re-entering the phase and confirming the manual steps will close it normally.

### Deviation from the plan, already applied

The grant assertions in `rls.test.sql` use a filtered `information_schema.role_table_grants` query rather than pgTAP's `table_privs_are`, which the plan first specified. `table_privs_are` asserts the **exact** privilege set and fails on the inherited `REFERENCES`/`TRIGGER`/`TRUNCATE`; listing all seven to satisfy it would hard-code the platform default this phase exists to stop depending on. Approved during implementation, and `plan.md` Phase 1 §2 has been rewritten to match.

### Open decision — `npm run db:types` is destructive on failure

The script is `supabase gen types typescript --local > src/db/database.types.ts`. The shell truncates the target **before** the command runs, so any failure leaves a committed file gutted. It happened this session: the CLI hiccuped transiently right after the container restart, `database.types.ts` lost 382 lines, and lint went to 26 errors. Restored with `git checkout`, then re-verified by generating to a temp file and diffing — byte-identical, so 1.4 is genuinely met.

Phases 2–4 each run this script again. Two things to decide next session:

1. Change the script to generate to a temp file and move on success only.
2. Record it via `/10x-lesson` — a build script that destroys a committed file when its command fails is a class of trap, not a one-off.

Neither was actioned; both are deliberately left open rather than folded into Phase 1 unasked.
