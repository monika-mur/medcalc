<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Domain Schema Foundation

- **Plan**: `context/changes/domain-schema-foundation/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-11
- **Verdict**: REVISE → **SOUND after triage** (2026-08-13)
- **Findings**: 2 critical, 3 warnings, 3 observations — all triaged; 7 fixed in the plan, 1 deferred with an owner

## Triage summary (2026-08-13)

| Finding                                           | Decision                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| F1 — non-atomic 3-statement create                | FIXED — zero-dosage read semantics (user-originated, Fix C)             |
| F2 — no-procedural-code assertion never returns 0 | FIXED — schema-scoped queries + pgTAP pinned to `extensions`            |
| F3 — `updated_at` has no maintainer               | DEFERRED TO S-01 — columns kept, gap and three options recorded         |
| F4 — `getUserTimezone` untestable                 | FIXED — reader dropped from this change; fallback contract left to S-04 |
| F5 — no PK default                                | FIXED — `default gen_random_uuid()` on all five tables                  |
| F6 — user deletion blocked by RESTRICT            | FIXED — recorded in Migration Notes                                     |
| F7 — Phase 5 §3 had no criterion                  | FIXED — criterion + Progress 5.7 added                                  |
| F8 — missing `seed.sql`                           | FIXED — added as Phase 1 preflight item 4                               |

Post-triage dimension verdicts: End-State Alignment PASS, Lean Execution PASS, Architectural Fitness WARNING (F3 open by decision), Blind Spots PASS, Plan Completeness PASS.

Progress↔Phase contract re-verified after the edits: Phase 1 auto 9/manual 2, Phase 2 3/2, Phase 3 4/3, Phase 4 3/2, Phase 5 3/4 — all matched, zero stray checkboxes in phase bodies, one `## Progress` heading.

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots           | FAIL    |
| Plan Completeness     | FAIL    |

## Grounding

6/6 existing paths ✓, 4/4 new paths correctly absent ✓, 3/3 symbols ✓ (`supabase@2.23.4` at `package.json:52`, `project_id` at `config.toml:5`, FR-004 at `prd.md:87`), brief↔plan ✓.
`context/foundation/lessons.md` and `docs/reference/contract-surfaces.md` do not exist — those checks were skipped.
Step 3 codebase verification was performed directly rather than via a sub-agent, per a standing session instruction; the codebase is 25 source files.

## Context

F1 and F2 were both introduced by the 2026-08-11 plan amendment that removed the three database triggers (see `plan.md` → "Decided: no procedural database code"). They are not pre-existing weaknesses in the original plan.

## Findings

### F1 — Creating a medication is a 3-statement non-atomic operation

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details + Phase 1 §5/§6
- **Detail**: The plan invokes "PostgREST cannot wrap two inserts in one transaction" twice (`plan.md:28`, `plan.md:74`) to justify folding the liquid table into `medications`. But FR-004 (`prd.md:87`) requires quantity on hand **and** daily dosage at creation, and this schema stores neither on `medications` — dosage lives only in `dosage_changes` ("The row created with a medication is its initial dosage", `plan.md:153`), quantity only in `supply_events`. Creating a medication is therefore three sequential PostgREST calls. If call 2 or 3 fails, the result is a medication with no dosage and/or no quantity — and `medications` DELETE is denied by RLS (`plan.md:195`), so the partial row cannot be removed, only archived. The same argument that killed the two-table liquid design applies with more force to the product's primary create flow, and `plan.md:46` rules out RPC — the one tool that would make it atomic — partly on the grounds that "this schema no longer has a multi-statement create", which is factually wrong.
- **Fix A ⭐ Recommended**: Record the constraint and name S-02's protocol (create order `medications` → `dosage_changes` → `supply_events`; a medication with zero dosage rows is an incomplete draft the UI must complete or archive).
  - Strength: Preserves the no-procedural-code decision intact; gives S-02 a contract it can implement without re-planning.
  - Tradeoff: Partial creates remain possible; the app carries the recovery burden, and an archived zombie row is the worst case.
  - Confidence: HIGH — the failure mode and the RLS interaction are both verified against the plan text and `prd.md:87`.
  - Blind spot: Whether S-02's UI can realistically present a "complete this draft" state hasn't been designed.
- **Fix B**: Carve a single exception to the no-RPC rule for `create_medication(...)`.
  - Strength: Genuinely atomic; no partial state can exist at all.
  - Tradeoff: Reopens the no-procedural-code decision one turn after it was made, and needs its own rule for when the exception applies.
  - Confidence: MEDIUM — technically certain, but the precedent cost is a judgement call.
  - Blind spot: Whether other slices would then want their own RPCs.
- **Fix C (applied) — zero-dosage read semantics**: `daily_dosage` CHECK relaxed from `> 0` to `>= 0`, with 0 meaning "stopped, keep the history" — a state the schema previously forbade and that is distinct from FR-007 archival. A medication with no `dosage_changes` rows reads as 0, and one with no `supply_events` rows reads as quantity 0. A partial create therefore lands in a legal, visible, correctable state rather than an unremovable orphan, so the `medications` DELETE denial stops being a trap. Chosen over Fix A (no "draft" concept or cleanup protocol needed) and Fix B (no RPC exception).
  - Residual, recorded in the plan: this makes partial creates **harmless, not impossible** — S-02 must still surface a failed write, or the user sees 0 and never learns the dosage didn't save. Two further consequences captured: S-04 must return "lasts indefinitely" for a zero-dosage segment rather than dividing by zero, and FR-006's segmental arithmetic must treat `5 → 0 → 5` as three segments.
- **Decision**: FIXED (Fix differently — zero-dosage read semantics; originated by the user)

### F2 — The no-procedural-code assertion can never return 0

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 Success Criteria (`plan.md:236`) / Progress 1.7
- **Detail**: `select count(*) from pg_trigger where not tgisinternal` is unscoped — it counts every schema, and Supabase's own `auth`, `storage`, and `realtime` schemas ship user-level triggers. It will not be 0 on any Supabase stack, so criterion 1.7 blocks Phase 1 as written. The companion `pg_proc … nspname='public'` check has a second problem: it counts extension-owned functions, and Phase 2 requires pgTAP — `create extension pgtap` without `with schema extensions` lands ~1000 functions in `public`, retroactively breaking 1.7 the moment Phase 2 starts.
- **Fix**: Scope both queries to `public` and exclude extension-owned objects via `pg_depend` where `deptype = 'e'`; add "pgTAP is installed `with schema extensions`" to Phase 2's contract.
- **Decision**: FIXED (Fix in plan) — criterion and Progress 1.8 rewritten with both scopings and a note on why each is load-bearing; pgTAP schema pin added to the Phase 2 overview; Testing Strategy bullet updated.

### F3 — `updated_at` has no maintenance story now that triggers are gone

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §3, §4, §7
- **Detail**: `specialists`, `medications`, and `visits` all carry `updated_at` (`plan.md:124`, `:132`, `:182`). The conventional maintainer is a `moddatetime` BEFORE UPDATE trigger, which principle 4 (`plan.md:56`) forbids. No repository layer exists to centralise it — `plan.md:40` puts that explicitly out of scope. So `updated_at` will equal `created_at` forever unless every future update path remembers to set it, and nothing in the plan says that it must. This is a direct consequence of the trigger removal that the amendment didn't follow through on.
- **Fix A ⭐ Recommended**: Drop `updated_at` until a consumer needs it.
  - Strength: Consistent with the plan's own stance on current-state views (`plan.md:39`) — design against a real consumer rather than guess. Nothing in v1 reads it.
  - Tradeoff: Adding it back later is a migration, and backfilled rows would carry a synthetic value.
  - Confidence: HIGH — no reader exists anywhere in the plan or the FRs.
  - Blind spot: None significant.
- **Fix B**: Keep it and mandate explicit `updated_at = now()` on every write path, recorded in the Phase 4 CLAUDE.md conventions.
  - Strength: Column is there when a history or sync feature wants it.
  - Tradeoff: Relies on discipline in exactly the way principle 3 (`plan.md:55`) says the schema should not.
  - Confidence: MEDIUM — works, but it's the failure mode the plan elsewhere designs against.
  - Blind spot: No test would catch a path that forgets it.
- **Decision**: DEFERRED TO S-01 (Fix differently) — columns kept, since adding them later is a migration and this is the cheap moment. The gap is now recorded explicitly in `plan.md` → Critical Implementation Details and in the brief's Open Risks, naming S-01 as the owner (it writes the first real update path) and listing the three live options: stock `moddatetime` as a narrow extension exception, explicit assignment plus a test, or dropping the columns.

### F4 — `getUserTimezone` ships with no caller and no test home

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 3 §5 + criterion 3.6
- **Detail**: Phase 3 §5 adds `src/lib/timezone.ts`, but nothing in this change calls it — the calculation engine is out of scope (`plan.md:41`). Criterion 3.6 asserts "`getUserTimezone` falls back to the default", yet there is no code path to exercise it. Worse, Phase 4 §1 confines Vitest's include glob to `tests/integration/**` (`plan.md:398`), so a plain unit test for this function would not even run.
- **Fix**: Widen the Phase 4 glob to also match `src/**/*.test.ts` and add a three-case unit test (real zone / empty string / absent), or reduce criterion 3.6 to "signup succeeds and stores no timezone".
- **Decision**: FIXED (Fix differently — reader dropped from this change). An earlier attempt at the widen-glob-plus-unit-test fix was applied and then reverted at the user's request; Phase 4 is back to five sections with the include glob at `tests/integration/**`. Instead, Phase 3 §5 (`src/lib/timezone.ts`) is removed entirely — Phase 3 now captures the timezone and stops. A new subsection, "The fallback has no owner in this change — S-04 writes it", records the four things S-04 inherits: absent is a normal state, the intended default is `Europe/Warsaw`, the reader belongs in exactly one place, and it costs no query. Criterion 3.6 and Progress 3.6 now assert "stores no `timezone` key at all" — checkable without the reader.

### F5 — No primary-key default stated for any table

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3–§7
- **Detail**: Every table contract writes `id uuid PK` (`plan.md:124`, `:132`, `:155`, `:163`, `:182`) with no default. Omitted, `id` becomes required on every insert and surfaces as required in the generated types, propagating into Phase 4's tests and every downstream slice.
- **Fix**: State `id uuid primary key default gen_random_uuid()` in each of the five contracts.
- **Decision**: FIXED (Fix in plan) — all five contracts now read `id uuid PK DEFAULT gen_random_uuid()`. Phase 1 §1 additionally notes that the migration's extensions step is expected to be empty: `gen_random_uuid()` is Postgres 13+ core and `config.toml:36` pins major_version 17, so `pgcrypto` must not be enabled out of habit.

### F6 — Deleting a user is impossible once they own a medication

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §3 vs §4/§7
- **Detail**: `specialists.user_id → auth.users ON DELETE CASCADE` (`plan.md:124`) collides with the `ON DELETE RESTRICT` composite FKs from `medications` (`plan.md:137`) and `visits` (`plan.md:182`). Deleting an auth user cascades into `specialists`, which RESTRICT then blocks — so the delete fails outright. Not a v1 requirement (the PRD has no account-deletion FR; closest is `prd.md:117` on isolation), but it will bite the first time someone deletes a test user in Studio.
- **Fix**: Record it in Migration Notes as a known consequence, to be revisited if account deletion becomes a requirement.
- **Decision**: FIXED (Fix in plan) — recorded in Migration Notes, framed as a consequence of the per-entity deletion rule rather than an oversight, with the development workaround (delete medications and visits first) and the note that a future account-deletion feature should impose a deletion order rather than loosen RESTRICT.

### F7 — Phase 5 §3 has no success criterion

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §3 (`plan.md:473-479`)
- **Detail**: "Record the outcome" in `change.md` has no matching bullet in Phase 5's Success Criteria and no Progress item, while §1 and §2 both do. The GitHub/Linear issue F-01e does carry it as an acceptance criterion, so the plan is now the less complete of the two.
- **Fix**: Add manual criterion and Progress item 5.7 — "Migration filename, date, and project ref recorded in change.md".
- **Decision**: FIXED (Fix in plan) — Phase 5 manual criterion and Progress item 5.7 both added; the plan now matches issue F-01e's acceptance criteria.

### F8 — `supabase/seed.sql` is referenced by config but absent

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 preflight / criterion 1.2
- **Detail**: `supabase/config.toml:60-65` sets `[db.seed] enabled = true` with `sql_paths = ["./seed.sql"]`, and `supabase/seed.sql` does not exist. Criterion 1.2 depends on `db reset` exiting 0. Whether the CLI treats a non-matching path as a warning or an error was **not** verified — flagged as unconfirmed rather than asserted.
- **Fix**: Confirm during the Phase 1 preflight; if it errors, create an empty `seed.sql` or set `enabled = false`.
- **Decision**: FIXED (Fix in plan) — added as the fourth Phase 1 preflight item, naming both remedies and stating plainly that the warning-vs-error behaviour was not verified during planning.
