<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Manage Medications (S-02)

- **Plan**: `context/changes/manage-medications/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-08-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Success criteria re-verified

| Check                                     | Result                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `npm run lint`                            | 0 errors, 0 warnings                                                    |
| `npm run build`                           | Complete (dev server not running)                                       |
| `npx astro check`                         | 0 errors, 0 warnings, 5 hints (all pre-existing, in `eslint.config.js`) |
| `npx supabase test db`                    | 70/70 assertions, PASS                                                  |
| `npm test`                                | 15/15 tests                                                             |
| `console.` in `src/lib/db/medications.ts` | exactly 1 (the `logDbError` helper)                                     |
| `.eq("user_id"` in the data module        | 0                                                                       |
| `.upsert(` calls                          | 0 (the one grep hit is prose in a docstring at `:310`)                  |
| `"Sign in to continue"` across the routes | 6, matching the 6 exported handlers                                     |
| Request-body spreads in routes            | 0                                                                       |
| Emitted routes                            | 5 — `_shared.ts` is correctly excluded from routing                     |

The local stack already carried this branch's migration (`dosage_changes_delete_uncommitted_own` present in `pg_policy`), so the database checks ran without a `db:reset` claim and the sibling S-03 worktree was left untouched.

Every planned file is present and matches its stated intent: the Phase 1 migration relaxes the DELETE predicate to `>= current_date` and renames the policy; the four zod schemas and the data module carry the `Result<T>`, error-kind, `logDbError` and chained-`.select()` conventions from `src/lib/db/specialists.ts`; the five routes are thin adapters that each delegate one call; the page SSRs both lists and the island owns every mutation. No planned item is missing.

## Findings

### F1 — Create reports success with a dosage the user did not ask for

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/db/medications.ts:238-259
- **Detail**: When the `medications` insert lands but the follow-on `dosage_changes` (or `supply_events`) insert fails, the error is logged and swallowed, `createMedication` returns 201, and the island shows "Metformin added." while the new row reads `Dosage: 0 / day` with a **Not used** badge — or `On hand: 0` with **Out of stock**. The user entered dosage 2 and quantity 30. The plan authorises this ("a partial result is reported as success with whatever landed") on the grounds that dosage 0 is a legal domain state, which is true of the _state_ but not of the _report_: `setDosage` spends an entire compensating insert so that "a 500 honestly means nothing changed", and the create path accepts the opposite asymmetry. Nothing tells the user which of the two values failed to record.
- **Fix A ⭐ Recommended**: Have `createMedication` report which follow-on insert failed, and let the island say so in the existing notice region ("Metformin added, but its starting dosage was not recorded — set it with Change dosage").
  - Strength: Keeps the created row, which a 500 would misreport in the other direction, and names the exact repair the user can already perform from the row's own controls.
  - Tradeoff: `Result<T>` gains a partial shape that the module, the collection route and the island all have to carry.
  - Confidence: HIGH — the notice region, the per-row Change dosage panel and the Add refill panel already exist, so the remedy path needs no new UI.
  - Blind spot: There is no warning token in `:root` (only success/error), so the notice would have to render in the error tone on a 201.
- **Fix B**: Leave as planned and record it as an accepted risk.
  - Strength: No code change; the failure needs a database error, and `logDbError("create.dosage", …)` now puts that in the Workers log where S-01 left nothing.
  - Tradeoff: A user-visible wrong value under a success message, with no signal to the user at all.
  - Confidence: MEDIUM — depends on treating a post-insert failure as rare enough to ignore.
- **Decision**: ACCEPTED (Fix B) — left as planned. The partial create stays a reported success; the failure is visible in the Workers log through `logDbError`, which is where S-01 left nothing. Risk accepted at this volume.

### F2 — A failed list load renders a contradictory empty state

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/medications.astro:56-78
- **Detail**: `loadFailed` gates only the error paragraph; the island renders regardless and, with an empty `initialMedications`, prints "No medications yet. Add the first one above." directly beneath "Your medications could not be loaded." If only the medication read failed, `specialists` is populated, so `canAdd` is true and the add form is live — the user can add a second copy of a medication they already track. S-02 amplifies the S-01 shape it inherits: a duplicate medication drags a duplicate ledger with it, and `medications` has no DELETE policy, so the only cleanup is archival. When both reads fail, the island instead points at an add form that is not rendered.
- **Fix**: Pass `loadFailed` into `MedicationsManager` and use it to replace the "No medications yet" copy and suppress the add form; apply the same to `specialists.astro` so the two pages stay one pattern.
- **Decision**: FIXED — `medications.astro` now passes `loadFailed` to the island; the island takes it as a required prop, folds it into `canAdd` so the add form is withheld after a failed read, and branches the empty-state copy so it no longer asserts "No medications yet" when that is the one thing the page could not establish. Lint 0/0 and `astro check` 0 errors after the change. The `specialists.astro` half of the fix was **not** applied here — it is an S-01 file and would put an unrelated slice's edit into this PR; queued in `follow-ups/review-fixes.md`.

### F3 — `updated_at` is stamped from the Worker clock on two more write paths

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/db/medications.ts:288, src/lib/db/medications.ts:454
- **Detail**: `created_at` comes from Postgres `now()` while `updated_at` is written from the Worker's own clock, and `20260821182457` added `check (updated_at >= created_at)`. A Worker clock behind Postgres by more than the interval between create and first edit raises `23514`, which collapses to `unknown` and surfaces as a 500 "Could not save the medication". This is S-01's known pattern — `CLAUDE.md` → _Domain schema_ records that `updated_at` has no maintainer and names S-01 as the owner of the fix — and S-02 correctly follows it _and_ now logs the code, which is what `lessons.md` → _Log the database error before collapsing it to a domain kind_ asks for. The observation is only that this slice doubles the number of write paths carrying the exposure, so the S-01 follow-up now has a wider blast radius than when it was filed.
- **Fix**: No change in this slice — record it against the existing S-01 `updated_at` follow-up so whoever gives the column a maintainer knows `updateMedicationDetails` and `setArchived` are also on the list.
- **Decision**: FIXED (recorded, no code change) — no S-01 `updated_at` follow-up existed; the ownership note lived only in `CLAUDE.md`. Opened one in `follow-ups/review-fixes.md` naming all three call sites (`updateSpecialist`, `updateMedicationDetails`, `setArchived`) and the constraint that the no-trigger property rules out the obvious `before update` fix without re-planning.

### F4 — `_shared.ts` is an unplanned file, and `readId` now exists twice

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/medications/\_shared.ts:15
- **Detail**: The plan's Phase 3 lists five route files; this sixth module is not among them. It is benign and well argued in its own docstring — four of the five routes are addressed by id and would otherwise carry four copies of the uuid guard — and the `_` prefix does keep Astro from routing it (confirmed against the build output: exactly the five expected routes are emitted). Two smaller points remain. It sits under `src/pages/`, where every other file is a route and where the exclusion depends on a filename convention, while the project already has `src/lib/api/` for shared API helpers (`json.ts`). And `src/pages/api/specialists/[id].ts:15` still holds its own copy, so the same guard is now defined twice with no link between them.
- **Fix**: Move it to `src/lib/api/params.ts` and have S-01's route import it too, collapsing both copies; record the file in the plan as an addendum either way.
- **Decision**: FIXED — `_shared.ts` deleted; `readId` now lives at `src/lib/api/params.ts` beside the JSON contract it is a peer of. The four medications routes and `src/pages/api/specialists/[id].ts` all import it, so the guard has one definition instead of two and S-01's local `z`/`idSchema` pair is gone. Import order was normalised across all five routes to match the house sort. Re-verified: lint 0/0, `astro check` 0 errors, build complete, and the emitted route set is unchanged (5 medications + 2 specialists, no route for the helper). This is the one place the triage touched an S-01 file — a pure refactor with no behaviour change, unlike F2's mirror, which would have altered S-01's UI and was queued instead.

### F5 — The ledger embed is unbounded

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/db/medications.ts:89-90
- **Detail**: `MEDICATION_SELECT` embeds every `dosage_changes` and every `supply_events` row, so a page load transfers each medication's entire history and every mutation re-transfers one medication's history through `readMedication`. Both tables are append-only by design, so this grows without bound and nothing caps it — ten medications with a daily dosage entry over three years is roughly eleven thousand rows per page load. The plan discloses this as deliberate and names `listMedications` as the S-04 replacement point when the current-state views land, and it is immaterial at the PRD's volume; it is recorded here so the S-04 plan inherits it as a requirement rather than rediscovering it.
- **Fix**: No change in this slice — carry it into the S-04 current-state-views plan as an explicit input.
- **Decision**: FIXED (recorded, no code change) — written into `follow-ups/review-fixes.md` as an explicit S-04 input, including the requirement that `listMedications` and `readMedication` keep their signatures across the swap and the three fold cases (future-dated row, `5 → 0 → 5` series, no child rows at all) that a SQL rewrite is most likely to get wrong.
