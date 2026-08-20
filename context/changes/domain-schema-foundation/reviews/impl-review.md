<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Domain Schema Foundation

- **Plan**: `context/changes/domain-schema-foundation/plan.md`
- **Scope**: Full plan — Phases 1–5 of 5 (`cc2cdaa..ddfbc7a`, 22 substantive files)
- **Date**: 2026-08-18
- **Verdict**: REJECTED — one blocking credential item; the schema work itself is sound
- **Findings**: 1 critical, 7 warnings, 2 observations
- **Triage**: complete (2026-08-19 → 2026-08-20) — 6 fixed, 4 queued to `follow-ups/review-fixes.md`, 0 skipped.
- **Post-triage status**: **CLEARED (2026-08-20).** The CRITICAL that produced the `REJECTED` verdict is resolved in full — code fixed _and_ all three credentials rotated, with both old keys verified returning `401`. The verdict line above is preserved as the state at review time; nothing blocks merge now. The four queued items are follow-up work, not merge blockers.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

**On the verdict.** `REJECTED` is triggered mechanically by the one CRITICAL under Safety & Quality. It is not a judgement on the schema: Plan Adherence, Architecture, and Pattern Consistency all pass cleanly, all eleven "What We're NOT Doing" guardrails hold, and the two plan-vs-implementation divergences were both cases of the _plan_ being wrong, caught and corrected with tests. The block is F1 and F1 alone.

## Success criteria re-verification

Re-run this session (Docker was down, so database-dependent criteria could not be re-executed):

| Criterion                                               | Status                                                   |
| ------------------------------------------------------- | -------------------------------------------------------- |
| 1.9 / 3.3 / 4.2 `npm run lint`                          | ✅ re-verified, exit 0                                   |
| 3.2 `astro sync && astro check`                         | ✅ re-verified — 0 errors, 0 warnings, 4 hints           |
| 3.4 / 4.3 `npm run build`                               | ✅ re-verified, exit 0                                   |
| 5.1–5.3 `supabase migration list` / `db push`           | ✅ re-verified — local and remote both `20260813185255`  |
| 1.1–1.8 (local stack, `db reset`, RLS/CHECK assertions) | ⏸ not re-runnable — Docker down; verified at `cc2cdaa`   |
| 2.1–2.3 `npm run db:test`                               | ⏸ not re-runnable; verified at `1322caa` (57 assertions) |
| 3.1 `npm run db:types` no diff                          | ⏸ not re-runnable; verified at `85039ad`                 |
| 4.1 `npm test`                                          | ⏸ not re-runnable; verified at `af117c3` (15 tests)      |

No manual criterion appears rubber-stamped: each of 1.10–1.11, 2.4–2.5, 3.5–3.7, 4.4–4.5, 5.4–5.7 has observable backing in the diff or in this session's evidence.

## Findings

### F1 — Live anon key and project ref committed to a public repo, and CLAUDE.md tells developers to copy the file into `.env`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `.env.example:1-2`
- **Detail**: `SUPABASE_KEY` holds a decodable legacy anon JWT (`ref: nkqbiphgoemmehflgogz`, `role: anon`, `exp` ≈ 2036) for the live `medcalc` project, and `github.com/monika-mur/medcalc` is confirmed `"visibility": "public"`. Two mitigating facts matter for calibration: the project ref and an anon-tier key were **already** committed at `7eac849` (initial setup, before this change), and Phase 5's RLS — every policy scoped to `authenticated` — was verified empirically to return `HTTP 200 []` to anon on all five tables. What _this_ change contributed is a regression in key type (`sb_publishable_…` → long-lived legacy JWT, which is harder to rotate) plus a URL fix that makes the pair directly usable. Residual exposure is not table reads but `/auth/v1/*`: signup spam, password-reset floods, per-IP rate limits (`config.toml:180-194`) that distribute trivially — and any future table added without RLS becomes world-readable. Compounding it, `CLAUDE.md` → _Environment setup_ instructs copying `.env.example` to `.env` and `.dev.vars`, so the default developer experience points `npm run dev` at production. `.env` and `.dev.vars` are correctly gitignored. `change.md:104` already flags this as an open follow-up.
- **Fix ⭐**: Rotate the anon/publishable key in the Supabase dashboard, then replace both values in `.env.example` with local-stack placeholders and amend the CLAUDE.md instruction to "copy, then fill in".
  - Strength: Rotation is the only step that actually revokes the disclosure — the file edit alone leaves the key live in git history. Placeholders also remove the copy-to-prod footgun in one move.
  - Tradeoff: Rotating invalidates the key in the deployed Worker's secrets, so `wrangler secret put SUPABASE_KEY` must follow immediately or the live app breaks.
  - Confidence: HIGH — the exposure is confirmed by `git show HEAD:.env.example` and the GitHub API visibility check.
  - Blind spot: Whether the Supabase personal access token pasted into the Phase 5 session transcript was ever revoked — that is a separate, higher-privilege credential.
- **Decision**: **FIXED and revoked (2026-08-20)** — code fix plus full credential rotation, verified dead. `.env.example` now carries local-stack placeholders and `CLAUDE.md` → _Environment setup_ says "then fill in real values"; the file edit alone revoked nothing, so all three credentials were rotated at the source.

  **Verified dead.** Both old keys return `401` on `/auth/v1/settings` and `/rest/v1/medications` (read-only endpoints, chosen over a `signup` POST so nothing would be created had a key still been live). The legacy anon key previously returned `200 []` on the REST path, so this is a real state change, not a pre-existing rejection. The strings remain in git history at `7eac849` and `cc2cdaa` and are now inert.

  **What was done**: PAT revoked and replaced (Account → Access Tokens), local copy cleared via `supabase logout`; a new publishable key named `medcalc` created alongside the old `default` one — coexistence gave a zero-downtime rotation — and set on the `medcalc` Worker, the `medcalc-preview` Worker, and the GitHub Actions `SUPABASE_KEY` secret; sign-in verified on `https://medcalc.medcalc.workers.dev`; only then the `default` publishable key deleted and the legacy `anon` key disabled.

  **History scan, clean.** `git log --all -S` across `sb_secret_`, `service_role`, `sbp_`, and `SUPABASE_SERVICE` returned zero hits — no secret-tier or service_role credential has ever been committed. Only anon-tier keys were ever exposed, which caps the historical blast radius at auth-endpoint abuse rather than RLS bypass.

  **Calibration note for future reviews.** This finding was scored CRITICAL partly on "live key in a public repo". Publishable keys are designed to be public — Supabase ships them in browser bundles, and RLS is the protection model. The parts that genuinely warranted the severity were the regression to a long-lived legacy JWT, and `CLAUDE.md` pointing developers to copy production credentials into `.env`. Both are fixed. A future anon-tier key in a public repo, with the secret key uncommitted and RLS scoped to `authenticated`, is a WARNING.

  **Scope correction (2026-08-20).** This finding was written around one credential. `git log -- .env.example` returns two commits, and both hold a live anon-tier key:

  | Commit                    | Value                                                                  | Note                                                                                                                                                                                                        |
  | ------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `7eac849` (initial setup) | `sb_publishable_CdILVTNbQwH7AP1ZYFLZeQ_gNqgb6cD`                       | Cited above as mitigating context for calibrating _this change's_ contribution — correct for that purpose, but it is still a live credential and was not carried into the fix. Exposed longer than the JWT. |
  | `cc2cdaa` (this change)   | legacy anon JWT, `ref: nkqbiphgoemmehflgogz`, `role: anon`, exp ≈ 2036 | The regression this finding names.                                                                                                                                                                          |

  Both need revoking. Separately, the **Supabase personal access token** from Phase 5 — listed above as this finding's blind spot — is account-wide management privilege, higher than either key, and is the first thing to revoke.

  **Close-out order** (set the new key everywhere _before_ disabling the old, or the deployed app breaks mid-rotation):
  1. Revoke the PAT (Account → Access Tokens), then `npx supabase logout --yes` to clear `~/.supabase/access-token`, then delete the `supabase login --token …` line from PowerShell history — the value was passed in argv.
  2. Mint a replacement publishable key; set it on **all four** consumers: the `medcalc` Worker secret, the separate `medcalc-preview` Worker secret (`wrangler.jsonc:15-18` — its own store, easy to miss), and the GitHub Actions `SUPABASE_KEY` secret (`ci.yml:23-24`). Local `.env` / `.dev.vars` need no change; they point at the local stack by design.
  3. Confirm the deployed app still signs in, then disable the legacy key pair and revoke the old publishable key.
  4. Verify both old values return `401` from `/auth/v1/signup` — signup spam was the real residual exposure, not table reads, which RLS already returned `200 []` for.

  `src/lib/supabase.ts:6-7` reads `process.env.SUPABASE_KEY` per request, so a `wrangler secret put` takes effect on the already-deployed Worker without a rebuild.

  **Not doing**: history rewriting. Rotation is what revokes these; once step 3 lands the committed strings are inert, and a `filter-repo` pass would rewrite every SHA recorded in `change.md` and `plan.md` for no additional security.

### F2 — The recount CHECK is exact in Postgres but the delta arrives as float64 from JavaScript

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260813185255_domain_schema.sql:189-193`
- **Detail**: The comment at `:189-190` asserts _"numeric is exact decimal, so this equality is not subject to floating-point drift."_ That is true inside Postgres and false across the wire. `quantity_delta` is computed in TypeScript, PostgREST serialises `numeric` as a JSON number, `JSON.parse` yields float64, and `database.types.ts:157/163/164` types all three columns as `number`. A client computing `28.1 - 28.2` sends `-0.10000000000000142`; the CHECK evaluates exact-decimal `-0.1` and rejects the row with `23514`. Every existing assertion uses integers (`schema.test.ts:146-193`, `supply_ledger.test.sql:35-65`), so this is invisible today and surfaces the first time S-04 recounts a liquid medication — precisely the FR-008 sub-type this schema went to trouble to support. The plan's "Critical Implementation Details" section is where the false assurance lives, so S-04 will inherit it.
- **Fix A ⭐ Recommended**: Pin the quantity columns to a fixed scale (`numeric(12,3)`) and round the delta client-side to the same scale before insert; add a fractional-quantity case to `supply_ledger.test.sql`.
  - Strength: Keeps the CHECK an exact equality, which is what makes it a real guardrail rather than an approximation. A declared scale also makes the contract visible in the generated types.
  - Tradeoff: A follow-up migration altering column types, plus one rounding call at the S-04 insert site.
  - Confidence: MEDIUM — the failure mode is well understood, but the exact scale (3 places? 2?) depends on S-04's liquid-volume units, which do not exist yet.
  - Blind spot: Whether PostgREST rounds or errors on an over-scale input has not been tested.
- **Fix B**: Relax the CHECK to a tolerance — `abs(quantity_delta - (counted_quantity - projected_quantity)) < 0.001`.
  - Strength: One-line migration, no client change, no coordination with S-04.
  - Tradeoff: Weakens the plan's central invariant from an identity to an approximation, and picks a tolerance with no principled basis.
  - Confidence: MEDIUM — works, but trades away the property the constraint existed to guarantee.
  - Blind spot: A tolerance that is too loose would silently accept a genuinely wrong delta.
- **Decision**: QUEUED — Fix A accepted in principle, deferred to `follow-ups/review-fixes.md` because the exact scale depends on S-04's liquid units. Confirmed during triage that `numeric(12,3)` covers ½ / ¼ / ⅛ exactly; thirds are lossy at any decimal scale and would need a different model.

### F3 — Account deletion is structurally impossible once a user owns one medication

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260813185255_domain_schema.sql:37-38` vs `:116-118`, `:216-218`
- **Detail**: `specialists.user_id → auth.users ON DELETE CASCADE` tries to remove the user's specialists; `medications_specialist_fk` and `visits_specialist_fk` are `ON DELETE RESTRICT`, so the cascade trips `23503` and the whole delete fails. `supabase.auth.admin.deleteUser()` and the dashboard's _Delete user_ button both fail for any user who has ever created a medication. The user cannot clear the blockers themselves either — `medications` has no DELETE policy by design (`:275-276`). **The plan documented this** under _Migration Notes_: "It bites in development… No v1 requirement is affected — the PRD has no account-deletion FR." What the plan weighed it against was the FR list. For an application storing medical data, GDPR Art. 17 (right to erasure) is an obligation that does not appear as an FR, which is a materially different bar than the one the plan applied. `constraints.test.sql:118-121` asserts the RESTRICT in isolation; no test exercises `delete from auth.users`, so the collision is invisible to the suite.
- **Fix ⭐**: Decide the erasure story explicitly and record it. The robust schema-side option is to change the two specialist FKs to `ON DELETE CASCADE` and rely on the _absence of a DELETE policy_ — not the FK — to block user-initiated specialist deletion; add a pgTAP assertion that deleting an `auth.users` row succeeds and leaves no orphans.
  - Strength: Restores erasure without loosening what users can do, and turns an invisible collision into a tested property.
  - Tradeoff: Postgres gives no ordering guarantee between sibling cascades, so this needs verifying rather than assuming; it is also a schema change to a foundation five slices depend on.
  - Confidence: MEDIUM — the diagnosis is certain; the fix shape needs a rehearsal against the local stack.
  - Blind spot: Whether an application-level deletion routine (delete leaves, then the account) is preferable to schema cascades has not been weighed — the plan's own note suggests "a deliberate deletion order in the app".
- **Decision**: QUEUED — recorded in `follow-ups/review-fixes.md`. Needs a local-stack rehearsal of the sibling-cascade ordering before landing, and the schema-vs-application choice is still open.

### F4 — RLS read path: `auth.uid()` is unwrapped in all 23 policy expressions, and two tables lack a `user_id`-leading index

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260813185255_domain_schema.sql:265-314` (policies), `:231`, `:234` (indexes)
- **Detail**: 23 occurrences of bare `auth.uid()`, zero of `(select auth.uid())`. `auth.uid()` is `stable`, not `immutable`, so Postgres re-evaluates it per row scanned; wrapping it in a scalar subquery turns it into an InitPlan evaluated once per statement. This is Supabase's own documented RLS-performance recommendation. Separately, `dosage_changes` and `supply_events` are indexed on `(medication_id, …)` only, while RLS injects `user_id = auth.uid()` into every read — so an unfiltered read (exactly what a "recent activity" or "all discrepancies" dashboard query looks like) degrades to a seq scan with a per-row function call. Also note `medications_user_id_active_idx` is partial (`where archived_at is null`), so the FR-007 archive view will not use it. The plan's _Performance Considerations_ correctly judged MVP volumes trivial; this is about doing the cheap thing before S-04 builds on it, not about a live problem.
- **Fix**: In a follow-up migration, rewrite all 16 policies as `(select auth.uid()) = user_id` and add `user_id` indexes on `dosage_changes` and `supply_events`. Behaviour is identical, so the existing pgTAP and integration suites are the regression net.
- **Decision**: QUEUED — recorded in `follow-ups/review-fixes.md`, grouped with F2/F3 as migrations to land together against a running local stack.

### F5 — Unvalidated client string stored in `user_metadata`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/auth/signup.ts:12,21`
- **Detail**: `timezone` is taken verbatim from the POST body and stored in `raw_user_meta_data` with no IANA check and no length cap. A direct `curl` can store a multi-kilobyte string. Two consequences: `user_metadata` is embedded in the access token, so an oversized value inflates every request header; and S-04 will consume this as a timezone, where `Intl.DateTimeFormat(undefined, { timeZone: value })` throws `RangeError` on an invalid zone — a stored-input crash on the dashboard render path. Worth pairing with the fact that `user_metadata` is user-writable via `auth.updateUser({ data })`, so it can never be trusted for anything security-relevant. The plan specified the capture but not its validation.
- **Fix**: Validate before storing — `Intl.supportedValuesOf("timeZone").includes(timezone)` (available on Workers' V8), or minimally `timezone.length <= 64 && /^[A-Za-z0-9_+\-\/]+$/.test(timezone)` — and drop the value silently when it fails, preserving the existing "no key rather than a bad key" semantics.
- **Decision**: FIXED — `signup.ts` now gates the value through an `isValidTimeZone()` helper and drops anything invalid. Implemented as a `try`/`catch` around `Intl.DateTimeFormat(undefined, { timeZone })` rather than `supportedValuesOf`, for two reasons: `supportedValuesOf` lists only _canonical_ zones, so legitimate aliases (`Asia/Calcutta`, `America/Buenos_Aires`) that browsers still report would be silently dropped; and constructing a `DateTimeFormat` is the exact call S-04 makes to render, so a surviving value provably cannot throw `RangeError` downstream. It also rejects an oversized string on its own, so no separate length cap was needed. `npm run lint` exit 0; `astro check` 0 errors / 0 warnings / 4 hints (unchanged from baseline).

### F6 — Server-only `SUPABASE_URL` is rendered to anonymous visitors when configuration is incomplete

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/config-status.ts:19` → `src/layouts/Layout.astro:24-39`
- **Detail**: The message interpolates `SUPABASE_URL`, and `getMissingConfigs()` returns a status whenever _either_ variable is missing. So a deploy with the URL set and the key missing renders the project URL into the public HTML of every page. The comment at `:17-18` correctly refuses to interpolate `SUPABASE_KEY` — the same reasoning applies to the URL, which `astro.config.mjs:19-20` also declares `access: "secret"`. This is Phase 1 deviation 4 (reworking pre-existing debug code); it improved on what it replaced but stopped one field short.
- **Fix**: Replace the interpolation with a boolean — `SUPABASE_URL: ${SUPABASE_URL ? "set" : "not set"}`. The developer already knows their own URL.
- **Decision**: FIXED — `config-status.ts:19` now reports `ustawiony` / `nie ustawiony` (Polish, matching the surrounding message) instead of interpolating the value. The comment at `:17-18` was widened from "SUPABASE_KEY is deliberately NOT interpolated" to cover both variables, since `astro.config.mjs:19-20` declares both `access: "secret"`. `npm run lint` exit 0; `astro check` 0 errors / 0 warnings / 4 hints; `npm run build` exit 0.

### F7 — Five unplanned files in the change set

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `.env.example`, `.prettierrc.json`, `eslint.config.js`, `src/lib/config-status.ts`, `src/layouts/Layout.astro`
- **Detail**: None appear in the plan's _Changes Required_, and all five are documented in `change.md` as deviations agreed at the time. Four are defensible lint-unblocking or mechanical consequences: `.prettierrc.json` (`endOfLine: auto`, clearing 925 pre-existing CRLF errors that blocked criteria 3.3/4.2), `eslint.config.js` (ignoring the generated types, which `--fix` would fight with `db:types`), `config-status.ts` (removing a `SUPABASE_KEY` leak), `Layout.astro` (following the export-shape change). The fifth, `.env.example`, is the only one with a consequence — see F1. Recorded as a finding because a reviewer reading `plan.md` alone would not expect any of them; the documentation lives in `change.md`.
- **Fix**: No code change. Add a one-line pointer in `plan.md` → _What We're NOT Doing_ or an addendum noting that lint-unblocking edits were in scope, so the plan stays usable as the standalone contract.
- **Decision**: FIXED (plan) — `plan.md` → _What We're NOT Doing_ now closes with a dated addendum naming all five files, grouping them by why they were touched (lint gate / secret leak / export-shape follow-on / `.env.example`), and pointing at `change.md` → _Deviations_ for the per-file rationale. No source change; the plan now reads as a complete contract standalone.

### F8 — `updated_at` has no maintainer _and_ is client-writable

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260813185255_domain_schema.sql:42`, `:75`, `:214`
- **Detail**: Confirmed genuinely absent rather than half-wired — no trigger, no application write anywhere in `src/` or `tests/`, and `default now()` fires on INSERT only. So `updated_at` equals `created_at` on every row, forever; `append_only.test.sql:55-58` and `schema.test.ts:112-117` both perform real archival UPDATEs without touching it. The plan deferred the maintainer to S-01 deliberately and named the three live options, so that half is tracked. **What the plan did not note is that the column is client-writable**: the UPDATE policies constrain no columns, and `database.types.ts` exposes `updated_at?: string` on both `Insert` and `Update`, so a client can set it to any value including the past. That changes the S-01 decision — "application sets it on every write path" is only meaningful alongside a `check (updated_at >= created_at)`.
- **Fix**: Record the client-writability in `CLAUDE.md` → _Domain schema_ alongside the existing no-trigger rule, so S-01 inherits the full picture rather than rediscovering it.
- **Decision**: FIXED (docs) — `CLAUDE.md` → _Domain schema_ gained a bullet directly after the no-procedural-code rule, recording both halves: no maintainer (so `updated_at` equals `created_at` on every row today) and client-writable (UPDATE policies constrain no columns; `database.types.ts` exposes it on `Insert` and `Update`). It names the `check (updated_at >= created_at)` that must accompany whatever write path S-01 chooses, so the deferred decision is inherited whole.

### F9 — CI gates neither test suite this change added, and deploys to production on push

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `.github/workflows/ci.yml`
- **Detail**: This change added 57 pgTAP assertions and 15 integration tests; CI runs `lint` + `build` only and deploys to production on every push to `master` with no test in between. The plan deliberately left `ci.yml` alone, but that decision was scoped to _migrations_ ("No CI-applied migrations… `db push` stays a deliberate manual step") — the testing strategy section never addressed CI. Also noted: `@astrojs/check` is a dependency but no `typecheck` script exists, so `.astro` compile errors are not surfaced by `npm run lint`. Recorded as an observation because wiring a Supabase service container into CI is its own change, not a fix to this one.
- **Fix**: Open a follow-up change to add `npm run db:test` behind `supabase/setup-cli@v1`, plus a `"typecheck": "astro check"` script wired into the workflow.
- **Decision**: QUEUED — recorded in `follow-ups/review-fixes.md`. Two points sharpened while writing it up: the test steps must be ordered **before** the two `wrangler-action` deploy steps (`ci.yml:25-36`), or a red suite still ships; and CI must point the Vitest run at the CLI-started stack rather than the `SUPABASE_URL` secret, because the Phase 4 helper refuses a non-local URL by design.

### F10 — Unguarded `request.formData()` and `as string` casts at the auth boundary

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/auth/signup.ts:5-7`, `src/pages/api/auth/signin.ts:5-7`
- **Detail**: `formData()` rejects with a `TypeError` on an absent, truncated, or non-form body, with no `try`/`catch` — so `curl -X POST /api/auth/signup -d '{}' -H 'Content-Type: application/json'` yields a raw 500 instead of the redirect-with-message pattern the route uses everywhere else. Separately, `form.get("email") as string` lies: the return type is `string | File | null`, and a POST omitting the field passes `null` into `signUp`. It fails safe today (GoTrue returns 422 and the existing error path catches it) but defeats `strictTypeChecked` at the boundary where it matters most. Both are shared verbatim with `signin.ts`, so this is a _consistent_ pre-existing weakness rather than drift introduced here — `signup.ts` is in scope only because this change edited it.
- **Fix**: Wrap `formData()` in `try`/`catch` falling through to the existing `redirect('/auth/signup?error=…')` path, and narrow with `typeof x !== "string"` instead of casting. Apply to both routes together so they stay symmetric.
- **Decision**: FIXED — applied to **both** routes so they stay symmetric. Each now wraps `formData()` in `try`/`catch` redirecting to its own `?error=Invalid form submission`, and narrows `email` / `password` with `typeof !== "string"` (redirecting to `?error=Email and password are required`) instead of casting. `signup.ts`'s `timezone` read was narrowed the same way, replacing the `as string | null` cast ahead of the existing `isValidTimeZone` gate. `npm run lint` exit 0; `astro check` 0 errors / 0 warnings / 4 hints (unchanged); `npm run build` exit 0.

## Also noted, not tracked as findings

- `CLAUDE.md` → _Auth & route protection_ says the post-auth redirect is `/dashboard`; `src/pages/api/auth/signin.ts:19` redirects to `/`. Pre-existing doc drift, surfaced because `CLAUDE.md` is in the changed set.
- `SubmitButton.tsx:12` — `useFormStatus()` only reports `pending` for function-action forms; both auth forms use a string action, so the spinner and `pendingText` are unreachable and double-submit is unprevented. Pre-existing, consistent across both forms.
- Unbounded `text` columns (`:171` `note`, `:63` `name`, `:39-40`) check blankness but never length.
- CSRF is covered by Astro's `security.checkOrigin: true` default, not by anything in this repo — invisible, and a future `security: {}` block would silently disable it.
- `medications_name_not_blank` (`:77`) is a benign CHECK not named in the plan's contract, consistent with the specialists blankness checks.
- `tests/integration/helpers/client.ts:22` — a malformed `SUPABASE_URL` makes `new URL()` throw a bare `TypeError`, losing the guard's carefully written guidance message. Still fails closed.

## What was verified clean

Plan adherence across all five phases — every planned file exists and implements the stated intent, with `file:line` evidence for each contract item. All eleven "What We're NOT Doing" guardrails hold: no views, no `src/lib/db/` repository layer, no calculation engine, no UI beyond the hidden field, no history screen, CI untouched, no `balance_after` / `verify_supply_ledger()`, no triggers / `SECURITY DEFINER` / RPC, no `profiles` table, and no `src/lib/timezone.ts` (the cut `getUserTimezone` correctly does not exist).

RLS role scoping — all 16 policies `to authenticated`, none targeting `anon` or `public`. The row-reassignment attack is closed: all three UPDATE policies carry both `USING` and `WITH CHECK`, and all four INSERT policies use `WITH CHECK`. Composite FKs make cross-owner rows impossible and are tested at both layers.

Both boolean-equality presence constraints are now correctly written as `CASE` — the defect shape that bit this change twice is genuinely closed, with regression coverage for the _partial_ case in pgTAP and through PostgREST, which is the assertion that catches it.

The `is:inline` timezone script is correct: `event.target` is the form, the selector is unique, Enter-key submission dispatches the same bubbling event, and the document listener is genuinely the last writer before the native POST. Empty and absent timezones both omit the `user_metadata` key entirely rather than storing `""`.

The test helper's local-URL guard resists every named bypass — trailing slash, uppercase, bracketed and expanded IPv6, `127.0.0.1.evil.com`, userinfo, and integer-IPv4 forms all resolve correctly through `URL.hostname`, and it fails closed in ambiguous cases.

Pattern consistency — `signup.ts`, `SignUpForm.tsx`, and `signup.astro` each match their siblings in structure, error handling, and composition; `@/*` alias discipline is clean with zero `../../` traversals; `no-console` has zero hits; the generated types are stock CLI output with no hand-edit signature.
