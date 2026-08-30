<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Manage Doctor Visits (S-03)

- **Plan**: `context/changes/manage-doctor-visits/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-27
- **Verdict**: **SOUND** (as first reviewed: REVISE — all six findings fixed during triage)
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | As reviewed | After triage |
|-----------|-------------|--------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

7/7 claimed paths exist; 4/4 paths the plan says are absent are absent; brief-to-plan consistent. **Every line citation in this plan resolved exactly** — the `visits` DDL, all four RLS policies and their `(select auth.uid())` rewrites, the grant and revoke lines, the `updated_at` CHECK, the load-failure notice at `specialists.astro:36-41`, the post-delete focus hand-off in `SpecialistsManager`, `jsonError`'s positional signature, and the two lead assertions in `specialists-tests.md`.

The shared-stack reasoning also checks out in practice, though not for the reason the plan gave: every pgTAP suite is wrapped in `begin` / `rollback`, and the integration suite creates a uniquely-named user per test with no truncate and no zero-row expectation anywhere, so both suites genuinely run clean against S-02's migrated database without a reset. (The plan's stated reason — that master's migration set is "a strict subset" of S-02's — is not quite right, since S-02 ALTERs and RENAMEs an existing policy rather than only adding. The conclusion survives because no assertion touches that policy or its name.)

## Findings

### F1 — The timezone is `any`, never narrowed, and permanently absent for a class of users

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 section 2, `resolveToday`; Phase 2 section 3, `visits.astro`
- **Detail**: Two problems behind one call.
  **Typing.** `src/env.d.ts` declares `App.Locals.user` as the bare `@supabase/supabase-js` `User`, whose `user_metadata` is `Record<string, any>`. So the expression Phase 2 specified evaluates to `any`. `eslint.config.js:15` enables `tseslint.configs.strictTypeChecked` across all of `src/` — `disableTypeChecked` is scoped to `scripts/**` only — and passing an `any` into `resolveToday(timeZone: string | undefined)` is precisely what `@typescript-eslint/no-unsafe-argument` reports. Both phases gate on lint at 0 errors and 0 warnings, so the plan's own first criterion was at risk on the line it specified.
  **Coverage.** The plan's brief accepted that JS-disabled signups get UTC. It is worse than transient: the zone is stamped only by an inline script at `src/pages/auth/signup.astro:27-32`, and `signin.ts` never backfills. A JS-disabled account, and every account that already exists, has no timezone forever. UTC is not an edge case; for some users it is the only path.
- **Fix**: Narrow at the boundary and restate UTC as the default path rather than a degraded one.
  - Strength: One guard fixes the lint failure and the hostile-input concern the plan already argues for.
  - Confidence: HIGH — `strictTypeChecked` and the `Record<string, any>` typing both verified directly.
  - Blind spot: Whether `eslint-plugin-astro` applies type-aware rules inside `.astro` frontmatter as strictly as in `.ts`. If it does not, the lint half is moot; the coverage half stands regardless.
- **Decision**: FIXED — Critical Implementation Details gained a UTC-is-normal paragraph naming the signin gap, and a caller-must-narrow paragraph with the `unknown` read and the `typeof` guard. `resolveToday`'s contract now states it never takes `any`. `plan-brief.md` Open Risks updated.

### F2 — An unconfigured Supabase renders "you have no specialists yet" and links to an equally broken page

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 section 3, the page contract
- **Detail**: The plan said `visits.astro` copies `specialists.astro`'s `loadFailed` shell, and that a failed load renders the bordered notice "rather than an empty list, which would be a lie". But `specialists.astro:9-21` has a third branch the plan did not account for: when `createClient` returns `null` (unset `SUPABASE_URL` or `SUPABASE_KEY`, `src/lib/supabase.ts:9-11`) the page falls through with `loadFailed = false` and an empty array, rendering "no specialists" without ever setting the flag. On `/specialists` that is a mild lie. On `/visits` it collides with this plan's own zero-specialists branch: the screen would replace the add form with a prompt to add a specialist at `/specialists`, routing the user to a page broken in the same way. The user is told a false thing about their data and sent into a dead end.
- **Fix**: Treat a null client as `loadFailed = true` in `visits.astro` rather than inheriting the fall-through, and gate the zero-specialists prompt on `!loadFailed`.
  - Strength: Two conditions; keeps the empty-list-is-a-lie principle the plan already committed to.
  - Tradeoff: Diverges from `specialists.astro`, which keeps the bug — worth queueing a follow-up.
  - Confidence: HIGH — the fall-through is verified in the page source.
- **Decision**: FIXED — Phase 2 section 3 gained a copy-the-notice-not-the-branching paragraph, and a new Close-out follow-up (`follow-ups/specialists-page-load-guard.md`) records the same fall-through left in `specialists.astro`, which is out of scope here.

### F3 — Close-out's deliverables have no Progress entries, so `/10x-implement` cannot see them

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `## Close-out`; `## Progress`
- **Detail**: Progress contained Phase 1 and Phase 2 and stopped. The Close-out section carried three real deliverables — `follow-ups/visits-tests.md`, two new `CLAUDE.md` conventions, and the `change.md` epilogue — and none had a checkbox anywhere. `/10x-implement` walks the Progress block; work that is not in it does not get walked. This mattered more than usual because the Testing Strategy leans on `visits-tests.md` existing as the justification for shipping no tests. If close-out were skipped, the slice would ship with neither tests nor the contract meant to stand in for them.
- **Fix**: Add a Close-out Success Criteria list and a matching Progress subsection so the mechanical contract holds.
  - Strength: Makes the stand-in-for-tests artifact as trackable as the code.
  - Tradeoff: None material — document structure.
  - Confidence: HIGH — verified against the plan's own Progress block.
- **Decision**: FIXED — Close-out gained a `### Success Criteria:` block with four Manual Verification bullets, and Progress gained a `### Close-out` subsection with `3.1` through `3.4`. The fourth item is the follow-up added by F2.

### F4 — S-02 and S-03 edit the same files; neither plan knew it

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 section 4; Migration Notes
- **Detail**: Both plans coordinated carefully over the shared Supabase stack and not at all over source files. A trial merge of the two branches **already failed at review time**, before either had written code: a content conflict in `context/foundation/roadmap.md`, because both flipped their own row from `proposed` to `planning` on adjacent lines. Still ahead: `src/middleware.ts:4` is a single-line array literal both slices append to (unavoidable conflict, unambiguous resolution), `src/components/Topbar.astro:4-7` takes two entries at the same insertion point, and both append to the tail of the `## Domain schema` section of `CLAUDE.md`.
- **Fix**: Name the collision in both plans and decide merge order; the second slice re-applies its own one-liners by hand and verifies both routes and both nav entries survive.
- **Decision**: FIXED — an identical `## Parallel-slice coordination` section added to both plans. Extended to five files when F6(c) took `src/components/form/FormField.tsx` into scope.

### F5 — S-02 maps the same failure to a different status

- **Severity**: OBSERVATION
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Key Discoveries; Phase 1 section 4
- **Detail**: This plan maps `23503` on a visit INSERT or UPDATE — "that specialist is not yours" — to 400 with `fieldErrors.specialist_id`, and distinguishes it correctly from `deleteSpecialist`'s 409, which `CLAUDE.md:54` defines as "blocked by references". That reasoning checks out against both the code and the written contract. The parallel S-02 plan mapped the identical situation to 409. Both slices put the specialist in a `select`, so a field error is the more useful shape in both. **Nothing needed to change in this plan** — recorded so the divergence was settled deliberately rather than by merge order.
- **Fix**: Align S-02 to this plan's mapping, and record here that it was settled.
- **Decision**: FIXED in S-02 (its F2); this plan's Key Discoveries entry now records that S-02 was aligned to 400 during plan review, so a later reader sees a settled decision rather than two plans disagreeing.

### F6 — Three accuracy defects, one of them a real accessibility gap

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness / Blind Spots
- **Location**: Phase 1 and 2 Automated criteria; Performance Considerations; Phase 2 section 1
- **Detail**:
  (a) `npx astro check` was an automated gate in both phases, but no `typecheck` script exists — the follow-up proposing one (`domain-schema-foundation/follow-ups/review-fixes.md:151`) was never actioned. `@astrojs/check` is in `dependencies`, not `devDependencies` as the plan implied. And the "5 pre-existing hints" baseline had already drifted from 4 to 5 across earlier changes, so pinning a hint count in a pass/fail criterion would eventually produce a false failure.
  (b) Performance Considerations cited `visits_user_visit_date_idx` as "the one query's" index; the table carries two — `visits_specialist_visit_date_idx` also exists (`domain_schema.sql:238-239`).
  (c) `SelectField` was specified to mirror `FormField` "exactly" on the aria contract. But `FormField` wires `aria-describedby` to the error id only; a `hint` renders as the else arm of the error ternary, carries no id, and is never referenced. The past-date and far-future notes this slice adds are hints, on a screen the plan holds to AA — so mirroring verbatim would reproduce the gap on new code.
- **Fix**: Add the `typecheck` script and drop the hint count; cite both indexes; give `FormField` a hint id wired into `aria-describedby` and have `SelectField` mirror the corrected contract.
- **Decision**: FIXED — all three. Phase 1 gained a section 5 for the one-line `package.json` change; both phases and Progress `1.2` / `2.2` now call `npm run typecheck` with hints read rather than asserted; both indexes cited; Phase 2 section 1 gained a fix-the-aria-contract-before-mirroring-it paragraph, with a new criterion and Progress `2.16`. Because `FormField` is shared with S-02's medication form, it was added to both coordination tables as the fifth shared file.

## Notes

Progress and Success Criteria are exactly balanced at 29 each, with no stray checkboxes outside the Progress block and one `## Progress` heading.

Not verified during this review: whether `eslint-plugin-astro` applies type-aware lint rules inside `.astro` frontmatter as strictly as in `.ts` (F1's narrow is correct either way), and none of these edits have been exercised against a running stack — they are plan changes.
