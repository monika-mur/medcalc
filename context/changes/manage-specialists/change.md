---
change_id: manage-specialists
title: Manage specialists — add, list, edit, and delete the specialists a user tracks
status: implementing
created: 2026-08-20
updated: 2026-08-26
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

## Phase 2 — approved before entry, 2026-08-25

**The `Welcome.astro` replacement and the `ui/LibBadge.astro` deletion are confirmed.** Flagged at the Phase 1/2 boundary as the one part of Phase 2 that removes rather than repaints, and approved without further review. Proceed as `plan.md` Phase 2 §4 specifies.

Pre-checks the plan asks for, run at approval time:

- **`LibBadge.astro` has no importer anywhere in `src/`.** The file exists (368 bytes) but `Welcome.astro` imports only `Topbar.astro` — every other occurrence of the name is in `context/` prose. So the plan's rationale ("exists only to render dependency-version chips inside `Welcome.astro`") is **stale**: it is already dead code, and deleting it carries no risk at all rather than the small one the plan assumed. The plan-review finding F6, which worried about it colliding with the never-edit-`ui/` rule, is moot for the same reason.
- **`Welcome.astro` has exactly one importer**, `src/pages/index.astro:2`. Keeping the file at its current path means `index.astro` needs no edit, as planned. It is 126 lines (the plan estimated ~110) and carries `bg-cosmic`, cosmic orbs, and `purple-`/`blue-` washes — all of which the Phase 2 `Select-String` gate scans for.

## Session state — 2026-08-25 (paused mid Phase 2)

**Where things stand:** Phase 2 is **implemented and automated-verified**. Rows 2.1–2.4 are ticked; **2.5–2.12 are manual and untested** — the developer is verifying them tomorrow. `status` stays `implementing`.

### Resume with

```
/10x-implement manage-specialists phase 2
```

The resume lands on 2.5, the first unticked row. Nothing needs re-implementing unless manual verification finds a defect.

### Automated (2.1–2.4) — all green

| Step | Result                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------- |
| 2.1  | `npm run lint` — 0 errors, 0 warnings                                                           |
| 2.2  | `npx astro check` — 0 errors, 0 warnings, 5 hints (pre-existing `tseslint.config` deprecations) |
| 2.3  | `npm run build` — complete, server built in 30.7s                                               |
| 2.4  | PowerShell `Select-String` scan — no output                                                     |

Spot-checks beyond the criteria, read out of the built CSS (`dist/client/_astro/Layout.*.css`): `--primary: oklch(52.7% .154 150.069)` (green-700), `--ring: oklch(62.7% .194 149.214)` (green-600), `--background: oklch(98.4% .003 247.858)` (slate-50), and **zero** occurrences of `bg-cosmic`. `LibBadge.astro` deleted with no importer remaining anywhere in `src/`.

### Resolved 2026-08-26 — border contrast, `--input` split from `--border`

**The plan contradicted itself on border contrast.** `plan.md`'s palette table assigns slate-200 to "card edges, input borders, topbar rule"; criterion 2.10 asks for "borders ≥ 3:1". Slate-200 on white is **1.35:1**.

Card edges and the topbar rule are decorative and exempt under WCAG 1.4.11 — only the **input** border is a UI-component boundary that must be identifiable. Phase 2 first implemented the table as written (`--border` and `--input` both slate-200, which is also stock shadcn), so a strict reading of 2.10 failed on inputs.

**Resolved by splitting the two tokens.** `--input` is now slate-400 (`oklch(0.704 0.04 256.788)`, **2.8:1**); `--border` stays slate-200 so cards and the topbar keep their soft edge. The `:root` header comment in `global.css` records why the two differ, so a future slice does not "fix" the divergence by re-unifying them.

Slate-400 rather than slate-500 (4.0:1) is a deliberate trade: 2.8:1 sits just under a literal 3:1, but slate-500 reads as an outline rather than a boundary and pulls the field borders visually ahead of the content they contain. The decorative-border exemption already means 2.10's "borders ≥ 3:1" is not being read literally across the board; this applies the same judgement to the one border where identifiability actually matters. Re-verified after the change: lint 0/0, `astro check` 0/0, build complete, dark-theme scan clean.

### Adaptations applied during implementation

1. **`button.tsx` reverted after the shadcn CLI rewrote it.** `npx shadcn add` pulled the current registry version — unified `radix-ui` import instead of `@radix-ui/react-slot`, extra `xs`/`icon-sm`/`icon-lg` sizes, `shadow-xs` dropped from the default variant. Restored to the committed file, per Phase 2 step 0's rule that nothing in `ui/` is edited. The four **new** primitives do import from `radix-ui`, which is now a dependency alongside the existing `@radix-ui/react-slot`.
2. **`SignUpForm.tsx` changed one class beyond its import path.** Step 3 says "import path only", but the password hint carried `text-blue-100/50` — roughly 1.1:1 on white, i.e. invisible. Changed to `text-muted-foreground`. The hidden `timezone` input is untouched: still present, uncontrolled, `defaultValue=""`.
3. **`Layout.astro`'s default title changed** to `"MedCalc — medication supply tracking"`. Not in step 4's file list, but 2.12 requires the tab title to stop reading "10x Astro Starter" and `/` is the only page that passes no title — fixing it at the default avoids the `index.astro` edit the plan wanted to avoid.
4. **Prettier reformatted the four generated `ui/` files.** `eslint-plugin-prettier` is an error for every path, so the CLI's output (no semicolons, 80 columns) failed `npm run lint` as generated. Formatting only — no class and no token changed.

Additionally, `zod@4.4.3` was installed here rather than in Phase 3, because Phase 2 step 1 owns the dependency install. Nothing imports it yet.

### Trap worth knowing for the 2.4 scan

The plan's `Select-String` command must be run **in a real PowerShell terminal**. Handing it through an intermediate shell mangles the `'components\\ui'` regex down to `'components\ui'`, which PowerShell then reads as a `\u` escape and fails with `Za mało cyfr szesnastkowych` ("not enough hex digits") once per file — twenty errors that look like scan hits but are not. Run it from the file or paste it into PowerShell directly.
