---
change_id: manage-specialists
title: Manage specialists — add, list, edit, and delete the specialists a user tracks
status: implementing
created: 2026-08-20
updated: 2026-08-25
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

| Checked    | Result                                                                                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-25 | **10 rows, not 5.** `authenticated` complete on all five tables (the load-bearing half — the migration is a no-op for it). `anon` **also** holds all four DML privileges on all five tables, inherited from the older platform default. Local returns 5. |

**Interpretation.** Not tampering — the old Supabase default granted DML to `anon` _and_ `authenticated`, which is what this migration's header and `lessons.md` already describe; cloud was created under it. Not a breach either: reproduced locally by granting `anon` the same privileges, and RLS holds on its own — as `anon`, SELECT returns 0 rows against a populated table, INSERT raises `new row violates row-level security policy`, DELETE reports 0. Every policy is `to authenticated` and `anon` matches none.

It is still a defence-in-depth gap: production is protected by one mechanism where the design intends two, and the anon key ships in the client bundle. Disabling RLS on one table in a later migration, or writing one policy `to public`, would make it full DML from the internet with nothing behind it.

**Resolved by amending the migration** rather than deferring: `GRANT` alone would leave cloud at 10 rows and local at 5 permanently, making the `anon` assertions true locally and false in production — the exact drift this migration exists to end. `20260821182457` now issues an explicit `revoke … from anon` on all five tables (a no-op locally, converging cloud on push), and the pgTAP `anon` assertion was extended from `specialists` alone to all five tables — a single-table assertion would have gone green while four tables stayed exposed. pgTAP 66 → **70**. Editing the already-committed migration is safe: only local had applied it, and `db:reset` re-applies from scratch.

## Session state — 2026-08-21 (paused mid Phase 1)

**Where things stand:** Phase 1 is **closed** as of 2026-08-25. All nine rows are ticked. `status` stays `implementing` because Phases 2–4 remain.

### Resume with

```
/10x-implement manage-specialists phase 2
```

### Automated (1.1–1.5)

| Step | Result                                                                |
| ---- | --------------------------------------------------------------------- |
| 1.1  | `npm run db:reset` applies both migrations from scratch               |
| 1.2  | pgTAP **70/70** — the prior 57 plus 3 CHECK and 10 grant assertions   |
| 1.3  | Grants survive a from-scratch reset with no manual `GRANT` in between |
| 1.4  | Generated types byte-identical to the committed file                  |
| 1.5  | `npm run lint` exits 0                                                |

Independent spot-checks beyond the criteria: 16/16 policies carry the wrapped predicate, **19 `auth.uid()` occurrences, 19 wrapped, 0 bare** (matching the count corrected during plan review — the plan originally said 23), both new indexes present, all three CHECK constraints present, `anon` holds no DML on any table.

### Manual (1.6–1.9) — confirmed 2026-08-25

| Step | Result                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.6  | `23514` raised on all three tables, each naming its own `<table>_updated_at_not_before_created_at` constraint                                                                      |
| 1.7  | Local: exactly 5 rows, all `authenticated`, all four privileges. No `anon` row                                                                                                     |
| 1.8  | Cloud: **10 rows** — `authenticated` complete, `anon` also granted. Investigated, found benign in cause and non-exploitable, and closed by amending the migration. See table above |
| 1.9  | `20260813185255` present on both Local and Remote; `20260821182457` Local-only with an empty Remote column, as required                                                            |

1.9 also confirms cloud carries F-01's domain schema — which is why the `anon` grants found in 1.8 exist there at all.

Note on 1.6: the verification SQL first handed over used a `DO $$ … $$` block, which Studio's SQL editor breaks by splitting on `;`. Replaced with plain per-table statements and recorded in `lessons.md` → _Hand Studio plain SQL statements, never dollar-quoted blocks_.

### Deviation from the plan, already applied

The grant assertions in `rls.test.sql` use a filtered `information_schema.role_table_grants` query rather than pgTAP's `table_privs_are`, which the plan first specified. `table_privs_are` asserts the **exact** privilege set and fails on the inherited `REFERENCES`/`TRIGGER`/`TRUNCATE`; listing all seven to satisfy it would hard-code the platform default this phase exists to stop depending on. Approved during implementation, and `plan.md` Phase 1 §2 has been rewritten to match.

### Resolved 2026-08-25 — `npm run db:types` was destructive on failure

The script is `supabase gen types typescript --local > src/db/database.types.ts`. The shell truncates the target **before** the command runs, so any failure leaves a committed file gutted. It happened this session: the CLI hiccuped transiently right after the container restart, `database.types.ts` lost 382 lines, and lint went to 26 errors. Restored with `git checkout`, then re-verified by generating to a temp file and diffing — byte-identical, so 1.4 is genuinely met.

Phases 2–4 each run this script again, so both open items were actioned on 2026-08-25, outside the plan and at the user's request:

1. **Script replaced.** `db:types` now runs `scripts/gen-db-types.mjs`, which buffers the CLI's stdout, checks exit code / size / a sentinel string, and writes the target only when all three pass. `eslint.config.js` gained a `scripts/**` block with Node globals and type-checked rules off — `.mjs` does not land in the typed project, so those rules only produced `any` noise.
2. **Lesson recorded** in `context/foundation/lessons.md` → _Never redirect a generator's stdout straight onto a committed file_.

Verified against the real CLI once the stack came up: `npm run db:types` reports `no change` and leaves `git status` clean, so criterion 1.4 holds. Failure paths verified by stand-in — a non-zero exit and a zero-byte output each refuse and leave the file intact. The sentinel guard (large but bogus output) is unexercised; a permission denial cut that test short.

**Line endings are the subtlety here.** The CLI emits LF; `core.autocrlf=true` checks this file out as CRLF. A verbatim byte-for-byte write therefore rewrote every line ending and left `git status` reporting a modified file with identical content — the exact signal criterion 1.4 asks a human to read, inverted. The script now matches whatever the file on disk already uses, so "regenerating leaves no diff" is literally true in the working tree rather than only true after normalisation.

This is out-of-plan work. It touches no phase deliverable and is committed separately from Phase 1.
