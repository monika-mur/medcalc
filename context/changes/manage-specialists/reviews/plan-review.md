<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Manage Specialists (S-01)

- **Plan**: `context/changes/manage-specialists/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-21
- **Verdict**: REVISE → **SOUND** after triage
- **Findings**: 0 critical, 6 warnings, 2 observations — 7 fixed, 1 dismissed, 0 pending

## Verdicts

| Dimension             | Verdict (at review) | After triage |
| --------------------- | ------------------- | ------------ |
| End-State Alignment   | WARNING             | PASS         |
| Lean Execution        | WARNING             | PASS         |
| Architectural Fitness | PASS                | PASS         |
| Blind Spots           | WARNING             | PASS         |
| Plan Completeness     | WARNING             | PASS         |

## Grounding

19/19 paths ✓, 10/10 symbols ✓, brief↔plan ⚠ (Phase 2 scope drift — see F8).

Claims verified against the codebase and found **correct**, recorded so a later review need not re-check:

- `specialists` carries all four RLS policies — `supabase/migrations/20260813185255_domain_schema.sql:265-273`
- Minimal `medications` insert is `(specialist_id, name, expiry_date)`; every other NOT NULL column has a default — `:58-120`
- pgTAP totals 57 assertions — `plan(13|15|15|14)` across the four test files
- `dosage_changes` and `supply_events` have no `user_id` index — `:225-238`
- `FormField` has exactly two importers (`SignInForm`, `SignUpForm`)
- `visits.specialist_id` is NOT NULL, so usage counts need no null handling — `:210`
- `updated_at` exists on exactly the three named tables — `:42` (specialists), `:75` (medications), `:214` (visits)
- `createClient(headers, cookies)` returns null when unconfigured and is already handled that way in the auth routes

## Findings

### F1 — updated_at stays client-writable through the new PATCH route

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 + Phase 3 §2/§3
- **Detail**: The plan framed impl-review F8 as settled by `check (updated_at >= created_at)`. That CHECK closes only backdating. The UPDATE policies constrain no columns and `database.types.ts` exposes `updated_at` on `Update`, so a client can still set a future value. Phase 3 said the route "validates the body with the zod schema and delegates to the module" without requiring that only validated fields are written — leaving the safe outcome to zod's default key-stripping rather than to specification. No database-level alternative exists: revoking column UPDATE from `authenticated` blocks the module's own write (same role), and a trigger is ruled out by the schema's no-procedural-code property.
- **Fix**: Specify explicit payload construction in `updateSpecialist` (`{ name, specialty, updated_at }` from parsed zod output, never spreading a request body), state the same for `createSpecialist`, forward only parsed output from the route, and add an integration assertion that a caller-supplied `updated_at` is ignored.
- **Decision**: FIXED

### F2 — Phase 2's grep gate can never pass, and isn't runnable in PowerShell

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §4 "Verification aid"; criterion 2.4
- **Detail**: Two defects in one command. (a) It self-matched files the plan forbids editing — `src/components/ui/button.tsx:14` contains `text-white` in the destructive variant, and `ui/LibBadge.astro` contains `purple-`, making the gate unpassable as written. (b) It was written as `grep -rn ... src/`, violating the accepted rule in `lessons.md` → _Write shell commands for PowerShell, not for the agent's own Bash tool_ — the developer's shell has no `grep`.
- **Fix**: Rewrote as a PowerShell `Get-ChildItem | Where-Object | Select-String` pipeline excluding `components\ui`, and dropped `text-white` from the pattern (a green fill legitimately renders white text via `--primary-foreground`). Both exclusions documented inline so a later reader doesn't "helpfully" restore them.
- **Decision**: FIXED

### F3 — The 404 status has no stated detection mechanism

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3 (JSON error contract)
- **Detail**: The status list included 404, but under RLS an UPDATE or DELETE against a missing or foreign `id` matches zero rows and raises nothing — `CLAUDE.md` already records this for DELETE. Without a stated rule, a PATCH against a stranger's specialist returns 200 and a DELETE returns 204, and the cross-user isolation test still passes because it only asserts the row survives.
- **Fix**: Specified `.select()` chained onto update and delete with an empty result mapped to 404; added integration assertions for a random UUID and for a second user targeting the first user's row; extended manual criterion 3.5.
- **Decision**: FIXED

### F4 — "23 bare occurrences" is wrong; the real count is 19

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1, F4 contract bullet
- **Detail**: The migration holds 26 `auth.uid()` occurrences: 2 in header comments (`:13-14`), 5 in column DEFAULT clauses (`:37`, `:61`, `:133`, `:163`, `:210`), and 19 in policy `USING` / `WITH CHECK` clauses (`:266-314`). The risk was not the arithmetic but that an implementer treating 23 as a completion target would reach for the 5 DEFAULT clauses to close the gap — editing table DDL for no benefit, since a column default is evaluated per inserted row regardless and the initplan optimisation does not apply.
- **Fix**: Corrected to 19 with the line range, and added an explicit exclusion clause for the DEFAULT and comment occurrences plus a "if your count exceeds 19, you touched something outside the policy block" tripwire. "All 16 RLS policies" was already correct.
- **Decision**: FIXED

### F5 — Phase 2 restyles dashboard.astro, which "What We're NOT Doing" forbids

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: "What We're NOT Doing" bullet 1 vs Phase 2 §4
- **Detail**: Scope said "No medications, visits, or dashboard work. S-02, S-03 and S-04 own those," while Phase 2 §4 listed `dashboard.astro` for restyling. Both were right in intent, but as written they contradicted — and an impl-review would read it as drift.
- **Fix**: Qualified the boundary to name _functionality_ as out of scope, with the visual repaint called out as the deliberate exception ("repainting it is not building it").
- **Decision**: FIXED

### F6 — LibBadge.astro is unlisted and collides with the "never edit ui/" rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §0 and §4
- **Detail**: `src/components/ui/LibBadge.astro` carries dark-theme colour (`bg-blue-900/50`, `text-purple-200`), is rendered by `Welcome.astro` on the public landing page, appeared in no file list, and sat inside the `ui/` directory that step 0 declares off-limits.
- **Decision**: DISMISSED — subsumed by F7's Fix A, which deletes the file outright. The plan now names the deletion and carves `LibBadge` out of the do-not-edit rule as starter boilerplate that merely happens to live in `ui/`.

### F7 — Restyling Welcome.astro is throwaway effort

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 2 §4
- **Detail**: `Welcome.astro` is ~110 lines of starter marketing content — three glass feature cards, a dependency-version badge strip, starter doc links — routed at `/` via `index.astro`. It cannot stay dark, but repainting markup that gets deleted the moment MedCalc has a real landing page is effort that does not compound.
- **Fix A ⭐ Recommended**: Replace rather than restyle — minimal landing (product name, one sentence, sign-in/sign-up buttons), file kept at its current path so `index.astro` needs no edit, real `title` passed to `Layout`.
  - Strength: Likely less work than repainting four glass cards; deletes `LibBadge.astro` in passing, resolving F6.
  - Tradeoff: ~20 lines of new markup instead of edits, in an already-large Phase 2.
  - Confidence: HIGH — both files read; content is entirely starter boilerplate with no MedCalc copy.
  - Blind spot: Whether a public landing page is wanted at all pre-auth is a product question.
- **Fix B**: Restyle as originally planned. Rejected.
- **Decision**: FIXED via Fix A

### F8 — Desired End State and the brief are silent on the design system

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Desired End State; What We're NOT Doing; `plan-brief.md`
- **Detail**: Phase 2 now delivers an app-wide visual system across ten files, but Desired End State describes only the specialists screen, so a reader checking "did we reach the end state?" finds no criterion covering the largest surface change in the slice. `plan-brief.md` still describes Phase 2 as "unified auth styling" and scopes it to "restyling the auth screens" — the drift the grounding line flagged. Also unrecorded as boundaries: no dark mode (the `.dark` block stays dead), and no visual-regression or automated-a11y tooling.
- **Fix**: Add a paragraph to Desired End State naming the white/green system and AA contrast as part of the end state; add "no dark mode" and "no visual-regression or a11y tooling" to What We're NOT Doing; update `plan-brief.md`'s end state, decision table, Phase 2 row, scope lines, and effort estimate to say app-wide restyle.
- **Decision**: FIXED

## Note on `change.md`

`change.md` was updated alongside the accepted fixes, because two of its claims were directly contradicted by them: it stated both halves of the `updated_at` debt are settled in Phase 1 (F1 moved the second half to Phase 3), and it scoped the restyle to the auth screens (F5 and F7 widened it). Status moved to `plan_reviewed`.
