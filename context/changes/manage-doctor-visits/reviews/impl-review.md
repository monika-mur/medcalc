<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Manage Doctor Visits

- **Plan**: `context/changes/manage-doctor-visits/plan.md`
- **Scope**: Full plan — Phase 1, Phase 2, Close-out (all Progress boxes `[x]`)
- **Date**: 2026-08-30
- **Verdict**: NEEDS ATTENTION (at review time) — **all 10 findings triaged and closed**, 2026-08-30
- **Findings**: 0 critical, 3 warnings, 7 observations

## Triage outcome — 2026-08-30

|                               | Findings                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| **Fixed**                     | F1 (Fix A), F2 (record only), F3, F4, F5, F7, F8 — 7                                      |
| **Queued as follow-up**       | F6 → `follow-ups/typecheck-in-ci.md`; F10 → `follow-ups/inherited-pattern-latents.md` — 2 |
| **Recorded as a known bound** | F9 → `follow-ups/visits-tests.md` — 1                                                     |
| **Skipped / dismissed**       | none                                                                                      |

Code touched during triage: `src/components/visits/VisitsManager.tsx`,
`src/components/form/SelectField.tsx`, `src/lib/db/visits.ts`. Docs touched:
`change.md`, `context/foundation/roadmap.md`,
`follow-ups/visits-tests.md`, plus the two new follow-up files.

**All gates re-run after the fixes**: lint 0 errors 0 warnings; typecheck 0
errors 0 warnings (same 5 pre-existing hints); build completes; 15/15
integration tests; 70 pgTAP assertions PASS; `src/db/` and
`supabase/migrations/` still byte-identical to `master`. No migration, no
`db:reset`, no `db:types` — the shared-stack rule held throughout.

One correction to the review itself: **F2's premise was partly wrong.** The
404-prune reasoning _was_ already recorded in a code comment at
`VisitsManager.tsx:162-163`; only the `change.md` record was missing.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Only F1 has user-visible impact. F2–F10 are cosmetic, housekeeping, or recorded-known-bound entries.

## Verification run at review time

| Gate                                          | Result                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run lint`                                | 0 errors, 0 warnings                                                              |
| `npm run typecheck`                           | 0 errors, 0 warnings, 5 hints (all pre-existing `ts(6387)` in `eslint.config.js`) |
| `npm test`                                    | 15/15 passed                                                                      |
| `npm run db:test`                             | 70 assertions, 4 files, PASS                                                      |
| `npm run build`                               | Completes (13.7s)                                                                 |
| `git diff master...HEAD -- src/db/ supabase/` | empty — `database.types.ts` and migrations byte-identical                         |

Both suites were run **without** `db:reset`, per the plan's shared-stack rule. The one Tailwind warning in the build output (`"file" is not a known CSS property`, from arbitrary classes `[file:line]` / `[tool:pytest]`) originates outside this slice's source and is not attributable to it.

All 12 planned change items verified MATCH against the plan's stated intent. All 8 scope guardrails verified clean, including `isValidTimeZone` remaining private to `signup.ts`, and no auth file, `/specialists` file, `src/components/ui/` primitive, or migration touched.

## Findings

### F1 — Client-side validation failure is silent to assistive tech

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/visits/VisitsManager.tsx:180-192
- **Detail**: `handleSubmit` calls `setNotice(null)` — emptying the `aria-live` region at `:431` — then on a zod failure calls `setErrorsFor(...)` and returns. Focus stays on the submit button and nothing moves to the first invalid control. A screen-reader user who presses "Add visit" with no specialist chosen hears nothing at all and gets no signal the submit was rejected. The server-error path is fine: `save()` writes into the notice region. This is the one accessibility gap not covered by Phase 2's criteria — 2.14 asserts the notice region announces (it does, for server errors) and 2.16 asserts the date _hint_ is announced (it now is, via the `FormField` fix). The client-side-rejection path was never asserted. The same gap exists in `SpecialistsManager.tsx:83-86,133-136`, so this is an inherited pattern hole, not a divergence introduced here.
- **Fix A ⭐ Recommended**: Fix in `VisitsManager` only — after `setErrorsFor`, focus the first errored field (the ids are already deterministic: `visit-specialist`, `visit-date`, `edit-*-<uuid>`).
  - Strength: Respects the plan's explicit guardrail "No changes to /specialists"; keeps the diff inside this slice's surface and the merge with S-02 unchanged.
  - Tradeoff: Leaves `/specialists` silent, so the two screens behave differently until someone fixes S-01.
  - Confidence: HIGH — the ids exist and the focus-move idiom is already in this file at `:248-250`.
  - Blind spot: Focusing the errored field is one of two valid patterns; announcing via the notice region is the other, and which reads better depends on a real screen-reader pass that has not been done for this path.
- **Fix B**: Fix in both islands and record the rule via `/10x-lesson`.
  - Strength: Closes the class rather than the instance; the next island inherits the corrected pattern instead of the hole.
  - Tradeoff: Breaks the plan's "no changes to /specialists" guardrail, and widens a diff that must still merge behind S-02.
  - Confidence: MEDIUM — the fix is mechanical, but touching a second slice's file now re-opens scope that was deliberately closed.
  - Blind spot: Whether S-02's `MedicationsManager` has the same hole has not been checked from this worktree.
- **Decision**: FIXED via Fix A — `focusFirstError(target, errors)` added and called from `handleSubmit`'s rejection branch. Fields are checked in render order (`specialist_id`, then `visit_date`) and the id is composed from the target, so it serves both the add form and any row's edit form. Lint 0/0 and typecheck 0/0 after the change. `/specialists` deliberately left alone, per the guardrail.

### F2 — Unplanned 404-on-edit row pruning

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/visits/VisitsManager.tsx:144-149
- **Detail**: On a `404` from an edit, the island drops the row from local state and clears `editingId`. Neither the plan nor the pattern source describes this — `SpecialistsManager.handleEdit:146-151` only sets errors and a notice. Behaviourally sound (a 404 on PATCH means the row is genuinely gone, so keeping it on screen would be a lie), but it is work the plan did not sanction and the next reader has no record of why it is there.
- **Fix**: Add a one-line comment naming the reason, and record the addition in `change.md` as an adaptation.
- **Decision**: FIXED (partially pre-existing). Correction to the finding: the reason **was** already recorded in a code comment at `VisitsManager.tsx:162-163` — "A 404 on edit means the row is gone — deleted in another tab. Drop it rather than leaving an editor open over something that isn't there." Only the `change.md` record was missing, and it has been added under _Implementation review — 2026-08-30_, correcting that session's "nothing else diverged from the plan" claim. No code change.

### F3 — SelectField drops the two `dark:` variants Input carries

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/form/SelectField.tsx:61-63
- **Detail**: The class list is `src/components/ui/input.tsx`'s token-for-token minus `dark:bg-input/30` (`input.tsx:11`) and `dark:aria-invalid:ring-destructive/40` (`input.tsx:13`). Inert today — `CLAUDE.md` records the `.dark` block in `global.css` as dead and nothing sets `class="dark"` — but the two controls would diverge visually the day a slice populates dark mode, which is exactly the drift `SelectField` exists to prevent. (Separately, the plan named `bg-background` while the implementation uses `bg-transparent`; that follows `Input`'s actual token over the plan's literal wording and is correct.)
- **Fix**: Append the two `dark:` variants so the select stays token-for-token with `Input`.
- **Decision**: FIXED — `dark:bg-input/30` and `dark:aria-invalid:ring-destructive/40` added, with a comment naming why the dead `dark:` block is still worth matching.

### F4 — Roadmap row left at `in-progress` while the change is `implemented`

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/roadmap.md:35 and :113
- **Detail**: Both the S-03 table row and its status block read `in-progress`, while `change.md` is `status: implemented` and every Progress box is `[x]`. S-01 set the precedent of flipping to `done`. Defensible as honest — the delivery merge is blocked until S-02 merges — but it is inconsistent with both the precedent and this change's own recorded state, and nothing says which reading is intended.
- **Fix**: Either flip both to `done`, or state explicitly in `change.md` that the roadmap row stays `in-progress` until the delivery merge lands. Make it a deliberate choice rather than an incidental one.
- **Decision**: FIXED — both `roadmap.md:35` and `:113` flipped to `done`, matching S-01's precedent. Note for the delivery merge: `roadmap.md` is one of the five files S-02 also edits, so this row conflicts either way and must be re-applied by hand per _Parallel-slice coordination_.

### F5 — SelectField carries an unused `hint` prop

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/form/SelectField.tsx:21 (rendered at :93-95)
- **Detail**: `hint?: ReactNode` is declared and rendered, but the plan's prop list stopped at `error?` / `placeholder?` / `options`, and no caller passes it — `VisitsManager.tsx:271-282` and `:398-409` pass only `error`. Defensible as "mirrors `FormField` exactly", which was the component's stated purpose, but it is unexercised surface area.
- **Fix**: Keep it — it is the mirror the plan asked for — and say so in a comment; or drop it until a caller needs it.
- **Decision**: FIXED — kept, with a doc comment on the prop naming the reason (a form mixing `FormField` and `SelectField` must not offer a hint on one control and not the other) and telling a future reader not to remove it as dead code.

### F6 — The new `typecheck` script is not wired into CI

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: .github/workflows/ci.yml:20-21 vs package.json:9
- **Detail**: The plan's stated intent for the script was to "make the type gate a named script instead of a remembered incantation, since both phases gate on it". CI runs only `npm run lint` and `npm run build`, and `astro build` does **not** run `astro check` — so a type regression in `.astro` frontmatter or in an island still passes CI. The gate is named but not enforced. The plan did not ask for the CI wiring, so this is a gap in the plan as much as in the code.
- **Fix**: Add `- run: npm run typecheck` to `ci.yml`. It touches a file S-02 may also edit, so sequence it with the merge-order reconciliation rather than landing it blind.
- **Decision**: QUEUED — written up as `follow-ups/typecheck-in-ci.md` rather than landed here. `ci.yml` is a repo-wide gate rather than slice surface, and turning on a new gate while S-02 is mid-flight could fail that slice's PR on a rule it never agreed to. The follow-up records the exact one-line edit, its placement before `npm run build`, the 5-hint baseline not to "fix", and the open question of whether S-02's code passes `typecheck` at all.

### F7 — Same-date visits have no ordering tiebreaker

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/db/visits.ts:52; src/components/visits/VisitsManager.tsx:112,115
- **Detail**: `listVisits` orders by `visit_date` only, and both comparators are `localeCompare` on `visit_date`, which returns 0 for a same-date pair. `Array.sort` is stable, so order falls through to the array order — "appended last" after a create, but whatever Postgres happened to return after a reload. Two visits on the same date can swap position across a refresh. This is a visible consequence of the deliberate decision to permit duplicates.
- **Fix**: `.order("visit_date").order("created_at")` in `listVisits`, plus a `created_at` tiebreak in both comparators.
- **Decision**: FIXED — `listVisits` now orders by `visit_date` then `created_at`, and each group tiebreaks in its own direction (`||` falling through to `created_at`, ascending in Upcoming and descending in Past) so Past reads as the exact reverse of Upcoming. `created_at` is non-nullable `string` on `Row` (`database.types.ts:204`), so no narrowing is needed. Lint 0/0, typecheck 0/0.

### F8 — The date hint classifies unvalidated input

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/visits/VisitsManager.tsx:80 (via src/lib/dates.ts:47)
- **Detail**: `dateHint` string-compares the raw field value. `<input type="date">` can emit a 5-digit year (`"10000-01-01"`), which sorts below `"2026-08-30"` and renders "This date has already passed" for a date 8000 years out. Nothing wrong is ever stored — `z.iso.date()` rejects 5-digit years and the 1900–2100 refine blocks the save — so the defect is confined to advisory text.
- **Fix**: Gate `dateHint` on `visitInputSchema.shape.visit_date.safeParse(value).success` before classifying.
- **Decision**: FIXED — `dateHint` now returns `null` for any value the schema would reject, before reaching `isPast` / `isFarFuture`. One behavioural consequence worth knowing: a date just outside the range (e.g. `2101-01-01`) now draws no hint where it previously drew "more than two years away". That is the better reading — the value is invalid, not merely distant, and submitting it produces the specific "Enter a date between 1900 and 2100" error. Lint 0/0, typecheck 0/0.

### F9 — `today` never refreshes in a long-open tab

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/visits.astro:40; src/components/visits/VisitsManager.tsx:36
- **Detail**: `today` is resolved once at page render. A tab left open across midnight keeps a stale Upcoming/Past split and stale hints until reload. This is the direct and intended consequence of the "one today, resolved server-side, island never calls `new Date()`" rule the slice is built around — the code follows the convention correctly. Recorded as a known bound so S-04 does not rediscover it as a bug.
- **Fix**: None here. Note the bound in `follow-ups/visits-tests.md`, or hand it to S-04, which faces the same question for the dashboard.
- **Decision**: RECORDED — added to `follow-ups/visits-tests.md` under _Three things worth knowing_, naming it as a consequence of the convention rather than a defect, warning against tests that mistake classification for freshness, and handing the decision to S-04 for the dashboard. No code change.

### F10 — Three latent issues inherited unchanged from the S-01 pattern

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/visits/VisitsManager.tsx:154; src/lib/db/visits.ts:106; src/lib/db/visits.ts:52
- **Detail**: Three issues transcribed faithfully from `specialists.ts` / `SpecialistsManager.tsx` rather than introduced here. (a) `VisitsManager.tsx:154` — `await response.json()` sits inside the outer `try`, so a truncated success body lands in the generic catch and the user sees "Something went wrong" after a write that actually succeeded (`SpecialistsManager.tsx:102`, same shape). (b) `visits.ts:106` — `updated_at` is stamped from the Worker clock while `created_at` comes from the Postgres default, so clock skew can trip `visits_updated_at_not_before_created_at` and raise an unmapped `23514` surfacing as a 500 — logged, at least (`specialists.ts:109`, same). (c) `visits.ts:52` — `listVisits` is unbounded and the full result is serialised into the SSR HTML (`listSpecialists`, same). None is a regression; each is the pattern working as designed at MVP scale.
- **Fix**: Leave all three. If any is worth closing, it belongs in a pattern-wide change touching both slices, not in this one.
- **Decision**: QUEUED — written up as `follow-ups/inherited-pattern-latents.md`, one section each with the sibling location, the concrete failure, and the shape of a fix. Two carry a warning against the obvious wrong fix: (2) must not be closed by removing the client-side stamp (that is what keeps a caller-supplied `updated_at` out), and (3) must not be closed by adding a bare `.limit()` (a silently truncated history is worse than a slow one). No code change.
