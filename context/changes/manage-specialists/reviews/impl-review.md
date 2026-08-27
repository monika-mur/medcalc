<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Manage Specialists (S-01)

- **Plan**: `context/changes/manage-specialists/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-08-26 (findings) · 2026-08-27 (triage)
- **Verdict**: NEEDS ATTENTION → **all findings triaged**
- **Findings**: 0 critical, 4 warnings, 3 observations
- **Triage**: 4 fixed (F1, F3, F4, F7), 1 fixed + recorded as a rule (F1), 2 skipped (F2, F6)

## Triage — 2026-08-27

| ID  | Decision                 | Outcome                                                                                         |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| F1  | FIXED + ACCEPTED-AS-RULE | `logDbError` helper in `specialists.ts`; lesson appended to `lessons.md`                        |
| F2  | SKIPPED                  | Diagnosable via F1's log; prevention deferred, `updated_at: "now"` named as the fix if it fires |
| F3  | FIXED                    | F4 stamped resolved in `domain-schema-foundation/follow-ups/review-fixes.md`                    |
| F4  | FIXED (Fix A)            | `follow-ups/push-grants-migration.md` created                                                   |
| F5  | FIXED                    | `follow-ups/specialists-tests.md` created                                                       |
| F6  | SKIPPED                  | Reorder-on-reload only; revisit if S-02/S-03 repeat the split                                   |
| F7  | FIXED                    | `disabled={pending}` on the per-row Edit button                                                 |

**Re-verified after the two code fixes** (`specialists.ts`, `SpecialistsManager.tsx`):

| Check              | Result                                        |
| ------------------ | --------------------------------------------- |
| `npm run lint`     | 0 errors, 0 warnings                          |
| `npx astro check`  | 0 errors, 0 warnings, 5 hints (pre-existing)  |
| `npm run build`    | Complete, server built in 15.3s               |
| `npm test`         | 15/15 passed, 1 file                          |
| `npm run db:test`  | 70/70 passed, 4 files                         |
| `npm run db:types` | "no change" (11620 bytes), `git status` clean |

**The stack-dependent gap is closed.** The two suites were initially skipped
because Docker was unavailable in the triage session and nothing was listening on
`54321`. Docker was started and `npx supabase start` brought the stack up in the
same session; both suites then ran green, along with `db:types`. Nothing in this
report now rests on an unverified check.

A dev server was confirmed **not** running before `npm run build`, per
`lessons.md` → _Never run a production build against a live dev server_.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Success criteria — re-verified this session

| Check                            | Result                                       |
| -------------------------------- | -------------------------------------------- |
| `npm run lint`                   | 0 errors, 0 warnings                         |
| `npx astro check`                | 0 errors, 0 warnings, 5 hints (pre-existing) |
| `npm run build`                  | Complete, server built in 21.5s              |
| `npm test`                       | 15/15 passed                                 |
| `npm run db:test`                | 70/70 passed                                 |
| `npm run db:types`               | "no change", `git status` clean              |
| Dark-theme scan (Phase 2 step 4) | No matches under `src/` outside `ui/`        |

All 44 Progress rows are `[x]` with commit SHAs. Manual rows carry substantive
per-step evidence in `change.md` rather than bare ticks — no rubber-stamping
found.

## Findings

### F1 — Every database error is discarded, so a 500 leaves no trace anywhere

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/db/specialists.ts:36`, `:62`, `:100`, `:123`
- **Detail**: Each function does `if (error) return { ok: false, error: "unknown" }` and drops the `PostgrestError` object entirely — code, message, details, hint. The routes then answer `500 "Could not save the specialist"`. There is no `console.error` anywhere in `src/` (grep: zero matches), so a production 500 on this path produces nothing in Workers logs. The plan's rule is "a raw Postgres message never reaches a _response_" — that is correctly implemented, but it was read as "never observe the error at all". Any incident on this path is undiagnosable, and F2 below is precisely the failure it would hide.
- **Fix**: Log the discarded error before collapsing it to `unknown` — `console.error("specialists.update", { code: error.code, message: error.message })` in each `unknown` branch. `no-console` is `warn`, not `error`, in `eslint.config.js`, so this does not break `npm run lint`; add an `eslint-disable-next-line no-console` if a clean run matters.
  - Strength: Restores the only observability the Worker has, without changing a single response body — the contract in `CLAUDE.md` → _API conventions_ stays exactly as specified.
  - Tradeoff: Four small edits, and a deliberate exception to the repo's `no-console` preference that should be noted where it is taken.
  - Confidence: HIGH — `console.error` is the documented log sink for Cloudflare Workers, and the lint rule is a warning, verified in `eslint.config.js`.
  - Blind spot: Whether Workers observability is actually enabled on this deployment (`wrangler.jsonc` was not checked in this review).
- **Decision**: FIXED + ACCEPTED-AS-RULE: _Log the database error before collapsing it to a domain kind_ — blind spot closed during triage: `wrangler.jsonc:12` sets `observability.enabled: true`, so the log sink exists. Applied via one module-local `logDbError` helper rather than four inline calls, because `no-console` is `warn` and every phase is verified at "0 errors, 0 warnings"; a single scoped `eslint-disable-next-line` keeps that bar. The `23503` branch in `deleteSpecialist` was restructured to return before the log — a delete blocked by references is a domain outcome, not an incident. Re-verified: lint 0/0, `astro check` 0 errors / 0 warnings / 5 pre-existing hints.

### F2 — `updated_at` comes from the app clock while `created_at` comes from Postgres

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/db/specialists.ts:94`
- **Detail**: `updateSpecialist` stamps `new Date().toISOString()` from the runtime, while `created_at` is Postgres `now()`. Phase 1's `check (updated_at >= created_at)` therefore compares two independent clocks. If the runtime's clock runs behind the database's by δ, every edit within δ of the create raises `23514`, which `:100` maps to `unknown` → **500 "Could not save the specialist"** — and, per F1, with nothing logged. In production that is a Cloudflare Worker against Supabase cloud. `change.md` → _Noted for `/10x-impl-review`, not actioned_ raised this and deliberately left it for this review. The window is normally milliseconds and it did not fire in any run, but the constraint that was added to protect the column is the thing that fails the user.
- **Fix A ⭐ Recommended**: Map `23514` to its own error kind and keep the app clock. Add `const CHECK_VIOLATION = "23514"` and return a distinct kind from `updateSpecialist`; the route answers 500 with a message naming the constraint, and F1's log line carries the code.
  - Strength: Small, local, and provable by reading — it does not change what value is written, so nothing about the F8 closure or the `.update({...input})` rule moves. Combined with F1 it turns an unexplained 500 into a diagnosable one.
  - Tradeoff: Does not prevent the failure, only makes it legible. The user still cannot save.
  - Confidence: HIGH — same shape as the `23503` mapping already in `deleteSpecialist:123`.
  - Blind spot: None significant.
- **Fix B**: Eliminate the second clock — send `updated_at: "now"`, which Postgres parses as the special timestamp input and resolves to transaction time, so both columns come from the database.
  - Strength: Removes the failure class entirely rather than reporting it, and still never accepts a caller-supplied value (zod strips it long before this point).
  - Tradeoff: A bare `"now"` string reads as a bug at the call site and depends on Postgres's special date/time input parsing surviving the PostgREST round-trip; it needs a comment and a manual re-walk of criterion 3.6.
  - Confidence: MED — the Postgres behaviour is documented, but it has not been verified through supabase-js against this stack, and with §5's tests deferred nothing would catch it silently writing a literal.
  - Blind spot: Unverified end-to-end here; also unverified whether `astro check` accepts the string against the generated `Update` type.
- **Decision**: SKIPPED — millisecond window, never observed firing, and F1's fix now puts the `23514` code in the Workers log, so the failure is already diagnosable without Fix A. Fix B's remaining value was prevention, at the cost of an unverified `"now"` literal on a path whose tests are deferred. Left as-is deliberately; if it ever fires, the log line names the constraint and Fix B is the answer.

### F3 — F4's follow-up entry still reads as open work, and carries a count this slice corrected

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/domain-schema-foundation/follow-ups/review-fixes.md:79-105`
- **Detail**: The plan folds F-01 review finding F4 into this slice, and `20260821182457` implements it in full (16 policies rewritten, both `user_id` indexes created — verified in the migration and by the 70/70 pgTAP run). But the F4 section in the sibling change's follow-ups file was never stamped: it still opens with "**What to do**, in a follow-up migration" and still says "There are 23 bare occurrences", a number this slice measured and corrected to **19** (`change.md` → _Automated (1.1–1.5)_). A reader picking up the F-01 follow-ups will queue work that already shipped, against a count that is wrong.
- **Fix**: Stamp the F4 section as resolved by `20260821182457` in `manage-specialists`, note the corrected count of 19 policy predicates, and leave the "also noted" partial-index remark open since that part was not addressed.
- **Decision**: FIXED — added a `**Status**: ✅ RESOLVED 2026-08-25` block to the F4 section in `domain-schema-foundation/follow-ups/review-fixes.md`, naming the migration and the 70/70 verification. The wrong count is corrected but left visible (struck through in prose rather than deleted) so a reader who remembers "23" sees why it changed. The numbered list is marked done; the "Also noted" partial-index remark is explicitly re-flagged as ⏳ still open. Also noted there that the migration is local-only, so the performance rewrite is not live on cloud.

### F4 — The `anon` revoke exists only locally, and nothing tracks pushing it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `supabase/migrations/20260821182457_grants_updated_at_guard_and_rls_perf.sql:84-88`
- **Detail**: Step 1.8 found the cloud project granting all four DML privileges to `anon` on all five domain tables, and the slice's own analysis calls that a defence-in-depth gap: "production is protected by one mechanism where the design intends two, and the anon key ships in the client bundle." The `revoke` that closes it is in a migration `change.md` records as **local-only** (step 1.9), CI does not apply migrations (F9 is still queued), and the plan's non-goals correctly exclude the push. That is all consistent — but there is no entry anywhere queuing it. `follow-ups/` holds only `signed-in-landing.md`, and once `/10x-archive` runs, the only record of the outstanding push lives in an immutable archive folder that the follow-up files are meant to replace. The pgTAP `anon` assertions will keep passing locally while production stays at 10 rows.
- **Fix A ⭐ Recommended**: Add a `follow-ups/push-grants-migration.md` entry naming `20260821182457`, what the revoke changes on cloud, the verification query from `plan.md` → _Verifying cloud_, and the expected before/after row counts (10 → 5).
  - Strength: Costs one file and makes the outstanding production change survive archival, which is exactly what the follow-ups convention exists for.
  - Tradeoff: None beyond the file itself; the push stays a deliberate manual step, as planned.
  - Confidence: HIGH — mirrors how F2/F3/F9/D-01 are already tracked for `domain-schema-foundation`.
  - Blind spot: None significant.
- **Fix B**: Push the migration now and record the result in `change.md`.
  - Strength: Closes the real gap rather than tracking it.
  - Tradeoff: Contradicts the plan's stated non-goal, needs the proxy/TLS setup, and a cloud `revoke` is the one part of this migration that is not a no-op there — it deserves its own deliberate session, not a review triage step.
  - Confidence: MEDIUM — expected safe (no policy is `to anon`, RLS verified holding), but unrehearsed against cloud.
  - Blind spot: Whether anything outside this repo authenticates to those tables as `anon`.
- **Decision**: FIXED via Fix A — created `follow-ups/push-grants-migration.md`. One correction applied while writing it: the verification query in `plan.md` → _Verifying cloud_ filters `grantee = 'authenticated'` alone, so it returns 5 both before and after the push and cannot measure this change. The follow-up carries a `grantee in ('anon','authenticated')` variant with the 10 → 5 expectation, plus the "why it is a defence-in-depth gap and not a breach" analysis restated so it is not re-litigated, and a post-push app re-check since the `revoke` is the one non-idempotent statement against production.

### F5 — Phases 3–4 ship with no automated coverage and the test hand-off is untracked

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `context/changes/manage-specialists/follow-ups/` (absent entry)
- **Detail**: Test authoring was removed from the slice by explicit decision on 2026-08-26, and the plan documents the cost honestly in _Accepted gap_. This is recorded scope reduction, not drift — no action is being asked for on the decision itself. The gap is only in where the residue lives: the hand-off contract sits in `plan.md` Phase 3 §5, and `follow-ups/` contains only `signed-in-landing.md`. After archival, the specification the test skill is supposed to inherit is inside an immutable folder rather than in the queue that is read for outstanding work. The two named-as-load-bearing assertions (a caller-supplied `updated_at` is ignored; a zero-rows match surfaces as 404) currently have no automated guard at all — confirmed by reading the module and routes, which implement both correctly today.
- **Fix**: Copy Phase 3 §5's contract into `follow-ups/specialists-tests.md`, keeping the two priority assertions flagged first.
- **Decision**: FIXED — created `follow-ups/specialists-tests.md` carrying §5's contract verbatim, the two priority assertions first with the reason each has no database-level fallback, and the fixture note. States explicitly that the deferral decision is not being reopened. Two forward-references added that §5 could not have known: the F1 `logDbError` line a tripped error now prints, and the F2 `23514` skew as the explanation for a future flake (with `updated_at: "now"` as the fix, not a loosened assertion).

### F6 — Client re-sort uses `localeCompare`; the server orders by Postgres collation

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/specialists/SpecialistsManager.tsx:37`
- **Detail**: `listSpecialists` orders with `.order("name")` (database collation); after an add or an edit the island re-sorts with `a.name.localeCompare(b.name)` (browser locale, ICU). For names with diacritics — likely here, given `Dr. Anna Nowak` is the placeholder and the PRD's persona is Polish-speaking — the two can disagree, so a row can sit in one position after adding and jump on reload. The comment at `:36` states the intent ("keep local edits in the same order"), which is exactly what the divergence breaks.
- **Fix**: Pass an explicit locale and collation to match the database — `a.name.localeCompare(b.name, "pl", { sensitivity: "base" })` — or drop the client sort and re-read the list after a mutation.
- **Decision**: SKIPPED — worst case is a row changing position on reload, with no data effect. Left unchanged; if S-02/S-03 hit the same server-order-vs-client-order split, that repetition is the signal to settle it once rather than per island.

### F7 — `pending` does not guard the Edit buttons, so an in-flight PATCH closes a newly opened editor

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/specialists/SpecialistsManager.tsx:319-328`, `:158`
- **Detail**: Submit buttons (`:240`, `:302`) and the delete trigger (`:340`) all carry `disabled={pending}`, but the per-row **Edit** button does not. Saving row A and then clicking Edit on row B before the PATCH resolves opens B's editor; the resolving handler then runs `setEditingId(null)` at `:158` and closes it again with no explanation. The in-flight request itself is safe — `parsed.data` is captured before the `await`, so B's values cannot leak into A's write.
- **Fix**: Add `disabled={pending}` to the Edit button, matching its siblings.
- **Decision**: FIXED — added `disabled={pending}` to the per-row Edit button, matching its three siblings, with a comment naming the `setEditingId(null)` interaction so the prop is not read as boilerplate and removed later.
