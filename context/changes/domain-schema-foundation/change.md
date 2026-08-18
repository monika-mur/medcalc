---
change_id: domain-schema-foundation
title: Domain schema for specialists, medications, dosage-change history, and visits
status: implemented
created: 2026-08-10
updated: 2026-08-18
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

## Implementation status

**All five phases are implemented.** Phases 1–4 were verified and committed on 2026-08-16; Phase 5 pushed the migration to Supabase Cloud on 2026-08-18 — see "Phase 5 — applied to Supabase Cloud" at the end of this file.

The run paused between Phase 4 and Phase 5 for two interactive credentials only the author could supply. That pause is over; the "Resuming Phase 5" section below is retained as a record of what unblocked it.

### Where the run stands

| Phase                               | State                                                      |
| ----------------------------------- | ---------------------------------------------------------- |
| 1 — Domain schema migration         | Automated 1.1–1.9 ✅ · Manual 1.10–1.11 ✅ · `cc2cdaa`     |
| 2 — pgTAP database tests            | Automated 2.1–2.3 ✅ · Manual 2.4–2.5 ✅ · `1322caa`       |
| 3 — Typed client + timezone capture | Automated 3.1–3.4 ✅ · Manual 3.5–3.7 ✅ · `85039ad`       |
| 4 — Vitest suite + docs             | Automated 4.1–4.3 ✅ · Manual 4.4–4.5 ✅ · `af117c3`       |
| 5 — Push to Supabase Cloud          | Automated 5.1–5.3 ✅ · Manual 5.4–5.7 — applied 2026-08-18 |

`plan.md` → `## Progress` is the canonical checkbox state and is up to date; every Phase 1–4 row carries its phase's SHA.

Suite totals at the pause: **pgTAP 57 assertions across 4 files** (`npm run db:test`), **Vitest 15 tests in 1 file** (`npm test`). Both green against a clean `npm run db:reset`.

### Resuming Phase 5 — the two blocking steps

Neither can be run non-interactively, which is why the run stopped here rather than mid-push. Run both yourself first, then re-enter the phase:

1. **Authenticate the CLI** — opens a browser, or accepts a personal access token pasted from the Supabase dashboard:

   ```
   NODE_TLS_REJECT_UNAUTHORIZED=0 npx supabase login
   ```

   Verified absent at the pause: no `SUPABASE_ACCESS_TOKEN` in the environment and no `~/.supabase/access-token` (only `telemetry.json`).

2. **Link to the cloud project** — prompts for the **database password** set at project creation (`deploy-plan.md` → Krok 0, step 2). That password is what `db push` connects with; it is not the anon key and is not in the repo.

   ```
   NODE_TLS_REJECT_UNAUTHORIZED=0 npx supabase link --project-ref nkqbiphgoemmehflgogz
   ```

   **Confirm the ref before running.** `nkqbiphgoemmehflgogz` was read off `SUPABASE_URL` in `.env.example`, which is the same file flagged below as holding real cloud values — it has not been cross-checked against the dashboard.

   `supabase/.temp/` held only `cli-latest` at the pause, so the project is not currently linked.

After both succeed, `npx supabase migration list` (read-only) is the next command — it should show the remote with **no migrations and no drift**, which is criterion 5.1. Only then `npx supabase db push`.

### What Phase 5 will apply

One migration, `20260813185255_domain_schema.sql`, **including the `supply_events` CHECK correction made during Phase 4** (see "Phase 4 deviations" below). The cloud project has never received this migration, so it lands in its corrected form directly — there is no intermediate state to reconcile and no follow-up migration to sequence.

The migration creates objects and writes no rows, and touches nothing under `auth`, so the account already registered against the cloud project is unaffected.

### Environment left behind (read before resuming)

- **`.env` and `.dev.vars` point at the LOCAL stack**, not the cloud project. Switched deliberately for the Phase 3 manual checks so test signups would not land in production `medcalc`, and left that way because Phase 4's Vitest suite wants exactly this. The original cloud values are backed up **outside the repo** at `%TEMP%\medcalc-env-backup\` (`C:\Users\<user>\AppData\Local\Temp\medcalc-env-backup\`); they are also recoverable from the committed `.env.example`.
  - **The push itself does not need them** — the CLI uses its own linked connection, not `.env`.
  - **Criteria 5.5 / 5.6 do**, since they check the deployed app.
  - **Restoring them makes `npm test` fail fast by design** — the Phase 4 helper refuses a non-local `SUPABASE_URL`. That is the guardrail working, not a regression; switch back to local values to run the suite again.
- **Docker Desktop and the local Supabase stack must be restarted after a reboot** — see "Environment prerequisites" below. Docker was not running at the start of the Phase 4 session either.
- **Throwaway accounts exist in the LOCAL database only** — seven from Phase 3 signup verification, plus two per `npm test` run (`alice-…@medcalc.test`, `bob-…@medcalc.test`, unique per run so repeat runs never collide). `npm run db:reset` clears them all; nothing has reached the cloud project.

### Phase 3 deviations

1. **The timezone write is a submit-time `is:inline` script, not a mount-time effect.** The plan's approach is observably broken; full diagnosis in `plan.md` §3 under "Amended again". Two prior attempts (`setState` in an effect, then a ref write in an effect) both failed — the first trips `react-hooks/set-state-in-effect`, the second is silently reset by the re-render `validate()` triggers mid-submit.
2. **`plan.md` §3 amended twice** — the `"UTC"`-vs-empty server-render default, then the write mechanism.
3. **`src/db/database.types.ts` excluded from ESLint** (`eslint.config.js`). It arrived with 236 prettier errors; `--fix` would be undone by the next `db:types` and would break criterion 3.1.
4. **`supabase/snippets/` deleted** — a Studio SQL-editor scratch file, unrelated to the change. Studio recreates the directory on next use; consider a `.gitignore` entry.

The Phase 1 commit bundles the whole `.claude/` toolkit, `context/foundation/roadmap*.md`, and five pre-existing dirty files alongside the phase's own set — included deliberately at the author's request when the dirty-path gate ran, and enumerated in the commit body.

**Open follow-up, not blocking:** `.env.example` holds the real cloud project URL and a **legacy JWT anon key** (it previously held an `sb_publishable_…` key — the uncommitted edit regressed it). Both values are now in history on a public remote. Exposure is bounded because every RLS policy targets `authenticated`, so `anon` reads nothing once Phase 5 lands — criterion 5.6 is the check for that. Replacing both with placeholders deserves its own commit.

### Resume with

```
/10x-implement domain-schema-foundation phase 5
```

It will pick up at **5.1** — `migration list` for the drift check, then `db push`, then recording the applied-migration details in `## Notes`. **Run the two blocking steps above first** (`supabase login`, `supabase link`); without them the phase stops at the same place it stopped this time.

Phase 5 does not need the local stack running. It is the only phase in the plan that mutates production.

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

### Phase 4 deviations (2026-08-16)

1. **The `supply_events` presence CHECK was defective and was fixed in the original migration, in place.** The integration suite's "a non-recount row carrying `counted_quantity` is rejected" assertion (plan Phase 2 §3) failed: an `adjustment` carrying only `counted_quantity` was **accepted**.

   ```sql
   check ((event_type = 'recount') = (counted_quantity is not null and projected_quantity is not null))
   ```

   For a non-recount carrying **one** stray field, LHS is `false` and RHS is `false`, so the CHECK passes — it only rejects a non-recount carrying **both**. This is the identical defect shape as Phase 1 deviation 2 (the liquid CHECK); that one was rewritten as a `CASE` at the time, this one was not, and **Phase 2's pgTAP only ever asserted the both-fields case** (`supply_ledger.test.sql:89-95`), so it passed.

   Fixed with a `CASE` mirroring the liquid constraint. Two pgTAP assertions added for the one-field cases in each direction; plan count 12 → 14, suite total 55 → 57. Amending the migration rather than adding a follow-up was chosen at the author's decision when the mismatch gate ran — **the migration had not been pushed to any remote** (Phase 5 had not run), so it exists only locally and the schema's first state stays one reviewable file. **Phase 5 is now the first application of the corrected constraint.**

   Worth carrying forward: the boolean-equality form of a presence constraint is wrong in exactly this way every time. Both occurrences were caught by a test asserting the _partially_-populated case, and neither by one asserting the fully-populated case.

2. **The test client helper refuses a non-local `SUPABASE_URL`** (`tests/integration/helpers/client.ts`) — not in the plan's contract. The suite signs up users and writes rows; run against cloud credentials it would create junk accounts in production `medcalc`. Relevant because Phase 5 restores the cloud values into `.env`, after which `npm test` fails fast instead of polluting production.
3. **`CLAUDE.md` → `## Supabase` also updated.** Its "No migrations exist yet" line was stale in the same way as the Vitest line the plan asked to remove; it now describes `supabase/migrations/`, `db:reset`, and `db:types`.
4. **Vitest 4.1.10** installed (`vite ^7.3.2` override already present). Config loads `.env` via Vite's `loadEnv` with an empty prefix, since `SUPABASE_URL` / `SUPABASE_KEY` carry no `VITE_` prefix.

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

### Phase 5 — applied to Supabase Cloud (2026-08-18)

| Field        | Value                                                  |
| ------------ | ------------------------------------------------------ |
| Migration    | `supabase/migrations/20260813185255_domain_schema.sql` |
| Date applied | 2026-08-18                                             |
| Project ref  | `nkqbiphgoemmehflgogz`                                 |
| Project name | `medcalc`                                              |
| Org ID       | `xxestqjycsqjoptdaoyg`                                 |
| Region       | Central EU (Frankfurt)                                 |
| CLI version  | supabase 2.98.2                                        |

**The project ref is now cross-checked.** The pause note flagged `nkqbiphgoemmehflgogz` as read off `.env.example` and never verified. `supabase projects list` confirms it is project `medcalc`, and it is the only project on the account — so the ref was correct and the warning is discharged.

**What was applied.** One migration, in the corrected form carrying the Phase 4 `supply_events` CASE fix. The remote had no migrations and no drift beforehand (`migration list` showed an empty Remote column), so there was no intermediate state to reconcile; afterwards Local and Remote both read `20260813185255`.

**Pre-push state, git-verified.** The working tree was clean and `supabase/migrations/` was unchanged since `af117c3`, the Phase 4 commit — so the bytes pushed are exactly the bytes that passed 57 pgTAP assertions and 15 Vitest tests. The local suite was **not** re-run before the push (Docker was down); this was an explicit author decision on the grounds that re-running re-tests an artifact git proves identical.

**Credentials used, and the follow-up they created.** `supabase login --token` was used because the browser flow refuses a non-TTY shell. **That personal access token was pasted into the session transcript and the shell history, and should be revoked** at Account Settings → Access Tokens. The database password was supplied interactively to `supabase link` and does not appear in the repo or the transcript.

**Environment unchanged by this phase.** `.env` and `.dev.vars` still point at the LOCAL stack. The push used the CLI's own linked connection, not `.env`. Criteria 5.5 and 5.6 exercise the **deployed** app, so they need no local env change either — but restoring the cloud values for any local dev work will make `npm test` fail fast by design (the Phase 4 helper refuses a non-local `SUPABASE_URL`).
