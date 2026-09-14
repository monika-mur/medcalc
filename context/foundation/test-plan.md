# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-15

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in area Y"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`,
`supabase/tests/`, `tests/`, `scripts/` (excludes `src/components/ui/`,
generated shadcn output) — 111 commits in the last 30 days, ample signal.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                         | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The supply engine computes a wrong supply-end date, and the wrong result renders identically to a correct one                                                   | High   | High       | PRD Success Criteria/Guardrails ("an incorrect 'you have enough' result is a product failure"); interview Q1, Q3, Q4; hot-spot dir `src/lib/` (12 commits/30d); a fully-specified engine test suite has existed since S-04 and was never built  |
| 2   | Exact-decimal arithmetic is recomputed with raw floats on the display path and shows the user a plausible-but-wrong number                                      | High   | Medium     | interview Q2 (lived incident — a success notice once read "0.19999999999999998 fewer than projected"); CLAUDE.md → Domain schema states the decimal rule for the write path only                                                                |
| 3   | A migration merges to the repo but is never applied to the cloud database, so deployed code assumes a policy or column that isn't live                          | High   | Medium     | interview Q2 (lived incident — an 8-day production 500 on a same-day dosage edit); `lessons.md` → "Confirm every migration reached cloud, a green local suite cannot"; a partial script-level mitigation already exists                         |
| 4   | A multi-step medication write (create, dosage replace, or recount) partially fails, leaving a state indistinguishable from a legitimate one                     | High   | Medium     | hot-spot dirs `src/lib/db/` (12 commits/30d) and `src/pages/api/medications/[id]/` (10 commits/30d); interview Q3; PostgREST has no transaction and the schema forbids triggers/RPC, so partial failure is a normal code path, not an edge case |
| 5   | An UPDATE or DELETE against a missing or foreign row is reported as success instead of not-found                                                                | Medium | Medium     | CLAUDE.md → API conventions ("Zero rows is not an error, so 404 has to be detected"); this exact gap is independently named across three prior slices' deferred-test notes                                                                      |
| 6   | A caller-supplied `updated_at` (or other server-owned audit column) is accepted from client input instead of being overwritten                                  | Medium | Low        | prior slices' deferred-test notes; no database-level fallback exists — the CHECK constraint blocks backdating only, never a future value                                                                                                        |
| 7   | The `dosage_changes` INSERT policy predicate (`effective_date >= current_date`) is silently loosened by a bad merge or a diverged reset, and nothing detects it | Medium | Low        | `lessons.md` → "State table privileges in the migration; never inherit them from the platform" (same failure shape, earlier incident); a ready-to-paste pgTAP assertion for this exact policy already exists and was explicitly deferred        |

**Abuse / security lens applied.** Risks #5 and #7 are the product's
authorization-adjacent surface — RLS is the only isolation boundary (PRD
Access Control: flat role model, no admin, no shared access) and both risks
are "a policy silently fails to hold." No additional abuse row was added:
the product's only untrusted-input surface is auth, explicitly excluded
from budget (interview Q5), and there is no payments or third-party PII
surface.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                                                      | Must challenge                                                                                                                                                               | Context `/10x-research` must ground                                                                                           | Likely cheapest layer | Anti-pattern to avoid                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| #1   | The engine produces the exact documented date, reason, and projected quantity across the worked examples and edge cases (single/multiple refills, dosage change between events, expiry cap, breakpoint past the cap, exhaustion-then-refill, zero-dose segments) | "The date looks plausible" is not "the date is right" — the oracle must come from independently hand-worked arithmetic, never from reading the function's own current output | Exact breakpoint-set construction, the expiry-bound clamp, the zero-dose branch, and the exhaustion/refill continuation logic | unit                  | Assertion copied from the implementation under test (the oracle problem)               |
| #2   | A rendered discrepancy or quantity notice matches the exact-decimal value, not the raw-float value, across integer, fractional, and precision-clamped cases                                                                                                      | "The database row is correct" does not imply "the display is correct" — they are two independent computations over the same numbers                                          | Every place a `numeric`-sourced pair of values is subtracted or compared on the client, not only the server                   | unit                  | Testing only the write path and assuming the display path inherits its correctness     |
| #3   | A CI run fails when a migration file exists in the repo that the target cloud database has not applied                                                                                                                                                           | A green local `db push` does not mean cloud is current                                                                                                                       | The existing drift-check script's actual comparison logic, and whether it already runs where this phase would wire a gate     | integration / CI gate | Testing only the script's happy path, never a genuine drift scenario                   |
| #4   | A forced failure between two steps of a multi-insert write leaves a state the app already treats as legal (e.g., dosage 0, quantity 0), and no route reports partial success as full success                                                                     | "It has never failed in practice" — PostgREST offers no transaction, so a partial failure is a normal reachable path, not a hypothetical                                     | The exact insert order per write path and what each route returns when a later step fails                                     | integration           | Testing only the all-steps-succeed path                                                |
| #5   | An UPDATE/DELETE against a missing or foreign id returns a not-found outcome, not success, across every affected data module                                                                                                                                     | "The row survived" (an existing isolation test) is not the same claim as "the operation reported the correct outcome"                                                        | The `.select()`-chaining pattern each module uses and how each surfaces a zero-rows result                                    | integration           | Reusing an existing row-survival test as if it already covered this                    |
| #6   | A caller-supplied future `updated_at` is silently overwritten by the module's own server-side timestamp                                                                                                                                                          | "The CHECK constraint handles it" — it blocks backdating only, never a future value                                                                                          | Exactly which fields each write path accepts from caller input versus sets itself                                             | integration           | Assuming a database constraint substitutes for an application-level assertion          |
| #7   | A back-dated INSERT to `dosage_changes` is rejected with the specific RLS error code; today and future dates still succeed                                                                                                                                       | A zero-rows-matched outcome and a policy rejection both "fail silently" from the caller's point of view — the specific error code must be pinned, not just "did not succeed" | The exact current policy predicate and its `with check` clause                                                                | pgTAP                 | Asserting only that the operation "doesn't succeed" without pinning the rejection code |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                  | Goal (one line)                                                                                                           | Risks covered | Test types         | Status      | Change folder                                          |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------ | ----------- | ------------------------------------------------------ |
| 1   | Supply-engine unit coverage                 | Prove the arithmetic the PRD guards hardest is correct, at the cheapest layer, before anything else is built on top of it | #1, #2        | unit               | complete    | `context/changes/testing-supply-engine-unit-coverage/` |
| 2   | Medications write-path integration coverage | Catch partial-write and zero-rows-as-success failures on the repo's most-churned, least-covered surface                   | #4, #5, #6    | integration        | not started | —                                                      |
| 3   | Migration and policy drift guards           | Make schema drift and RLS-policy loosening fail loudly instead of silently                                                | #3, #7        | integration, pgTAP | not started | —                                                      |
| 4   | Quality-gates wiring                        | Wire the existing (and newly written) suites into CI so a green check means the behavior was actually exercised           | cross-cutting | gates              | not started | —                                                      |

**Status vocabulary** (fixed): `not started` → `change opened` → `researched`
→ `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                | Tool                                              | Version                      | Notes                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration   | Vitest                                            | 4.1.10                       | Configured (`vitest.config.ts`) as two projects: `unit` (no stack needed, `npm run test:unit`) and `integration` (needs a running local Supabase stack, `npm run test:integration`). §3 Phase 1 populated `tests/unit/` — see §6.1. |
| database invariants  | pgTAP                                             | n/a (via `supabase test db`) | 4 files, 709 lines, all at the schema/RLS layer (`supabase/tests/`). `npm run db:test`.                                                                                                                                             |
| API mocking          | none configured                                   | —                            | Not yet needed — integration tests run against a real local Supabase stack per project convention, not a mocked network edge.                                                                                                       |
| e2e                  | none                                              | —                            | No Playwright or equivalent installed. Not recommended for this rollout — the PRD's critical paths (dashboard calculation, CRUD) are cheaper to prove at unit/integration layers; see §7.                                           |
| accessibility        | none                                              | —                            | Not in scope for this rollout; NFR is mobile-viewport usability, not covered by any risk in §2.                                                                                                                                     |
| (optional) AI-native | none available this session — checked: 2026-09-14 | n/a                          | No post-edit hook or vision-review tooling configured; not proposed as a rollout phase (no risk in §2 needs it more cheaply than unit/integration would provide it).                                                                |

**Stack grounding tools (current session):**

- Docs: Context7 — not available in current session; local `supabase:supabase-postgres-best-practices` skill used instead where Postgres/RLS guidance was needed; checked: 2026-09-14
- Search: Exa.ai — available (`web_search_exa`/`web_fetch_exa`); not queried this run, no library-selection question arose; checked: 2026-09-14
- Runtime/browser: Playwright MCP / browser tool — not available in current session; no e2e phase proposed as a result; checked: 2026-09-14
- Provider/platform: Supabase MCP present but unauthenticated this session; GitHub Actions (CI) relevant to Phase 4, no MCP used, config read directly from `.github/workflows/ci.yml`; checked: 2026-09-14

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                                 | Where                                                            | Required?                                        | Catches                                                              |
| ------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| lint + typecheck + build             | CI (`ci.yml`)                                                    | required (already wired)                         | syntactic / type drift                                               |
| unit — supply engine                 | local, wired to CI after §3 Phase 4                              | planned                                          | arithmetic regressions (Risk #1, #2)                                 |
| integration — medications write path | local (needs local Supabase stack), wired to CI after §3 Phase 4 | planned                                          | partial-write and zero-rows-as-success regressions (Risk #4, #5, #6) |
| pgTAP — policy predicates            | local (`db:test`), wired to CI after §3 Phase 4                  | planned                                          | RLS/policy drift (Risk #7)                                           |
| migration-drift check                | CI (`ci.yml`, non-PR pushes only)                                | required (already wired, pre-dates this rollout) | code merged against a schema not yet applied to cloud (Risk #3)      |
| e2e on critical flows                | —                                                                | not proposed this rollout                        | out of scope — see §7                                                |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Location**: `tests/unit/`. Not co-located with source — this repo keeps
  both test suites in dedicated directories (`tests/integration/`,
  `supabase/tests/`), and the unit suite follows the same convention.
- **Naming**: `<module>.test.ts`, one file per `src/lib/` module under test
  (e.g. `tests/unit/supply.test.ts` for `src/lib/supply.ts`).
- **Runs without a stack**: the `unit` Vitest project (`vitest.config.ts`) is
  `environment: "node"` with no Supabase dependency — a pure function needs no
  fixture, no auth, no running containers. If what you're testing reads a
  database or calls `fetch`, it belongs in §6.2 (integration), not here.
- **If the function you need is module-private**: either add `export` in
  place, or extract it to a new pure module if it currently lives inside a
  React component (importing a `.tsx` file into a `node`-environment test
  drags in React and its whole dependency graph for no reason). See
  `src/lib/notices.ts` for the extraction shape.
- **Reference test**: `tests/unit/supply.test.ts` — house style is explicit
  `vitest` imports (no globals), `describe` blocks as domain phrases, and `it`
  titles that state the _reasoning_ for any assertion that could plausibly be
  "corrected" by a future reader (e.g. "colours a supply ending EXACTLY on the
  visit date red, not yellow — the bands partition on days of cover AFTER the
  visit..."). Also worth reading: `tests/unit/decimal.test.ts` for the pattern
  of naming the specific float pair that raw JS arithmetic gets wrong.
- **Run locally**: `npm run test:unit` (this project only, no stack needed) or
  `npm test` (both projects; needs `npx supabase start` first for the
  integration half).

### 6.2 Adding an integration test

- TBD — see §3 Phase 2 for the medications-write-path pattern (multi-step
  write failure, zero-rows-as-not-found, server-owned column tamper resistance).

### 6.3 Adding an e2e test

- Not planned this rollout. See §7 for why.

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 2 for the route-level integration pattern once it ships.

### 6.5 Adding a pgTAP assertion for an RLS policy or CHECK constraint

- TBD — see §3 Phase 3 for the policy-drift-guard pattern.

### 6.6 Per-rollout-phase notes

- **Phase 1 (2026-09-15)**: two functions needed a visibility change before
  they were testable — `discrepancyPhrase` (module-private inside a React
  island) and `deriveStatus` (module-private in a data module). Neither needed
  redesign, only exposure; see §6.1's note on this. The Vitest `projects` split
  requires `extends: true` on every project entry or it silently fails to
  inherit the root `@` alias, which then reads as a missing-file error rather
  than a config error — confirmed against Vitest 4.1.10's own type
  definitions, not assumed. Two prior deferred-test specifications
  (`mid-supply-dosage-change/follow-ups/deferred-tests.md`,
  `supply-status-dashboard/follow-ups/supply-engine-tests.md`) contained a
  wrong worked-example date and a superseded status-precedence row; both were
  corrected at source rather than silently worked around, so a future reader
  of those files sees the same correction this phase made.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **S-06 liquid-medication tracking** — not yet built (roadmap status:
  proposed). Testing an unimplemented feature's engine extension is
  premature. Re-evaluate once S-06 ships. (Source: interview Q5.)
- **Visual/snapshot tests on `src/components/ui/`** — generated shadcn
  output, not ours to edit per `CLAUDE.md`. Snapshotting it breaks on every
  shadcn upgrade and catches nothing product-specific. (Source: interview Q5.)
- **Auth flows (signin/signup/signout)** — Supabase-provided, pre-existing
  baseline, working in production since before F-01; low product-specific
  risk. (Source: interview Q5.)
- **End-to-end browser tests** — no risk in §2 needs the full deployed
  shape to catch it; every top risk is cheaper to prove at unit or
  integration layer. Re-evaluate if a future risk specifically requires
  auth+cookie+handler crossing that integration tests can't reach.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-14
- Stack versions last verified: 2026-09-14
- AI-native tool references last verified: 2026-09-14 (none available this session)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (e.g., S-06 ships),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
