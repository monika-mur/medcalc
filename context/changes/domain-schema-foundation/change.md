---
change_id: domain-schema-foundation
title: Domain schema for specialists, medications, dosage-change history, and visits
status: implementing
created: 2026-08-10
updated: 2026-08-14
archived_at: null
---

## Notes

from @context/foundation/roadmap.md

Roadmap item **F-01** (foundation, status `ready`, no prerequisites) — GitHub [#1](https://github.com/monika-mur/medcalc/issues/1) + sub-issues #8–#12.

- **Outcome:** database schema and migrations for `specialists`, `medications` (incl. liquid-medication fields), `dosage_changes` (history), and `visits` — designed so every state change is append-only and reconstructible from day one.
- **PRD refs:** Business Logic — "Historical data preservation (binding architectural constraint)"; underlies FR-003, FR-004, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011.
- **Unlocks:** S-01 … S-06 — every domain-facing slice reads or writes this schema.
- **Risk (from roadmap):** getting the immutable/timestamped record shape right once avoids a retrofit after slices start writing data in a mutable shape, which would threaten the PRD's "calculation accuracy" guardrail.
- **Baseline:** Supabase client wired (`src/lib/supabase.ts`); `supabase/migrations/` does not exist yet — this change creates the first migration.

### Plan amendment — 2026-08-11 (pre-implementation)

`plan.md` and `plan-brief.md` were amended before any code was written, replacing all three database triggers with declarative constraints. Seven tables became five.

- Recount `BEFORE INSERT` trigger → the CHECK constraint the plan already specified; the application now supplies `quantity_delta` alongside the counts.
- Deferred liquid 1:1 constraint trigger → `liquid_medication_details` folded into `medications` as nullable columns with a presence CHECK, making creation a single atomic insert.
- `auth.users` → `profiles` trigger → `profiles` dropped; `timezone` lives in `auth.users.raw_user_meta_data`. (A `getUserTimezone()` reader was specified in Phase 3 and later **cut** during plan review — it had no caller in this change. The fallback is S-04's to write; see `plan.md` → "The fallback has no owner in this change".) This also removes the Phase 5 backfill against live auth data.

Rationale in full: `plan.md` → "Decided: no procedural database code". Prompted by the observation that Supabase is server-only here (`astro.config.mjs:19-20`), so application code is in the path of every write — but note the substitutions are constraint-enforced, not app-enforced.

### Plan review — 2026-08-13

`/10x-plan-review` ran against the amended plan: 8 findings, verdict REVISE → SOUND after triage. Full report and per-finding decisions: `reviews/plan-review.md`. Seven fixed in the plan, one deferred (`updated_at` has no maintainer — **S-01 owns that call**).

---

## Implementation status — Phases 1–2 complete 2026-08-14

**Phases 1 and 2 are fully verified and committed**, as `cc2cdaa` and `1322caa`.

### Where the run stands

| Phase                               | State                                                  |
| ----------------------------------- | ------------------------------------------------------ |
| 1 — Domain schema migration         | Automated 1.1–1.9 ✅ · Manual 1.10–1.11 ✅ · `cc2cdaa` |
| 2 — pgTAP database tests            | Automated 2.1–2.3 ✅ · Manual 2.4–2.5 ✅ · `1322caa`   |
| 3 — Typed client + timezone capture | in progress                                            |
| 4 — Vitest suite + docs             | not started                                            |
| 5 — Push to Supabase Cloud          | not started                                            |

`plan.md` → `## Progress` is the canonical checkbox state and is up to date; all eleven Phase 1 rows carry `cc2cdaa` and all five Phase 2 rows carry `1322caa`.

The Phase 1 commit bundles the whole `.claude/` toolkit, `context/foundation/roadmap*.md`, and five pre-existing dirty files alongside the phase's own set — included deliberately at the author's request when the dirty-path gate ran, and enumerated in the commit body.

**Open follow-up, not blocking:** `.env.example` holds the real cloud project URL and a **legacy JWT anon key** (it previously held an `sb_publishable_…` key — the uncommitted edit regressed it). Both values are now in history on a public remote. Exposure is bounded because every RLS policy targets `authenticated`, so `anon` reads nothing once Phase 5 lands — criterion 5.6 is the check for that. Replacing both with placeholders deserves its own commit.

### Resume with

```
/10x-implement domain-schema-foundation phase 3
```

It will pick up at **3.1** — generated types, the typed Supabase client, and signup timezone capture.

### Environment prerequisites (must be re-done after any reboot)

1. **Start Docker Desktop** — it was not running at the start of this session. Wait for `docker info` to answer.
2. `NODE_TLS_REJECT_UNAUTHORIZED=0 npx supabase start` — the env var matters behind the corporate proxy.
3. Local endpoints: API `http://127.0.0.1:54321` · DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres` · Studio `http://127.0.0.1:54323` · publishable key `sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH`.

### Deviations from the plan made during Phase 1

Four, each agreed at the time. Only deviation 2 is recorded in `plan.md` itself — implementation may normally edit only `## Progress`, and that amendment was made under explicit authorization because the plan's SQL was defective rather than merely superseded.

1. **`[edge_runtime] enabled = false`** in `supabase/config.toml` (beyond the planned `project_id` edit). The edge-runtime container fetches `https://deno.land/std/...` at boot and dies on `invalid peer certificate: UnknownIssuer` behind the corporate TLS-intercepting proxy, which aborted `supabase start` for the **whole stack**. This project ships no Edge Functions (no `supabase/functions/`, no `functions.invoke` callers). This is a _third_ proxy variant beyond the two the plan documents — neither `NODE_TLS_REJECT_UNAUTHORIZED` nor Docker proxy settings reach a Deno process inside a container. Reasoning is comment-documented at the config key.
2. **The liquid CHECK was rewritten as a `CASE`** — this was a **defect in `plan.md`, amended 2026-08-14**. The expression the plan specified verbatim (§4, around `plan.md:162-164`) did not do what the surrounding prose said it did:

   ```sql
   check ((form = 'liquid') = (a is not null and b is not null and c is not null))
   ```

   For a _solid_ carrying one stray liquid field, LHS is `false` and RHS is `false`, so the CHECK **passes**. It only rejects a solid carrying all three. Criterion 1.5 and Phase 2 §4 both say "a solid row carrying **any** of them is rejected". Caught by the 1.5 verification, fixed in the migration with a `CASE` that also absorbs the former `medications_opened_on_liquid_only` constraint. `plan.md` §4 now carries that `CASE` plus a dated note explaining why the boolean-equality form was wrong, so tests written from the plan will assert the behaviour the schema actually has.

3. **`"endOfLine": "auto"` added to `.prettierrc.json`.** `npm run lint` was failing on **925 pre-existing CRLF errors** across ~25 files, none of them touched by this change: `core.autocrlf=true` checks out CRLF, Prettier defaults to `endOfLine: "lf"`. The repo had never linted clean in this working copy. Not deferrable — criteria 3.3 and 4.2 re-run lint and Phase 3 edits a real lint target (`SignUpForm.tsx`).
4. **`src/lib/config-status.ts` debug code reworked.** Pre-existing uncommitted work interpolated `SUPABASE_URL` **and** `SUPABASE_KEY` into a user-facing message; it was the last thing blocking lint (`restrict-plus-operands` on `string | undefined`). Now prints `SUPABASE_URL` only, with `?? "(nie ustawiony)"`. `SUPABASE_KEY` is declared `access: "secret"` in `astro.config.mjs:20` and should not reach the page.

### Empirically settled while implementing

- **Plan-review finding F8 is answered: the missing `supabase/seed.sql` is a WARNING, not an error.** `supabase start` and `db reset` both print `WARN: no files matched pattern: supabase/seed.sql` and exit 0. Neither remedy the plan offered is needed.
- **`DELETE` under RLS with no DELETE policy is not an error** — it matches zero rows and returns success. Phase 2's append-only tests must assert _rows survive_ / `row_count = 0`, not that an exception was raised.

### Empirically settled during Phase 2

- **`supabase test db` leaves no residue, so the plan's pgTAP-pollution worry cannot materialise.** pg_prove invokes psql with `--single-transaction`, so each file's closing `rollback` unwinds its `create extension if not exists pgtap` along with its fixtures. Verified: pgtap reports `ABSENT` immediately after a full run, `public` holds 0 user triggers and 0 non-extension functions, and 0 fixture rows survive. `with schema extensions` is kept anyway as defensive practice — it costs nothing and the assertion in criterion 1.8 keeps its belt as well as its braces.
- **`throws_ok`'s 3-argument form is `(sql, errcode, errmsg)`, not `(sql, errcode, description)`.** Passing a description third makes pgTAP match it against the raised message and fail on a test that is actually behaving correctly. All negative assertions use the 4-argument form with a `null` message: `throws_ok($$…$$, '23514', null, 'description')`.
- **Seeding runs as `postgres`, which owns these tables and therefore bypasses RLS** (they are not `FORCE ROW LEVEL SECURITY`), so fixtures are inserted with explicit `user_id`. Assertions then `set local role authenticated` + `set local request.jwt.claims`, which is the shape PostgREST uses.
- **`auth.users` needs only `id` to seed.** Every other `NOT NULL` column carries a default.

### Files committed in Phase 1 (`cc2cdaa`)

Belonging to this change:

- `supabase/migrations/20260813185255_domain_schema.sql` (new)
- `supabase/config.toml` (project_id + edge_runtime)
- `package.json` (`db:reset`, `db:test`, `db:types` scripts)
- `.prettierrc.json`, `src/lib/config-status.ts` (lint unblock — deviations 3 and 4)
- `context/changes/domain-schema-foundation/` (whole folder)
- `context/foundation/roadmap.md` — F-01 flipped to `in-progress`

Unrelated, pre-existing at session start, folded in at the author's request: `.env.example`, `CLAUDE.md`, `context/deployment/deploy-plan.md`, `src/layouts/Layout.astro`, `src/lib/supabase.ts`, `.claude/{prompts,skills}/**`, `.claude/.10x-cli-manifest.json`, `context/foundation/roadmap-{github,linear}.md`.

59 files, 12,664 insertions. The working tree was clean after the commit.
