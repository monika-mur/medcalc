<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Manage Medications (S-02)

- **Plan**: `context/changes/manage-medications/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-27
- **Verdict**: **SOUND** (as first reviewed: REVISE — all five findings fixed during triage)
- **Findings**: 1 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | As reviewed | After triage |
|-----------|-------------|--------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

12/12 claimed paths exist; 4/4 paths the plan says are absent are absent; policy set, nav, and route symbols verified; brief-to-plan consistent.

Confirmed against the codebase and **not** turned into findings: the `dosage_changes` policy set and the `> current_date` DELETE predicate; the `supply_events` CASE CHECK (an `adjustment` requires both count columns NULL and permits a negative delta); the 70 pgTAP assertions (13+18+25+14, no `no_plan()`) and 15 integration tests; that `append_only.test.sql:29-31` seeds only `current_date` plus or minus 10 days, so the relaxation breaks no assertion; that no test references the policy name, so the rename is safe; and that the `startsWith` check on `PROTECTED_ROUTES` does **not** accidentally match `/api/medications/*`, because that path begins `/api/`.

## Findings

### F1 — DELETE-then-INSERT can destroy an existing dosage with no compensating write

- **Severity**: CRITICAL
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details; Phase 2 section 2, `setDosage`
- **Detail**: `setDosage` DELETEs today's `dosage_changes` row then INSERTs the replacement. If the INSERT fails after the DELETE lands, the user's previous dosage is gone. `listMedications` reads "no row means 0" and the status precedence maps `current_dosage === 0` to `not_used`, so the loss renders as the deliberate "I stopped taking this" state. The route returns 500, but a reload shows a plausible row and nothing says a value was deleted. The plan noted the non-atomic window existed but never stated this consequence, and it was absent from Open Risks. Sharper than the three-insert create the plan named as its largest risk: that leaves a *new* row at 0, this destroys data the user already had.
- **Fix A (Recommended)**: Capture the old row on the DELETE, re-insert on INSERT failure.
  - Strength: `.delete().select("daily_dosage")` returns exactly what was removed, and DELETE-with-RETURNING is already proven at `src/lib/db/specialists.ts:136-147`. Re-inserting on failure makes the 500 honestly mean "nothing changed".
  - Tradeoff: The compensating INSERT can itself fail; it needs its own log line.
  - Confidence: HIGH — no schema or policy change.
  - Blind spot: None significant.
- **Fix B**: Leave the sequence, make the failure legible in island copy.
- **Decision**: FIXED via Fix A — Critical Implementation Details now mandates the reversible DELETE; Phase 2 section 2 specifies the capture and compensating re-insert; criterion and Progress `2.7` added; `plan-brief.md` gained the matching Open Risks bullet.

### F2 — 409 for `no_specialist` inverts the repo's meaning of 409, and contradicts the parallel S-03 plan

- **Severity**: WARNING
- **Impact**: HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 sections 1 and 2
- **Detail**: `CLAUDE.md:54` defines 409 as "blocked by references", and the only 409 in the codebase is `deleteSpecialist` refusing a delete because children RESTRICT it (`src/lib/db/specialists.ts:135-141`, `src/pages/api/specialists/[id].ts:76-78`). The plan reused 409 for the inverse — a create whose `specialist_id` names a row that does not exist or is not the user's. Same SQLSTATE `23503`, opposite meaning. The parallel S-03 plan maps the identical situation to 400 with `fieldErrors.specialist_id` and reasons it out explicitly. Both cannot be right; whichever merged second would leave two statuses for one class of error.
- **Fix (Recommended)**: Adopt S-03's mapping — 400 with `fieldErrors.specialist_id`.
  - Strength: Both islands render the specialist as a `select`, so a field error lands where the user can act on it, and 409's definition stays unambiguous.
  - Tradeoff: Plan text and one manual criterion needed editing.
  - Confidence: HIGH — verified against the route code and the written contract.
- **Decision**: FIXED — five call sites moved to 400 (the `MedicationErrorKind` definition, both Phase 3 route contracts, the Phase 3 manual criterion, Progress `3.6`), with the reasoning and a do-not-restore-this-to-409 note recorded on the error-kind line.

### F3 — The riskiest query in the slice is never executed before Phase 3

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 section 2, `listMedications`; Phase 2 Implementation Note
- **Detail**: `listMedications` embeds three child relations at once — `specialists` through a composite FK, plus row-level `dosage_changes` and `supply_events`. No existing code does this; `listSpecialists` (`src/lib/db/specialists.ts:42-59`) folds PostgREST `count` aggregates, and its own comment at `:43-45` records that the composite-FK embed was empirically verified against the local stack rather than assumed. Phase 2's Implementation Note said the phase needed no stack claim, so the first execution was Phase 3's manual walk — and Phase 2's automated criteria (lint, build, two greps) cannot catch a PostgREST "Could not embed" 300.
- **Fix**: Add a Phase 2 manual criterion that runs `listMedications` against the local stack; narrow the no-stack-claim note to the schema and validation work.
  - Strength: Catches the highest-rework-risk claim a phase earlier, for a few minutes' cost.
  - Tradeoff: Phase 2 now needs the stack in this worktree's shape.
  - Confidence: HIGH — the precedent comment proves this embed class already needed verification once here.
- **Decision**: FIXED — criterion added with the reasoning inline; Implementation Note narrowed; Progress `2.8` added.

### F4 — S-02 and S-03 edit the same files; neither plan knew it

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 sections 3 and 4
- **Detail**: Both plans coordinated carefully over the shared Supabase stack and not at all over source files. A trial merge of the two branches **already failed at review time**, before either had written code: a content conflict in `context/foundation/roadmap.md`, because both flipped their own row from `proposed` to `planning` on adjacent lines. Still ahead: `src/middleware.ts:4` is a single-line array literal both slices append to (unavoidable conflict), `src/components/Topbar.astro:4-7` takes two entries at the same insertion point, and both append to the tail of the `## Domain schema` section of `CLAUDE.md`. S-02 additionally specified a nav position a merge will not preserve.
- **Fix**: Name the collision in both plans and decide merge order; the second slice re-applies its own one-liners by hand and verifies both routes and both nav entries survive.
- **Decision**: FIXED — an identical `## Parallel-slice coordination` section added to both plans, with the file table, which conflict is certain, and the re-apply rule. Later extended to five files when F6(c) in the S-03 review took `src/components/form/FormField.tsx` into scope.

### F5 — Four accuracy defects in the plan document

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 Overview; Phase 3 criteria; Progress 1.7; Phase 2 section 2
- **Detail**:
  (a) Phase 3's Overview said "Four route files"; the section specifies five, as does `plan-brief.md`.
  (b) The auth-guard grep criterion did not do what it claimed. Bash without `globstar` expands a double star as a single one, so the glob matched only the nested files and skipped `index.ts` and `[id].ts` — verified by running the same glob against the existing specialists directory, where it matches nothing at all. And `grep -c` over multiple files prints per-file counts, never a total. This was the only one of the four with functional consequence: an automated gate that would pass while checking almost nothing.
  (c) Progress `1.7` said to write `follow-ups/deferred-tests.md` during Phase 1 — the file was already committed on the branch.
  (d) Phase 2 presented writing `form` explicitly as required; the column carries `not null default 'solid'` (`20260813185255_domain_schema.sql:64`). The constraint that actually matters is that a solid requires all four liquid columns NULL, `opened_on` included.
- **Fix**: Correct (a), (c) and (d) as text; replace (b) with a recursive form.
- **Decision**: FIXED — all four. (b) became a `grep -rn ... | wc -l` against six handlers, with the glob trap noted inline so it is not reintroduced.

## Notes

Two extra Progress checkboxes remain by design — `1.7` (the already-written follow-up, now ticked) and `4.17` (the `CLAUDE.md` rules). Both track real deliverables that never had a stated Success Criterion; the mechanical contract requires every criterion to have a checkbox, not the reverse.

Not verified during this review: none of these edits have been exercised against a running stack — they are plan changes, and the criteria they add are what will exercise them.
